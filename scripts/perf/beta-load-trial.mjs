#!/usr/bin/env node
import { fork, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { parse } from './beta/config.mjs';

const c = parse();
if (c.help) {
  console.log('Synthetic beta trial: node scripts/perf/beta-load-trial.mjs [--smoke] [--groups 50 --seconds 3600 --actions 15]\n' +
    '[--max-open-contexts 128 --streams-global 512 --cold-global 4 --cold-pending 256 --cold-deadline-ms 30000]\n' +
    '[--plugin-clients 150 --plugin-rate 75 --plugin-global 256] [--phases headroom,extra-tabs,cold,lifecycle,overload,restart,backup,soak]\n' +
    '[--out .local/beta/receipt.json] [--serve --host 127.0.0.1 --port 0 --key-file .local/beta-control.key]\n' +
    '[--target http://127.0.0.1:CONTROL_PORT --key-file .local/beta-control.key]\nSee docs/perf/beta-load-trial.md.');
} else if (Number(process.versions.node.split('.')[0]) !== 24 || Number(process.versions.node.split('.')[1]) < 20) {
  throw new Error('Use Node 24.20.0 or newer 24.x.');
} else if (c.serve) {
  await import('./beta/host.mjs');
} else {
  const out = path.resolve(c.out ?? `.local/beta-${Date.now()}/receipt.json`);
  await mkdir(path.dirname(out), { recursive: true });
  const log = createWriteStream(out + '.jsonl', { flags: 'wx', mode: 0o600 });
  await once(log, 'open');
  let child, target = c.target, token, logError, verifiedControl, stopped = false;
  log.on('error', error => { logError = error; });
  const append = row => {
    if (logError) throw logError;
    if (log.writableLength > 16 * 1024 * 1024) throw new Error('Generator telemetry sink is too slow.');
    log.write(JSON.stringify(row) + '\n');
  };
  const started = new Date().toISOString();
  const childArgs = process.argv.slice(2).filter((arg, index, args) => !['--out', '--key-file', '--host', '--port'].includes(arg) &&
    !['--out', '--key-file', '--host', '--port'].includes(args[index - 1]) && !/^--(?:out|key-file|host|port)=/.test(arg));
  try {
    if (!target) {
      token = randomBytes(32).toString('hex');
      child = fork(new URL('./beta/host.mjs', import.meta.url), childArgs, {
        env: { ...process.env, BETA_CONTROL_KEY: token }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      });
      child.stdout.on('data', () => {});
      child.stderr.on('data', data => process.stderr.write(data));
      const ready = await new Promise((resolve, reject) => {
        child.on('message', message => { if (message.type === 'ready') resolve(message); else if (message.type === 'progress') console.log(message.value); });
        child.once('error', reject); child.once('exit', code => reject(new Error(`Synthetic host exited before ready (${code}).`)));
      });
      target = `http://127.0.0.1:${ready.controlPort}`;
    } else {
      if (!c['key-file']) throw new Error('--target requires --key-file from the isolated synthetic host.');
      token = (await readFile(path.resolve(c['key-file']), 'utf8')).trim();
    }
    const origin = new URL(target);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use a synthetic control origin.');
    const control = async (route, body, deadline = 600000) => {
      const response = await fetch(new URL(route, origin), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(deadline),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? `Control HTTP ${response.status}`); return value;
    };
    const identity = await control('/identity');
    if (identity.kind !== 'isolated-synthetic-beta-v1') throw new Error('Target is not an isolated synthetic trial host.');
    verifiedControl = control;
    if (identity.fixture.seed !== c.seed || identity.config.groups !== c.groups) throw new Error('Driver seed/groups must match the synthetic host.');
    const product = new URL(origin); product.port = identity.port;
    const { drive } = await import('./beta/driver.mjs');
    const result = await drive({ c, identity, base: product.origin, control, log: append });
    const omitted = new Set(['host', 'target', 'key-file', 'out', 'port', 'serve', 'help']);
    const publicConfig = value => Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
    const { clients, groups, ...population } = identity.fixture;
    const receipt = { schemaVersion: 1, purpose: 'invite-only synthetic beta load trial', sourceSHA: identity.sourceSHA,
      sourceTreeSHA256: identity.sourceTreeSHA256, sourceDirty: identity.dirty, generatorSHA: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
      workingDiffSHA256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'], { windowsHide: true })).digest('hex'),
      started, finished: new Date().toISOString(), seed: c.seed, runtimeConfig: publicConfig(identity.config), workloadConfig: publicConfig(c),
      hardware: identity.hardware, runtimeSettings: identity.runtimeSettings, population: { ...population, groups: groups.map(({ members, ...group }) => ({ ...group, rosterSize: members.length })) },
      hooks: ['requestContextFor models a synthetic HTTPS gateway',
        'testEventTransform tags SSE at the actual picker emitter; no HTTP/CLI exposure', 'all OAuth/Platform/Hiscores/original-sync transports stubbed',
        'offline synthetic registry/session/key provisioning, existing schema and default retention'],
      smoke: c.smoke, ...result };
    await writeFile(out, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await control('/stop');
    stopped = true;
    console.log(`Receipt: ${out}`);
    console.log(JSON.stringify({ sourceSHA: receipt.sourceSHA, smoke: c.smoke, population: { groups: groups.filter(g => !g.nearLimit && !g.lifecycle).length, logins: population.logins, characters: population.characters, storedKeys: population.storedKeys },
      isolationAndDurability: result.gates.isolationAndDurability, phases: result.gates.phases, acceptance: result.gates.acceptance }));
    if (result.gates.isolationAndDurability !== 'pass' || result.lifecycle?.passed === false || result.nearLimit?.passed === false || result.captures.some(c => c.error)) process.exitCode = 1;
  } catch (error) {
    await writeFile(out + '.failure.json', JSON.stringify({ started, failed: new Date().toISOString(), error: error.message }), { flag: 'wx' });
    throw error;
  } finally {
    if (verifiedControl && !stopped) await verifiedControl('/stop', undefined, 30000).catch(error => process.stderr.write(`Synthetic host cleanup: ${error.message}\n`));
    log.end(); await once(log, 'finish');
    if (child && child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.disconnect();
      await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 30000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
  }
}
