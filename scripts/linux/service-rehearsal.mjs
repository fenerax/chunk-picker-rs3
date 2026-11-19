import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { packRelative } from '../../app/packs.mjs';
import { openRegistry } from '../../app/storage/registry.mjs';
import { copyTree, encode, exists, json, noLinks, outside, sha } from './files.mjs';
import { verifyServiceBackup, pickerPath } from './service-checkpoint.mjs';
import { verifyRecoveryBundle } from './recovery-bundle.mjs';
import { restoreServiceStopped } from './service-recovery.mjs';
import { readRelease } from './runtime.mjs';
import { runProbe } from './recovery.mjs';

function childPath(root, relative) {
  packRelative(relative.split(path.sep).join('/'));
  const file = path.resolve(root, relative); outside(file, root); return file;
}
async function ports() {
  const servers = [net.createServer(), net.createServer()];
  try {
    for (const server of servers) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return servers.map(server => server.address().port);
  } finally { await Promise.all(servers.filter(server => server.listening).map(server => new Promise(resolve => server.close(resolve)))); }
}
async function verifyRuntime(configFile) {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./service-rehearsal-start.mjs', import.meta.url)), configFile],
    { timeout: 180000, maxBuffer: 65536, windowsHide: true, env: { ...process.env, RS3_SIGNIN: 'off', NODE_OPTIONS: '', NODE_PATH: '' } });
  const result = JSON.parse(stdout);
  if (result.ready !== true) throw Error('Isolated service did not become ready.');
  return result;
}

// Source is the immutable downloaded snapshot/rebuild pair, never live roots.
// Leave all scratch/evidence in place on success and failure for private review.
export async function rehearseService({ source, scratch, probe = runProbe, start = verifyRuntime, now = () => performance.now() }) {
  source = path.resolve(source); scratch = path.resolve(scratch);
  outside(source, scratch); outside(scratch, source); await noLinks(source);
  const began = now(), backup = path.join(source, 'snapshot'), rebuild = path.join(source, 'rebuild');
  const manifest = await verifyServiceBackup(backup);
  if (manifest.format !== 'picker-service-recovery-v2') throw Error('A v2 service capture with its ledger is required for a clean-host rehearsal.');
  if (await exists(path.join(backup, 'owned-closure.json'))) throw Error('Owned catalogue rehearsal requires separately configured isolated catalogue roots.');
  const bundle = await verifyRecoveryBundle(rebuild, manifest.releasePointerSha256);
  const pointer = await json(path.join(rebuild, 'current.json'));
  const originalFile = childPath(path.join(rebuild, 'release'), path.relative(bundle.selected, pointer.config.path));
  const originalBytes = await readFile(originalFile);
  if (sha(originalBytes) !== pointer.config.sha256) throw Error('Rebuild configuration pin differs.');
  const original = JSON.parse(originalBytes);
  if (!original.multiPicker) throw Error('Multi-picker release required.');
  // Refuse a scratch ancestor/descendant of every source-configured live root,
  // even if this command is accidentally run on the original host.
  for (const root of [original.dataDir, original.coreRoot, original.packsDir, ...['registryDir', 'pickerRoot', 'tombstoneDir'].map(key => original.multiPicker[key])].filter(Boolean)) {
    outside(root, scratch); outside(scratch, root);
  }
  await noLinks(path.dirname(scratch));
  await mkdir(scratch, { mode: 0o700 }); // exclusive: cannot reuse a live tree
  const receiptFile = path.join(scratch, 'restore-receipt.json');
  let phase = 'runtime';
  const receipt = { sourceManifestSha256: sha(await readFile(path.join(backup, 'manifest.json'))), snapshotAt: manifest.snapshotAt,
    sourcePointerSha256: manifest.releasePointerSha256, ledger: manifest.ledger, failures: [] };
  try {
    const runtime = path.join(scratch, 'runtime'); await copyTree(path.join(rebuild, 'release'), runtime);
    const pinsRoot = path.join(scratch, 'pins'); await mkdir(pinsRoot);
    const pinMap = new Map();
    for (const [index, pin] of bundle.pins.entries()) {
      const dest = path.join(pinsRoot, String(index));
      await copyTree(path.dirname(childPath(rebuild, pin.file)), dest);
      pinMap.set(pin.path, { path: path.join(dest, path.basename(pin.file)), sha256: pin.sha256 });
    }
    const repin = pin => {
      if (!pin) return undefined;
      const next = pinMap.get(pin.path);
      if (!next || next.sha256 !== pin.sha256) throw Error('Rebuild lacks a configured input.'); return next;
    };
    // Pack loaders select id/version below packsDir. Recreate that layout from
    // verified payloads without reading a single original absolute pin path.
    const packsDir = path.join(scratch, 'packs'); await mkdir(packsDir);
    const packs = {};
    for (const [name, pin] of Object.entries(original.packs ?? {})) {
      const captured = repin(pin), pack = await json(captured.path);
      const relative = packRelative(pack.id + '/' + pack.version), dest = childPath(packsDir, relative);
      await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
      await copyTree(path.dirname(captured.path), dest);
      packs[name] = { ...captured, path: path.join(dest, path.basename(captured.path)) };
    }
    const [port, loopbackPort] = await ports();
    const settings = { dataDir: path.join(scratch, 'legacy'), controlDir: path.join(scratch, 'control'),
      backupDir: path.join(scratch, 'backups'), scratchRoot: path.join(scratch, 'probes'), minFreeBytes: 0,
      multiPicker: { ...original.multiPicker, registryDir: path.join(scratch, 'registry'), pickerRoot: path.join(scratch, 'pickers'), tombstoneDir: path.join(scratch, 'ledger') } };
    delete settings.multiPicker.recoveryInputs;
    const publicOriginFile = path.join(scratch, 'origin'); await writeFile(publicOriginFile, 'https://picker.example', { flag: 'wx', mode: 0o600 });
    const config = { coreRoot: childPath(runtime, path.relative(bundle.selected, original.coreRoot)), dataDir: settings.dataDir,
      datasetId: original.datasetId, runtimeOptions: original.runtimeOptions, multiPicker: settings.multiPicker,
      host: '127.0.0.1', port, loopbackPort, publicOriginFile, packsDir, packs,
      selection: repin(original.selection), profile: repin(original.profile), addons: repin(original.addons) };
    const configFile = path.join(scratch, 'config.json'), bytes = encode(config); await writeFile(configFile, bytes, { flag: 'wx', mode: 0o600 });
    settings.current = path.join(scratch, 'current.json');
    await writeFile(settings.current, encode({ config: { path: configFile, sha256: sha(bytes) } }), { flag: 'wx', mode: 0o600 });
    const release = await readRelease(settings.current, settings.dataDir), verified = [];
    phase = 'gameplay';
    const result = await restoreServiceStopped({ settings, backup, release, initializeLedger: true, assertStopped: async () => {},
      probe: async (...args) => {
        const document = await probe(...args);
        verified.push({ pickerId: path.basename(path.dirname(args[1])), members: document.state.members.map(m => m.id),
          historyEvents: document.state.history?.length ?? 0, revision: document.state.revision });
        return document;
      } });
    receipt.restore = result; receipt.pickers = verified;
    receipt.uninitializedPickers = manifest.pickers.filter(p => !p.initialized && !p.absent).map(p => p.id);
    receipt.pastMaps = (await json(path.join(backup, 'registry.json'))).pastMaps?.length ?? 0;
    receipt.datasetClosure = { verified: true, pins: bundle.pins.map(({ sha256 }) => sha256), inputs: manifest.inputs };
    receipt.credentials = { imported: result.credentialsRestored, policy: 'Fresh credentials only; old sessions, invites, plugin and overlay keys are excluded.' };
    if (result.quarantined.length) throw Error('Quarantined pickers remain; gameplay recovery is incomplete.');
    const runtimeResult = await start(configFile);
    receipt.keys = runtimeResult?.keys ?? { verified: false };
    receipt.gameplayRecoveryMs = now() - began;
    phase = 'access-reclaim';
    const accessBegan = now(); let registry;
    try {
      registry = await openRegistry({ ...settings.multiPicker, legacyDir: settings.dataDir });
      receipt.tombstones = await registry.reconcileTombstones();
      let reclaimed = 0; const unavailableAccounts = [];
      for (const account of registry.listAccounts()) {
        let claim;
        try { claim = await registry.issueRelinkCode(account.id); }
        catch (error) {
          if (error.status !== 409) throw error;
          unavailableAccounts.push(account.id); continue;
        }
        const subject = 'restore-rehearsal-' + reclaimed;
        const claimed = await registry.claimIdentity(claim.code, 'discord', subject);
        if (claimed.id !== account.id) throw Error('Access reclaim selected another account.');
        reclaimed++;
      }
      receipt.access = { reclaimedAccounts: reclaimed, unavailableAccounts,
        method: 'Local synthetic identity claim; external provider, human verification and unavailable accounts need private operator follow-up.' };
    } finally { await registry?.close(); }
    receipt.accessReclaimMs = now() - accessBegan;
    receipt.totalMs = now() - began; receipt.result = 'success';
    // Confirm restored, initialized pickers exist independently of the source.
    const progress = await json(path.join(settings.controlDir, 'service-restore', 'progress.json'));
    for (const picker of manifest.pickers.filter(p => p.initialized && !p.absent)) {
      const status = progress.pickers.find(row => row.id === picker.id)?.status;
      if (status !== 'excluded' && (status !== 'restored' || !await exists(path.join(pickerPath(settings, picker), 'state.json')))) throw Error('Restored picker missing.');
    }
    await writeFile(receiptFile, encode(receipt), { flag: 'wx', mode: 0o600 }); return receipt;
  } catch (error) {
    receipt.result = 'failed'; receipt.failures.push({ phase, message: error.message }); receipt.totalMs = now() - began;
    await writeFile(receiptFile, encode(receipt), { flag: 'wx', mode: 0o600 }); throw error;
  }
}
