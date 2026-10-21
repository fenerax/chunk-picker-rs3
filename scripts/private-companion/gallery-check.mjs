// Private companion tool. Run through with-light.ps1 directly with node.
// The checker stays byte-for-byte unchanged; only its working directory is staged.
import path from 'node:path';
import net from 'node:net';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, lstat, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const companion = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error('Gallery check failed.'), { galleryCode: code }); };
const check = (value, code) => { if (!value) fail(code); };
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
let stage = 'arguments';

async function verifyLightLock() {
  const directory = process.env.RS3_LIGHT_LOCK_PATH
    || 'C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools/locks/light.lock';
  const owner = (await readFile(path.join(directory, 'owner'), 'utf8')).replace(/^\uFEFF/, '').trim();
  const match = /^light pid=(\d+) \S+$/.exec(owner);
  check(match && Number(match[1]) === process.ppid, 'LIGHT_LOCK_OWNERSHIP');
  process.kill(Number(match[1]), 0);
}

async function containedFile(directory, filename) {
  check(path.isAbsolute(filename) && inside(directory, filename), 'INPUT_CONTAINMENT');
  const absolute = path.resolve(filename), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    check(!(await lstat(current)).isSymbolicLink(), 'INPUT_LINK');
  }
  check((await lstat(filename)).isFile(), 'INPUT_FILE');
  check(inside(await realpath(directory), await realpath(filename)), 'INPUT_CONTAINMENT');
  return filename;
}

async function scratchPort() {
  for (let port = 8900; port <= 8999; port++) {
    const probe = net.createServer();
    const available = await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  fail('NO_SCRATCH_PORT');
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index], value = process.argv[index + 1];
    check(['--core', '--checker', '--receipt'].includes(flag) && value && path.isAbsolute(value) && !Object.hasOwn(options, flag), 'INVALID_ARGUMENT');
    options[flag] = value;
  }
  check(options['--core'] && options['--checker'], 'MISSING_ARGUMENT');
  stage = 'light-lock'; await verifyLightLock();
  stage = 'pinned-inputs';
  const core = await realpath(options['--core']), checker = await realpath(await containedFile(companion, options['--checker']));
  check((await lstat(options['--checker'])).isFile() && !(await lstat(options['--checker'])).isSymbolicLink(), 'CHECKER_FILE');
  const receipt = JSON.parse(await readFile(await containedFile(companion, options['--receipt'] ?? path.join(companion, 'companion.json')), 'utf8'));
  check(receipt.schemaVersion === 1 && path.isAbsolute(receipt.coreRoot ?? '') && core === await realpath(receipt.coreRoot), 'COMPANION_CORE');
  const selectionPath = await containedFile(companion, path.join(receipt.packsDir ?? path.join(companion, 'packs'), 'selection.json'));
  const selection = JSON.parse(await readFile(selectionPath, 'utf8'));
  check(JSON.stringify(selection) === JSON.stringify(receipt.packs), 'PACK_SELECTION_CHANGED');
  for (const record of [receipt.profile, receipt.addons]) {
    check(record && /^[a-f0-9]{64}$/.test(record.sha256), 'PIN_REQUIRED');
    check(sha(await readFile(await containedFile(companion, record.path))) === record.sha256, 'PIN_CHANGED');
  }
  const addon = JSON.parse(await readFile(receipt.addons.path, 'utf8'));
  const catalogueName = 'app/web/gallery-catalogue.mjs';
  const catalogueRecord = addon.files.find(record => record.path === catalogueName);
  check(catalogueRecord, 'GALLERY_CATALOGUE_REQUIRED');
  const catalogue = await readFile(await containedFile(path.dirname(receipt.addons.path), path.join(path.dirname(receipt.addons.path), catalogueName)));
  check(sha(catalogue) === catalogueRecord.sha256, 'GALLERY_CATALOGUE_CHANGED');
  const fixtureName = 'tests/fixtures/original-sync/capture.json';
  const fixtureBytes = await readFile(await containedFile(companion, path.join(companion, 'checks/private-source', fixtureName)));
  check(sha(fixtureBytes) === receipt.privateFiles.find(record => record.path === fixtureName)?.sha256, 'ORIGINAL_FIXTURE_CHANGED');
  const capture = JSON.parse(fixtureBytes);
  const cdpName = 'scripts/perf/cdp.mjs';
  const cdpBytes = await readFile(await containedFile(companion, path.join(companion, 'checks/private-source', cdpName)));
  check(sha(cdpBytes) === receipt.privateFiles.find(record => record.path === cdpName)?.sha256, 'CDP_HELPER_CHANGED');

  const local = path.join(companion, '.local'); await mkdir(local, { recursive: true });
  check(!(await lstat(local)).isSymbolicLink() && inside(await realpath(companion), await realpath(local)), 'SCRATCH_CONTAINMENT');
  const scratch = await mkdtemp(path.join(local, 'gallery-'));
  const previous = { cwd: process.cwd(), argv: process.argv, framed: process.env.FRAMED, cdpPort: process.env.RS3_SCRATCH_CDP_PORT };
  const originalSpawn = childProcess.spawn, browsers = [];
  let application, stopChild;
  try {
    stage = 'checker-layout';
    for (const name of ['scripts/perf', 'app/web', '.local', 'save']) await mkdir(path.join(scratch, name), { recursive: true });
    await writeFile(path.join(scratch, cdpName), cdpBytes, { flag: 'wx' });
    await writeFile(path.join(scratch, catalogueName), catalogue, { flag: 'wx' });
    const { galleryEntries } = await import(pathToFileURL(path.join(scratch, catalogueName)).href);
    ({ stopChild } = await import(pathToFileURL(path.join(scratch, 'scripts/perf/cdp.mjs')).href));

    stage = 'runtime-selection';
    for (const key of ['RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR',
      'RS3_PARITY_INSTANT', 'RS3_PARITY_RANDOM_SEED', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
    Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: (receipt.packsDir ?? path.join(companion, 'packs')),
      RS3_PACK_SELECTION: selectionPath, RS3_DATASET_PROFILE: receipt.profile.path, RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256,
      RS3_PRIVATE_ADDON: receipt.addons.path, RS3_PRIVATE_ADDON_SHA256: receipt.addons.sha256, RS3_TASK_WORKER_MODE: 'process' });
    const dataDir = path.join(scratch, 'save');
    process.argv = [process.execPath, fileURLToPath(import.meta.url), '--data-dir', dataDir];
    const { createServer } = await import(pathToFileURL(path.join(core, 'app/server.mjs')).href);
    stage = 'scratch-server';
    application = await createServer({ dataDir, host: '127.0.0.1', port: await scratchPort(), loopbackPort: undefined,
      predictionPrewarm: false, idleMemoryOptions: { delayMs: 1000 }, originalSync: {
        retries: 0, now: () => new Date(capture.metadata.capturedAt), fetchImpl: async (url, request) => {
          const parsed = new URL(url), match = /^\/maps\/(qxa|qxb)\/(\w+)\.json$/.exec(parsed.pathname);
          check(request?.method === 'GET' && parsed.origin === capture.metadata.sourceOrigin && !parsed.search && !parsed.hash
            && (parsed.pathname === '/version.json' || match && capture.metadata.sourceFields.includes(match[2])), 'ORIGINAL_FIXTURE_REQUEST');
          return new Response(JSON.stringify(match ? capture.maps[match[1]][match[2]] ?? null : capture.metadata.sourceVersion ?? null));
        },
      } });
    await application.listen();
    const origin = `http://127.0.0.1:${application.address().port}`;
    const invitation = await fetch(origin + '/api/invites', { method: 'POST', headers: { Origin: origin,
      Authorization: `Bearer ${application.store.getAccessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Disposable gallery check', admin: true }) });
    check(invitation.status === 201, 'SCRATCH_INVITATION');
    const inviteFile = path.join(scratch, 'admin-invite.txt');
    await writeFile(inviteFile, (await invitation.json()).link + '\n', { flag: 'wx', mode: 0o600 });

    // Keep exact Chrome child handles so cleanup also covers failures before
    // the external checker's own browser try/finally has started.
    childProcess.spawn = function (...args) {
      const child = originalSpawn.apply(this, args);
      if (Array.isArray(args[1]) && args[1].includes('--headless=new')) browsers.push(child);
      return child;
    };
    syncBuiltinESMExports();
    process.chdir(scratch);
    const results = {};
    for (const mode of ['plain', 'framed']) {
      stage = `gallery-${mode}`;
      // The application is listening already, so its occupied port cannot be
      // selected by this probe. CDP never asks Windows for an ephemeral port.
      const cdpPort = await scratchPort();
      check(cdpPort !== application.address().port, 'CDP_APPLICATION_PORT_COLLISION');
      process.env.RS3_SCRATCH_CDP_PORT = String(cdpPort);
      process.env.FRAMED = mode === 'framed' ? '1' : '0';
      process.argv = [process.execPath, checker, origin, inviteFile];
      let summary;
      const savedLog = console.log;
      console.log = (...values) => {
        const match = /^(\d+)\/(\d+) previews ready$/.exec(values.join(' '));
        if (match) summary = { ready: Number(match[1]), total: Number(match[2]) };
      };
      try { await import(pathToFileURL(checker).href + `?companion-gallery=${mode}`); }
      finally { console.log = savedLog; }
      check(summary && summary.total === galleryEntries.length, 'CHECKER_SUMMARY');
      results[mode] = { ...summary, applicationPort: application.address().port, cdpPort };
    }
    return { passed: Object.values(results).every(result => result.ready === result.total), ...results };
  } finally {
    const completedStage = stage;
    stage = 'cleanup';
    childProcess.spawn = originalSpawn; syncBuiltinESMExports();
    process.chdir(previous.cwd); process.argv = previous.argv;
    if (previous.framed === undefined) delete process.env.FRAMED; else process.env.FRAMED = previous.framed;
    if (previous.cdpPort === undefined) delete process.env.RS3_SCRATCH_CDP_PORT; else process.env.RS3_SCRATCH_CDP_PORT = previous.cdpPort;
    let cleanupFailed = false;
    for (const child of browsers) try { await stopChild(child); } catch { cleanupFailed = true; }
    try { await application?.close(); } catch { cleanupFailed = true; }
    check(path.dirname(scratch) === local && inside(await realpath(local), await realpath(scratch)), 'CLEANUP_CONTAINMENT');
    if (cleanupFailed) fail('OWNED_PROCESS_CLEANUP');
    await rm(scratch, { recursive: true, force: true });
    stage = completedStage;
  }
}

// Keep operator diagnostics to counts and a safe stage/code, never invite URLs
// or renderer messages which may contain private application values.
const savedConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
for (const method of Object.keys(savedConsole)) console[method] = () => {};
try {
  const result = await main();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ passed: false, stage,
    code: /^[A-Z_]+$/.test(error.galleryCode ?? '') ? error.galleryCode : 'GALLERY_CHECK_FAILURE' }) + '\n');
  process.exitCode = 1;
} finally { Object.assign(console, savedConsole); }
