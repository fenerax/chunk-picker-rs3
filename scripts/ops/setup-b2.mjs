import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { installSecrets, installedB2Id, request, run, sshAlias } from './setup-common.mjs';

export const lifecycle = Object.freeze([{ fileNamePrefix: '', daysFromUploadingToHiding: null, daysFromHidingToDeleting: 31 }]);
export const uploadCapabilities = Object.freeze(['listBuckets', 'listFiles', 'readFiles', 'writeFiles']);
export const cleanupCapabilities = Object.freeze([...uploadCapabilities, 'deleteFiles']);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export function protectedBucket(bucket) {
  if (bucket.bucketType !== 'allPrivate' || bucket.lifecycleRules?.length !== 1
    || bucket.lifecycleRules[0].fileNamePrefix !== '' || bucket.lifecycleRules[0].daysFromUploadingToHiding != null
    || bucket.lifecycleRules[0].daysFromHidingToDeleting !== 31) throw Error('Bucket protection differs; refuse to weaken it.');
}
function field(item, name) { return item.fields?.find(row => row.label === name)?.value; }
export async function setupB2({ keyFile, alias, bucketName, vault }, { fetchImpl = fetch, execute = run } = {}) {
  sshAlias(alias);
  if (!/^[a-z0-9][a-z0-9-]{5,49}$/.test(bucketName ?? '') || !vault || vault.startsWith('-')) throw Error('Bucket and 1Password vault required.');
  const temporary = JSON.parse(await readFile(keyFile, 'utf8'));
  if (!temporary.applicationKeyId || !temporary.applicationKey) throw Error('Temporary setup key required.');
  const auth = await request('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: 'Basic ' + Buffer.from(temporary.applicationKeyId + ':' + temporary.applicationKey).toString('base64') } }, fetchImpl);
  const storage = auth.apiInfo?.storageApi ?? auth, api = new URL(storage.apiUrl);
  if (api.protocol !== 'https:' || !/^api\d*\.backblazeb2\.com$/.test(api.hostname) || api.port || api.username || api.password) throw Error('B2 API origin refused.');
  const call = (method, body) => request(new URL('/b2api/v3/' + method, api), {
    method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl);
  let buckets = (await call('b2_list_buckets', { accountId: auth.accountId, bucketName })).buckets;
  if (buckets.length > 1) throw Error('Bucket identity ambiguous.');
  const bucket = buckets[0] ?? await call('b2_create_bucket', { accountId: auth.accountId, bucketName, bucketType: 'allPrivate', lifecycleRules: lifecycle });
  protectedBucket(bucket);
  const keys = []; let startApplicationKeyId;
  do {
    const page = await call('b2_list_keys', { accountId: auth.accountId, maxKeyCount: 1000, ...(startApplicationKeyId ? { startApplicationKeyId } : {}) });
    keys.push(...page.keys); startApplicationKeyId = page.nextApplicationKeyId;
  } while (startApplicationKeyId);
  const repository = 'b2:' + bucketName + ':chunk-picker', title = 'Chunk picker B2 recovery ' + bucketName;
  const items = JSON.parse(execute('op', ['item', 'list', '--vault', vault, '--format=json'])).filter(row => row.title === title);
  if (items.length > 1) throw Error('Duplicate recovery items require reconciliation.');
  const installed = installedB2Id(alias, execute);
  const matches = (key, caps) => key.bucketId === bucket.bucketId && key.namePrefix === 'chunk-picker/' && same(key.capabilities, caps);
  const create = async (suffix, capabilities) => {
    const keyName = 'chunk-picker-' + bucketName + '-' + suffix;
    for (const orphan of keys.filter(key => key.keyName === keyName)) {
      if (!matches(orphan, capabilities) || orphan.applicationKeyId === installed) throw Error('Key scope requires reconciliation.');
      // Only orphaned setup keys are revoked, never any stored/installed key.
      await call('b2_delete_key', { applicationKeyId: orphan.applicationKeyId });
    }
    const created = await call('b2_create_key', { accountId: auth.accountId, keyName, capabilities, bucketId: bucket.bucketId, namePrefix: 'chunk-picker/' });
    keys.push(created); return created;
  };
  let recovery;
  if (items.length) {
    recovery = JSON.parse(execute('op', ['item', 'get', items[0].id, '--vault', vault, '--format=json', '--reveal']));
    if (field(recovery, 'repository') !== repository || field(recovery, 'bucket-id') !== bucket.bucketId
      || !field(recovery, 'repository-password') || !field(recovery, 'cleanup-key') || !field(recovery, 'upload-key')
      || !keys.some(key => key.applicationKeyId === field(recovery, 'upload-id') && matches(key, uploadCapabilities))
      || !keys.some(key => key.applicationKeyId === field(recovery, 'cleanup-id') && matches(key, cleanupCapabilities))) throw Error('Recovery item differs.');
  } else {
    if (installed) throw Error('Installed repository has no independent recovery item.');
    const cleanup = await create('cleanup', cleanupCapabilities);
    const upload = await create('vps', uploadCapabilities);
    recovery = { title, category: 'SECURE_NOTE', fields: Object.entries({ repository, 'bucket-id': bucket.bucketId,
      'repository-password': randomBytes(48).toString('base64url'), 'cleanup-id': cleanup.applicationKeyId, 'cleanup-key': cleanup.applicationKey, 'upload-id': upload.applicationKeyId, 'upload-key': upload.applicationKey })
      .map(([label, value]) => ({ label, type: ['repository-password', 'cleanup-key', 'upload-key'].includes(label) ? 'CONCEALED' : 'STRING', value })) };
    execute('op', ['item', 'create', '-', '--vault', vault, '--format=json'], JSON.stringify(recovery));
    // Check durable storage before installing anything on the VPS.
    const saved = JSON.parse(execute('op', ['item', 'get', title, '--vault', vault, '--format=json', '--reveal']));
    for (const name of ['repository', 'bucket-id', 'repository-password', 'cleanup-id', 'cleanup-key', 'upload-id', 'upload-key']) if (field(saved, name) !== field(recovery, name)) throw Error('Independent recovery item verification failed.');
  }
  if (installed && installed !== field(recovery, 'upload-id')) throw Error('Installed key identity differs.');
  // The independently stored upload material makes any interrupted publication
  // safe to resume, including a partial remote filesystem write.
  installSecrets(alias, { 'restic-password': field(recovery, 'repository-password'), 'b2-key': field(recovery, 'upload-key'), 'b2-account': field(recovery, 'upload-id') }, execute);
  return { protected: true }; // No bucket identifiers, key values or passwords.
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(['key-file', 'ssh', 'bucket', 'vault'].map(name => [name, { type: 'string' }])) });
    await setupB2({ keyFile: values['key-file'], alias: values.ssh, bucketName: values.bucket, vault: values.vault });
    process.stdout.write('Private backup storage and independent recovery item configured.\n');
  } catch { process.stderr.write('B2 setup refused; no credentials printed.\n'); process.exitCode = 1; }
}
