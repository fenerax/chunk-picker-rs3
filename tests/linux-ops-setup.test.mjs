import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { setupB2, lifecycle, uploadCapabilities } from '../scripts/ops/setup-b2.mjs';
import { setupHealthchecks, checks } from '../scripts/ops/setup-healthchecks.mjs';
import { pruneB2 } from '../scripts/ops/prune-b2.mjs';
import { deploymentIdentity, installSecrets, installedB2Id, sshAlias, verifyDeployment } from '../scripts/ops/setup-common.mjs';
import { setupDiscord } from '../scripts/ops/setup-discord.mjs';
import { fingerprint, captureIdentity, verifyHost, pinnedSsh } from '../scripts/ops/deployment-identity.mjs';
import { installRestic } from '../scripts/ops/install-restic.mjs';
import { inventory, sha } from '../scripts/linux/files.mjs';
import { publishConfig } from '../scripts/linux/bootstrap-alerts.mjs';
const base = fileURLToPath(new URL('../.local/ops-setup-tests/', import.meta.url));
let pinDir, pinFile;
const syntheticKey = 'ssh-ed25519 ' + Buffer.from('synthetic-host-key').toString('base64');
const pin = { format: 'picker-host-identity-v1', alias: 'picker-vps', role: 'production', hostKey: syntheticKey,
  fingerprint: fingerprint(syntheticKey), machineIdHash: 'a'.repeat(64) };
before(async () => {
  await mkdir(base, { recursive: true }); pinDir = await mkdtemp(path.join(base, 'identity-'));
  pinFile = path.join(pinDir, 'pin.json'); await writeFile(pinFile, JSON.stringify(pin));
  process.env.PICKER_DEPLOYMENT_IDENTITY_FILE = pinFile;
});
after(async () => { delete process.env.PICKER_DEPLOYMENT_IDENTITY_FILE; await rm(pinDir, { recursive: true, force: true }); });
const machineReply = args => args.at(-1).includes('/etc/machine-id') ? pin.machineIdHash : null;
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
      if (machineReply(args)) return machineReply(args);
      if (args.at(-1).includes('deployment.json')) return JSON.stringify(deploymentIdentity('picker-vps'));
      if (!input) return state.secrets['b2-account'] ?? '';
      const { values } = JSON.parse(input);
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
  const install = mock.state.commands.findIndex(row => row.command === 'ssh' && row.args.at(-1).includes('b64decode'));
  assert(create < install);
});
test('Linux secret transaction preserves existing values, refuses links and publishes rotation with explicit modes', { skip: process.platform !== 'linux' }, async t => {
  const input = await fixture(t, '{}'), dir = path.dirname(input), base = path.join(dir, 'secrets');
  let killAtPublication = false;
  await writeFile(path.join(dir, 'deployment.json'), JSON.stringify(deploymentIdentity('picker-vps')));
  const execute = (_command, args, payload) => {
    if (machineReply(args)) return machineReply(args);
    if (!payload) return JSON.stringify(deploymentIdentity('picker-vps'));
    const encoded = args.at(-1).match(/b64decode\('([^']+)'\)/)[1];
    // Keep the production transaction intact; substitute only the synthetic
    // filesystem root and its unprivileged test owner (CI runs as a non-root user).
    let program = Buffer.from(encoded, 'base64').toString().replaceAll('/etc/chunk-picker', dir)
      .replace("['/etc',", '[').replaceAll('os.geteuid()!=0', `os.geteuid()!=${process.getuid()}`)
      .replaceAll('s.st_uid!=0', `s.st_uid!=${process.getuid()}`).replaceAll('os.chown(tmp,0,0)', `os.chown(tmp,${process.getuid()},${process.getgid()})`)
      .replaceAll('candidate.st_uid==0', `candidate.st_uid==${process.getuid()}`)
      .replaceAll('os.chown(target,0,0)', `os.chown(target,${process.getuid()},${process.getgid()})`);
    if (killAtPublication) program = program.replace('else: os.link(tmp,target)', 'else: os.link(tmp,target);os.kill(os.getpid(),9)');
    return execFileSync('python3', ['-c', program], { input: payload, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
  };
  const webhook = suffix => 'https://' + 'discord.com/api/webhooks/synthetic/' + suffix;
  installSecrets('picker-vps', { 'discord-webhook': webhook('first') }, execute);
  const target = path.join(base, 'discord-webhook');
  assert.equal((await stat(target)).mode & 0o777, 0o600); assert.equal((await stat(base)).mode & 0o777, 0o700);
  installSecrets('picker-vps', { 'discord-webhook': webhook('first') }, execute);
  assert.throws(() => installSecrets('picker-vps', { 'discord-webhook': webhook('second') }, execute));
  assert.equal((await readFile(target, 'utf8')).trim(), webhook('first'));
  installSecrets('picker-vps', { 'discord-webhook': webhook('second') }, execute, { rotate: ['discord-webhook'] });
  assert.equal((await readFile(target, 'utf8')).trim(), webhook('second')); assert.equal((await stat(target)).mode & 0o777, 0o600);
  killAtPublication = true;
  assert.throws(() => installSecrets('picker-vps', { 'b2-account': 'synthetic' }, execute), error => error.signal === 'SIGKILL');
  const account = path.join(base, 'b2-account'); assert.equal((await stat(account)).nlink, 2);
  killAtPublication = false;
  installSecrets('picker-vps', { 'b2-account': 'synthetic' }, execute);
  assert.equal((await stat(account)).nlink, 1); assert.equal((await readFile(account, 'utf8')).trim(), 'synthetic');
  assert.deepEqual((await inventory(base)).map(row => row.path), ['b2-account', 'discord-webhook']);
  const foreign = path.join(base, 'unrelated'), misleading = path.join(base, '.setup-12345678');
  await link(account, foreign); await symlink(account, misleading);
  assert.throws(() => installSecrets('picker-vps', { 'b2-account': 'synthetic' }, execute));
  assert.equal((await stat(account)).nlink, 2); assert((await lstat(misleading)).isSymbolicLink());
  assert.equal(await readFile(foreign, 'utf8'), 'synthetic\n');
  await rm(target); await symlink(input, target);
  assert.throws(() => installSecrets('picker-vps', { 'discord-webhook': webhook('third') }, execute, { rotate: ['discord-webhook'] }));
  assert.equal(await readFile(input, 'utf8'), '{}');
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
  const execute = (_command, args, input) => { if (machineReply(args)) return machineReply(args); if (args.at(-1).includes('deployment.json')) return JSON.stringify(deploymentIdentity('picker-vps'));
    assert(!args.join(' ').includes('hc-ping')); writes.push(JSON.parse(input).values); return ''; };
  for (let i = 0; i < 2; i++) await setupHealthchecks({ keyFile, alias: 'picker-vps' }, { fetchImpl, execute });
  assert.equal(stored.length, 3); assert.deepEqual(writes[0], writes[1]); assert.equal(Object.keys(writes[0]).length, 3);
});
test('trusted prune refuses an unfenced uploader and keeps delete authority out of argv and the VPS', async t => {
  let masked = false; const calls = [];
  const tempRoot = path.dirname(await fixture(t, '{}'));
  const item = { fields: Object.entries({ repository: 'b2:chunk-picker-backups:chunk-picker', 'repository-password': 'synthetic-only',
    'cleanup-id': 'synthetic-cleanup', 'cleanup-key': 'synthetic-value' }).map(([label, value]) => ({ label, value })) };
  const adapters = { verify: async () => {}, execute: (command, args) => {
    if (command === 'ssh') {
      if (machineReply(args)) return machineReply(args); if (args.at(-1).includes('deployment.json')) return JSON.stringify(deploymentIdentity('picker-vps'));
      assert(!args.join(' ').includes('synthetic-value')); return JSON.stringify({ paused: masked, repository: 'b2:chunk-picker-backups:chunk-picker' }); }
    assert.equal(command, 'op'); return JSON.stringify(item);
  }, tempRoot, reserve: 0, repositoryRun: async (_file, args, { env, signal }) => {
    assert(!args.join(' ').includes('synthetic-value')); assert.equal(env.B2_ACCOUNT_KEY, 'synthetic-value');
    assert(env.TMPDIR.startsWith(tempRoot + path.sep)); assert.equal(env.TEMP, env.TMPDIR); assert.equal(env.TMP, env.TMPDIR);
    assert.equal(env.RESTIC_CACHE_DIR, path.join(env.TMPDIR, 'cache')); assert.equal(signal.aborted, false);
    if (args.includes('stats')) return JSON.stringify({ total_size: 1234, total_uncompressed_size: 2345, total_blob_count: 1 });
    // An asynchronous command must finish before the next command starts.
    await writeFile(path.join(env.TMPDIR, 'pack'), 'synthetic');
    assert(args.includes('--no-cache')); calls.push(args);
  } };
  const options = { alias: 'picker-vps', vault: 'Synthetic', item: 'Synthetic', binary: path.resolve('synthetic-restic') };
  await assert.rejects(pruneB2(options, adapters), /Pause and drain/); assert.equal(calls.length, 0);
  masked = true; await pruneB2(options, adapters); assert.deepEqual(calls.map(args => args.find(arg => ['check', 'forget'].includes(arg))), ['check', 'forget', 'check']);
  assert(!calls[1].includes('--no-lock'));
  item.fields.find(row => row.label === 'repository').value = 'b2:other-backups:chunk-picker';
  await assert.rejects(pruneB2(options, adapters), /repository identity/); assert.equal(calls.length, 3);
});

test('unapproved roles and absent/wrong deployment identities refuse before API calls or secret transfer', async t => {
  const keyFile = await fixture(t, '{}');
  for (const alias of ['picker-scratch', 'localhost', '127' + '.0.0.1', 'anything']) {
    assert.throws(() => sshAlias(alias));
    const adapters = { execute: () => { throw Error('unexpected SSH'); }, fetchImpl: () => { throw Error('unexpected API'); } };
    await assert.rejects(setupB2({ alias, keyFile }, adapters), /Approved/);
    await assert.rejects(setupHealthchecks({ alias, keyFile }, adapters), /Approved/);
    assert.throws(() => installSecrets(alias, { 'restic-password': 'synthetic' }, adapters.execute), /Approved/);
    assert.throws(() => installedB2Id(alias, adapters.execute), /Approved/);
    await assert.rejects(pruneB2({ alias }, adapters), /Approved/);
  }
  for (const identity of [{}, deploymentIdentity('picker-scratch'), { ...deploymentIdentity('picker-vps'), role: 'wrong' }]) {
    const adapters = { execute: (_command, args, input) => { if (machineReply(args)) return machineReply(args); assert(!input); assert(args.at(-1).includes('deployment.json')); return JSON.stringify(identity); },
      fetchImpl: () => { throw Error('unexpected API'); } };
    await assert.rejects(setupB2({ alias: 'picker-vps', keyFile }, adapters), /identity differs/);
    await assert.rejects(setupHealthchecks({ alias: 'picker-vps', keyFile }, adapters), /identity differs/);
    assert.throws(() => installSecrets('picker-vps', { 'restic-password': 'synthetic' }, adapters.execute), /identity differs/);
    assert.throws(() => installedB2Id('picker-vps', adapters.execute), /identity differs/);
  }
});
test('webhook validates before SSH, is stdin-only, and replacement needs explicit rotation', async t => {
  for (const input of ['', 'partial', 'https://' + 'discord.com/api/webhooks/only-id', 'invalid\npartial']) {
    const keyFile = await fixture(t, input); let calls = 0;
    await assert.rejects(setupDiscord({ alias: 'picker-vps', keyFile }, { execute: () => { calls++; } })); assert.equal(calls, 0);
  }
  const webhook = 'https://' + 'discord.com/api/webhooks/synthetic/synthetic-value', keyFile = await fixture(t, webhook), payloads = [];
  const execute = (_command, args, input) => {
    if (machineReply(args)) return machineReply(args);
    assert(!args.join(' ').includes(webhook));
    if (!input) return JSON.stringify(deploymentIdentity('picker-vps'));
    payloads.push(JSON.parse(input)); return '';
  };
  await setupDiscord({ alias: 'picker-vps', keyFile }, { execute });
  await setupDiscord({ alias: 'picker-vps', keyFile, rotate: true }, { execute });
  assert.deepEqual(payloads[0], { values: { 'discord-webhook': webhook }, rotate: [] });
  assert.deepEqual(payloads[1].rotate, ['discord-webhook']);
});
test('bootstrap publication is create-only or exact-match; empty and partial input preserve working config', async t => {
  const file = await fixture(t, '{"working":true}\n');
  for (const value of ['', '{', '{"working":false}\n']) {
    await assert.rejects(publishConfig(file, value));
    assert.equal(await (await import('node:fs/promises')).readFile(file, 'utf8'), '{"working":true}\n');
  }
  await publishConfig(file, '{"working":true}\n');
  const next = file + '-new'; await publishConfig(next, '{"working":true}\n');
  await assert.rejects(publishConfig(next, '{"working":false}\n'), /differs/);
});

test('killed config publication recovers only its matching private temp hard link before retry', { skip: process.platform !== 'linux' }, async t => {
  const dir = path.dirname(await fixture(t, '{}')), file = path.join(dir, 'monitor.json'), bytes = '{"synthetic":true}\n';
  const program = `import { link } from 'node:fs/promises';
    const { publishConfig } = await import(process.argv[1]);
    await publishConfig(process.argv[2], process.argv[3], { linkFile: async (from, to) => {
      await link(from, to); process.kill(process.pid, 'SIGKILL');
    } });`;
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', program,
    new URL('../scripts/linux/bootstrap-alerts.mjs', import.meta.url).href, file, bytes], { stdio: 'pipe' }), error => error.signal === 'SIGKILL');
  assert.equal((await stat(file)).nlink, 2);
  await publishConfig(file, bytes);
  assert.equal((await stat(file)).nlink, 1); assert.equal(await readFile(file, 'utf8'), bytes);
  assert(!(await readdir(dir)).some(name => name.endsWith('.tmp')));
  await inventory(dir); // Rebuild inventory accepts the recovered tree.
  const foreign = path.join(dir, 'unrelated'), misleading = file + '.00000000-0000-4000-8000-000000000000.tmp';
  await link(file, foreign); await symlink(file, misleading);
  await assert.rejects(publishConfig(file, bytes));
  assert.equal((await stat(file)).nlink, 2); assert((await lstat(misleading)).isSymbolicLink());
  assert.equal(await readFile(foreign, 'utf8'), bytes);
});

test('missing pins, a scratch pin, wrong host key and wrong machine refuse all setup before cloud mutation or credential transfer', async t => {
  const keyFile = await fixture(t, '{}');
  for (const failure of ['missing', 'scratch', 'key', 'machine']) {
    const file = path.join(pinDir, failure + '.json');
    if (failure !== 'missing') await writeFile(file, JSON.stringify(failure === 'scratch'
      ? { ...pin, alias: 'picker-scratch', role: 'rehearsal' } : pin));
    let transfers = 0, api = 0;
    const execute = (command, args, input) => {
      assert.equal(command, 'ssh'); assert(args.includes('StrictHostKeyChecking=yes'));
      assert(args.includes('GlobalKnownHostsFile=none')); assert(args.includes('VerifyHostKeyDNS=no'));
      if (input) transfers++;
      if (failure === 'key') throw Error('Host key verification failed.');
      if (machineReply(args)) return failure === 'machine' ? 'b'.repeat(64) : machineReply(args);
      throw Error('Unexpected remote command.');
    };
    const adapters = { execute, identityFile: file, fetchImpl: () => { api++; throw Error('unexpected API'); } };
    await assert.rejects(setupB2({ alias: 'picker-vps', keyFile }, adapters));
    await assert.rejects(setupHealthchecks({ alias: 'picker-vps', keyFile }, adapters));
    assert.throws(() => installSecrets('picker-vps', { 'restic-password': 'synthetic-only' }, execute, { identityFile: file }));
    assert.throws(() => installedB2Id('picker-vps', execute, file));
    await assert.rejects(pruneB2({ alias: 'picker-vps' }, adapters));
    assert.equal(transfers, 0); assert.equal(api, 0);
  }
});

test('explicit capture is read-only remotely, checks negotiated fingerprint, records separate roles and refuses replacement', async t => {
  for (const alias of ['picker-vps', 'picker-scratch']) {
    const file = path.join(pinDir, alias + '.json'); let calls = 0;
    const execute = (command, args) => {
      calls++; assert.equal(command, 'ssh'); assert(args.includes('StrictHostKeyChecking=yes'));
      assert(!args.join(' ').includes('sudo')); assert(args.at(-1).includes('/etc/machine-id'));
      return { status: 0, stdout: pin.machineIdHash + '\n' + syntheticKey + ' comment\n',
        stderr: 'debug1: Server host key: ssh-ed25519 ' + pin.fingerprint };
    };
    captureIdentity(alias, file, execute);
    const saved = JSON.parse(await readFile(file)); assert.equal(saved.alias, alias);
    assert.equal(saved.role, alias === 'picker-vps' ? 'production' : 'rehearsal');
    assert.throws(() => captureIdentity(alias, file, execute));
    assert.equal(calls, 2);
  }
  assert.throws(() => captureIdentity('picker-vps', path.join(pinDir, 'bad-capture.json'), () => ({ status: 0,
    stdout: pin.machineIdHash + '\n' + syntheticKey, stderr: 'different fingerprint' })), /capture refused/);
});

test('installer emits only the allowlisted failing stage and publishes only verified bytes', async () => {
  const archive = Buffer.from('synthetic archive'), binary = Buffer.from('synthetic binary');
  const base = { platform: 'linux', uid: 0, arch: 'x64', fetchImpl: async () => ({ ok: true, arrayBuffer: async () => archive }),
    decompress: () => binary, publish: async () => {}, pins: { x64: { archive: sha(archive), binary: sha(binary) } } };
  const secretError = () => { throw Error('private failure details'); };
  for (const [category, change] of [
    ['platform', { platform: 'win32' }], ['download', { fetchImpl: secretError }],
    ['archive checksum', { pins: { x64: { archive: 'wrong' } } }], ['decompress', { decompress: secretError }],
    ['binary checksum', { decompress: () => Buffer.from('wrong') }], ['install', { publish: secretError }],
  ]) await assert.rejects(installRestic({ ...base, ...change }), error => error.message === 'Restic installation refused: ' + category + '.');
  let installed = false; await installRestic({ ...base, publish: async value => { assert.deepEqual(value, binary); installed = true; } });
  assert(installed);
});

test('installer reads a local archive without fetching and refuses unverified or missing bytes', async t => {
  const archive = Buffer.from('synthetic cached archive'), binary = Buffer.from('synthetic cached binary');
  const archiveFile = await fixture(t, archive);
  let downloads = 0, decompressions = 0, publications = 0;
  const options = { platform: 'linux', uid: 0, arch: 'x64', archiveFile,
    fetchImpl: () => { downloads++; throw Error('unexpected download'); },
    decompress: bytes => { decompressions++; assert.deepEqual(bytes, archive); return binary; },
    publish: async bytes => { publications++; assert.deepEqual(bytes, binary); },
    pins: { x64: { archive: sha(archive), binary: sha(binary) } } };
  await installRestic(options);
  assert.equal(publications, 1); assert.equal(decompressions, 1);
  await writeFile(archiveFile, 'corrupt synthetic archive');
  await assert.rejects(installRestic(options), { message: 'Restic installation refused: archive checksum.' });
  assert.equal(decompressions, 1);
  await writeFile(archiveFile, archive);
  await assert.rejects(installRestic({ ...options, decompress: () => Buffer.from('wrong binary') }),
    { message: 'Restic installation refused: binary checksum.' });
  for (const file of [archiveFile + '-missing', '']) {
    await assert.rejects(installRestic({ ...options, archiveFile: file }), { message: 'Restic installation refused: archive read.' });
  }
  assert.equal(publications, 1); assert.equal(downloads, 0);
});
