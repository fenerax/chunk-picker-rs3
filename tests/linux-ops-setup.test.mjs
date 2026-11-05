import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { setupB2, lifecycle, uploadCapabilities } from '../scripts/ops/setup-b2.mjs';
import { setupHealthchecks, checks } from '../scripts/ops/setup-healthchecks.mjs';
import { pruneB2 } from '../scripts/ops/prune-b2.mjs';
const base = fileURLToPath(new URL('../.local/ops-setup-tests/', import.meta.url));
async function fixture(t, value) {
  await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'synthetic-input'); await writeFile(keyFile, value); return keyFile;
}
function b2Mock({ failInstall = false } = {}) {
  const state = { bucket: null, keys: [], item: null, secrets: {}, commands: [], calls: [], failInstall };
  const fetchImpl = async (url, options) => {
    const method = new URL(url).pathname.split('/').at(-1), body = options.body ? JSON.parse(options.body) : {};
    state.calls.push(method); let result;
    switch (method) {
      case 'b2_authorize_account': result = { accountId: 'syntheticaccount', authorizationToken: 'synthetic-session', apiInfo: { storageApi: { apiUrl: 'https://' + 'api001.backblazeb2.com' } } }; break;
      case 'b2_list_buckets': result = { buckets: state.bucket ? [state.bucket] : [] }; break;
      case 'b2_create_bucket': state.bucket = { ...body, bucketId: 'syntheticbucket' }; result = state.bucket; break;
      case 'b2_list_keys': result = { keys: state.keys }; break;
      case 'b2_create_key': result = { ...body, applicationKeyId: 'synthetic' + (state.keys.length + 1), applicationKey: 'synthetic-value-' + (state.keys.length + 1) }; state.keys.push(result); break;
      case 'b2_delete_key': state.keys = state.keys.filter(row => row.applicationKeyId !== body.applicationKeyId); result = {}; break;
      default: throw Error('Unexpected account method.');
    }
    return { ok: true, json: async () => structuredClone(result) };
  };
  const execute = (command, args, input) => {
    state.commands.push({ command, args });
    assert(!args.join(' ').includes('synthetic-value')); // Secret values are stdin only.
    if (command === 'op') {
      if (args[1] === 'list') return JSON.stringify(state.item ? [{ id: 'syntheticitem', title: state.item.title }] : []);
      if (args[1] === 'get') return JSON.stringify(state.item);
      if (args[1] === 'create') { assert.equal(args[2], '-'); state.item = JSON.parse(input); return '{}'; }
    }
    if (command === 'ssh') {
      if (!input) return state.secrets['b2-account'] ?? '';
      const values = JSON.parse(input);
      if (state.failInstall) { state.secrets['restic-password'] = values['restic-password']; state.failInstall = false; throw Error('Interrupted install'); }
      for (const [name, value] of Object.entries(values)) {
        assert(!state.secrets[name] || state.secrets[name] === value); state.secrets[name] = value;
      }
      return '';
    }
    throw Error('Unexpected subprocess.');
  };
  return { state, fetchImpl, execute };
}
test('B2 setup is idempotent, scopes keys, stores recovery before server install and uses only stdin for values', async t => {
  const keyFile = await fixture(t, JSON.stringify({ applicationKeyId: 'synthetic-setup', applicationKey: 'synthetic-only' }));
  const mock = b2Mock(), options = { keyFile, alias: 'picker-vps', bucketName: 'chunk-picker-backups', vault: 'Synthetic' };
  await setupB2(options, mock); const saved = structuredClone(mock.state.secrets);
  assert.deepEqual(mock.state.bucket.lifecycleRules, lifecycle);
  assert.equal(mock.state.keys.length, 2);
  assert.deepEqual(mock.state.keys.find(key => key.applicationKeyId === saved['b2-account']).capabilities, uploadCapabilities);
  assert(mock.state.keys.every(key => key.bucketId === 'syntheticbucket' && key.namePrefix === 'chunk-picker/'));
  assert(mock.state.item.fields.some(row => row.label === 'cleanup-key' && row.type === 'CONCEALED'));
  await setupB2(options, mock); assert.deepEqual(mock.state.secrets, saved); assert.equal(mock.state.keys.length, 2);
  assert.equal(mock.state.calls.filter(method => method === 'b2_create_bucket').length, 1);
  const create = mock.state.commands.findIndex(row => row.command === 'op' && row.args[1] === 'create');
  const install = mock.state.commands.findIndex(row => row.command === 'ssh' && row.args[1].includes('python3'));
  assert(create < install);
});
test('interrupted credential publication resumes without rotation; unsafe bucket or broader installed key refuses', async t => {
  const keyFile = await fixture(t, JSON.stringify({ applicationKeyId: 'synthetic-setup', applicationKey: 'synthetic-only' }));
  const mock = b2Mock({ failInstall: true }), options = { keyFile, alias: 'picker-vps', bucketName: 'chunk-picker-backups', vault: 'Synthetic' };
  await assert.rejects(setupB2(options, mock)); const password = mock.state.secrets['restic-password'];
  await setupB2(options, mock); assert.equal(mock.state.keys.length, 2); assert.equal(mock.state.secrets['restic-password'], password);
  mock.state.keys.find(key => key.applicationKeyId === mock.state.secrets['b2-account']).capabilities.push('deleteFiles');
  await assert.rejects(setupB2(options, mock), /differs/);
  mock.state.bucket.lifecycleRules = [{ ...lifecycle[0], daysFromHidingToDeleting: 1 }];
  await assert.rejects(setupB2(options, mock), /protection/);
});
test('Healthchecks creates/updates exactly three checks and never prints or shells a ping URL', async t => {
  const keyFile = await fixture(t, 'synthetic-only'), stored = [], writes = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (!options.method) return { ok: true, json: async () => ({ checks: stored }) };
    const value = JSON.parse(options.body), index = checks.findIndex(check => check.name === value.name);
    const ping_url = 'https://' + 'hc-ping.com/' + '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
    if (!stored.some(row => row.name === value.name)) stored.push({ ...value, update_url: String(url) + index });
    assert(value.period >= 600 && value.grace >= 1800); return { ok: true, json: async () => ({ ping_url }) };
  };
  const execute = (_command, args, input) => { assert(!args.join(' ').includes('hc-ping')); writes.push(JSON.parse(input)); return ''; };
  for (let i = 0; i < 2; i++) await setupHealthchecks({ keyFile, alias: 'picker-vps' }, { fetchImpl, execute });
  assert.equal(stored.length, 3); assert.deepEqual(writes[0], writes[1]); assert.equal(Object.keys(writes[0]).length, 3);
});
test('trusted prune refuses an unfenced uploader and keeps delete authority out of argv and the VPS', async () => {
  let masked = false; const calls = [];
  const item = { fields: Object.entries({ repository: 'b2:chunk-picker-backups:chunk-picker', 'repository-password': 'synthetic-only',
    'cleanup-id': 'synthetic-cleanup', 'cleanup-key': 'synthetic-value' }).map(([label, value]) => ({ label, value })) };
  const adapters = { verify: async () => {}, execute: (command, args) => {
    if (command === 'ssh') { assert(!args.join(' ').includes('synthetic-value')); return JSON.stringify({ paused: masked }); }
    assert.equal(command, 'op'); return JSON.stringify(item);
  }, repositoryRun: (_file, args, env) => {
    assert(!args.join(' ').includes('synthetic-value')); assert.equal(env.B2_ACCOUNT_KEY, 'synthetic-value');
    assert(args.includes('--no-cache')); calls.push(args);
  } };
  const options = { alias: 'picker-vps', vault: 'Synthetic', item: 'Synthetic', binary: path.resolve('synthetic-restic') };
  await assert.rejects(pruneB2(options, adapters), /Pause and drain/); assert.equal(calls.length, 0);
  masked = true; await pruneB2(options, adapters); assert.deepEqual(calls.map(args => args[2]), ['check', 'forget', 'check']);
});
