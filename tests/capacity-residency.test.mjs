// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { parseRunOptions, runManifest } from '../scripts/perf/capacity/memory-profile.mjs';
import { COLD_OPEN_ADMISSION } from '../app/picker-admission.mjs';
import { MP7_DEFAULTS, createPickerLimits } from '../app/security/picker-limits.mjs';
import { createPickerRouter } from '../app/picker-router.mjs';
import { verifySampleProfiles } from '../scripts/perf/capacity/sampling.mjs';

const defaults = { maxOpenContexts: 7, idleCloseMs: 600000, coldStartsPerAccount: 1, coldStartsGlobal: 1,
  coldAdmission: { maxPending: 64, perAccount: 2, deadlineMs: 2000 } };
const trial = { ...defaults, maxOpenContexts: 128, coldStartsGlobal: 4,
  coldAdmission: { maxPending: 256, perAccount: 2, deadlineMs: 30000 } };
const trialOptions = { maxOpenContexts: 128, idleCloseMs: 600000, coldStartsPerAccount: 1, coldStartsGlobal: 4,
  coldOpenAdmission: trial.coldAdmission };

test('residency CLI defaults, both spellings and invalid selections', () => {
  assert.equal(parseRunOptions([]).residency, 'default');
  for (const value of ['default', 'trial']) {
    assert.equal(parseRunOptions(['--residency', value]).residency, value);
    assert.equal(parseRunOptions([`--residency=${value}`]).residency, value);
  }
  for (const value of ['', 'other', 'TRIAL']) assert.throws(() => parseRunOptions(['--residency', value]), /--residency default or trial/);
  assert.throws(() => parseRunOptions(['--residency']), /argument missing|requires an argument/i);
});

test('no router option preserves every main residency constant', async () => {
  const router = createPickerRouter({ registry: {}, legacy: {}, pickerLimits: createPickerLimits() });
  try {
    assert.deepEqual(router.getResidencyLimits(), defaults);
    assert.equal(defaults.coldStartsPerAccount, MP7_DEFAULTS.coldStartsPerAccount);
    assert.equal(defaults.coldStartsGlobal, MP7_DEFAULTS.coldStartsGlobal);
    for (const [key, value] of Object.entries(defaults.coldAdmission)) assert.equal(value, COLD_OPEN_ADMISSION[key]);
  } finally { await router.close(); }
});

test('trial router uses four cold permits and the injected admission deadline', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), timers = [], events = [];
  const router = createPickerRouter({ ...trialOptions, pickerLimits: createPickerLimits(trialOptions),
    admissionClock: { setTimeout(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout() {} },
    onAdmission(event) { events.push(event); if (event.event === 'queued' && event.pending === 4) entered.resolve(); },
    registry: { getPicker: () => ({ lifecycle: 'active', provisioning: 'ready' }), pickerDirectory: id => `/synthetic-residency/${id}` },
    legacy: { authenticate: request => ({ kind: 'account', ...request.owner }) },
    openContext: async () => { await release.promise; return { close: async () => {}, handle: async (_request, response) => { response.writeHead(200); response.end('{}'); } }; } });
  const send = () => {
    const request = Readable.from([]), headers = new Map();
    Object.assign(request, { owner: { accountId: randomUUID(), pickerId: `p_${randomUUID().replaceAll('-', '')}` },
      headers: { host: 'localhost' }, method: 'GET', url: '/api/state', complete: true, socket: { remoteAddress: '127.0.0.1' } });
    const response = new Writable({ write(_chunk, _encoding, done) { done(); } });
    response.setHeader = (key, value) => headers.set(key.toLowerCase(), value); response.getHeader = key => headers.get(key.toLowerCase());
    response.writeHead = status => { response.statusCode = status; response.headersSent = true; };
    return router.handle(request, response, { host: '127.0.0.1' }).then(() => response.statusCode);
  };
  const jobs = Array.from({ length: 4 }, send);
  try {
    // The admission events are synchronous once authorization has completed.
    await entered.promise;
    assert.equal(Math.max(...events.map(event => event.active)), 4);
    assert.deepEqual(router.getResidencyLimits(), trial);
    assert.equal(timers.length, 4); assert.ok(timers.every(timer => timer.ms === 30000));
    assert.equal(Math.max(...events.map(event => event.active)), 4);
  } finally { release.resolve(); await Promise.all(jobs); await router.close(); }
});

test('running HTTP diagnostics prove default and trial effective limits', async t => {
  const { createServer } = await import('../app/server.mjs');
  const { catalogue, syntheticWorld } = await import('../scripts/perf/capacity/model.mjs');
  const { buildWorld } = await import('../app/data/world.mjs');
  const { createGroupState } = await import('../app/core/state.mjs');
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.local/residency-http-', import.meta.url));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const definitions = catalogue({ chunks: 4, tasks: 2, dependencyDepth: 1, crossLinks: 1 });
  for (const [selected, options, expected] of [['default', {}, defaults], ['trial', trialOptions, trial]]) {
    const root = path.join(directory, selected);
    const app = await createServer({ dataDir: path.join(root, 'legacy'), port: 0, loopbackPort: undefined, publicOrigin: undefined,
      definitions, taskMap: {}, world: syntheticWorld(definitions, buildWorld), predictionPrewarm: false,
      initialState: createGroupState([{ id: 'owner', name: 'Synthetic owner' }, { id: 'member', name: 'Synthetic member' }]),
      multiPicker: { ...options, registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones') } });
    try {
      await app.listen();
      const get = async route => {
        const response = await fetch(`http://127.0.0.1:${app.address().port}${route}`, { headers: { Authorization: `Bearer ${app.store.getAccessToken()}` } });
        assert.equal(response.status, 200); return response.json();
      };
      assert.deepEqual((await get('/api/diagnostics')).residency, expected);
      const { verifyServerResidency } = await import('../scripts/perf/capacity/residency.mjs');
      assert.equal((await verifyServerResidency(selected, get)).residency, selected);
      await assert.rejects(verifyServerResidency(selected === 'trial' ? 'default' : 'trial', get), { code: 'residency-unverified' });
    } finally { await app.close(); }
  }
});

test('residency verification refuses absent or mismatched effective values', async () => {
  const { verifyServerResidency, residencyOptions } = await import('../scripts/perf/capacity/residency.mjs');
  assert.deepEqual(residencyOptions('default'), {});
  assert.deepEqual(residencyOptions('trial'), trialOptions);
  for (const diagnostics of [{}, { residency: defaults }, { residency: { ...trial, coldStartsGlobal: 1 } },
    { residency: { ...trial, coldAdmission: { ...trial.coldAdmission, deadlineMs: 2000 } } }]) {
    await assert.rejects(verifyServerResidency('trial', async () => diagnostics), { code: 'residency-unverified' });
  }
  await assert.rejects(verifyServerResidency('trial', async () => { throw new Error('Synthetic unavailable diagnostics'); }), { code: 'residency-unverified' });
  for (const [key, value] of Object.entries(trial)) {
    for (const field of typeof value === 'object' ? Object.keys(value) : [null]) {
      const changed = structuredClone(trial);
      if (field) changed[key][field]++; else changed[key]++;
      await assert.rejects(verifyServerResidency('trial', async () => ({ residency: changed })), { code: 'residency-unverified' });
    }
  }
});

test('manifest records requested residency without claiming unobserved application', () => {
  const manifest = runManifest({ profile: { requestedResidency: 'trial' }, format: 'format1' });
  assert.equal(manifest.requestedResidency, 'trial'); assert.equal(manifest.residency, null);
  assert.equal(manifest.residencyVerification.status, 'unverified');
});

function artifactFixture() {
  const residency = 'trial', memoryProfile = 'default', label = { residency, memoryProfile };
  const profile = { ...label, requestedResidency: residency, seed: 'synthetic-residency-artifacts', stages: [], osReserveBytes: 0 };
  const sample = generation => {
    const serverId = `synthetic-generation-${generation}`, receipt = { ...label, generation, serverId };
    return { ...label, generation, measured: true, server: { ...receipt, health: {}, diagnostics: { residency: structuredClone(trial) },
      healthObservation: { ...receipt }, diagnosticsObservation: { ...receipt }, eventLoop: {} } };
  };
  return { ...label, requestedResidency: residency, profile, fixture: { groups: 0, gaps: [] }, hardware: { ramBytes: 1024 },
    shutdown: { forced: false, exitCode: 0, signal: null }, telemetryErrors: 0,
    load: { ...label, initialServerId: 'synthetic-generation-0', restarts: [{ ...label, generation: 1, serverId: 'synthetic-generation-1' }],
      operations: [{ ...label, stage: 0 }], stageStreams: [], stats: {} }, samples: [sample(0), sample(1)] };
}

test('manifest results and summary retain requested and observed residency per generation', async t => {
  const { verifyResidency } = await import('../scripts/perf/capacity/residency.mjs');
  const { writeRunManifest, writeRunResults } = await import('../scripts/perf/capacity/run-artifacts.mjs');
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.local/residency-artifacts-', import.meta.url));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = artifactFixture(), verification = { status: 'pass', memoryProfile: 'default' };
  result.contextOpens = ['factory', 'prepare', 'close'].map(phase => ({ phase, pickerId: 'synthetic', openId: 1,
    residency: 'trial', memoryProfile: 'default', totalMs: 10, status: phase === 'factory' ? 'completed' : phase === 'prepare' ? 'prepared' : 'closed' }));
  result.manifest = runManifest({ profile: result.profile, format: 'format1', verification,
    residencyVerification: verifyResidency('trial', { residency: trial }) });
  Object.assign(result, result.manifest);
  await writeRunManifest(directory, result.manifest); await writeRunResults(directory, result);
  for (const filename of ['run-manifest.json', 'results.json']) {
    const stored = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
    assert.equal(stored.requestedResidency, 'trial'); assert.equal(stored.residency, 'trial');
    assert.equal(stored.residencyVerification.status, 'pass');
    assert.deepEqual(stored.residencyVerification.observed ?? stored.residencyVerification.evidence[0].observed, trial);
  }
  const summary = await readFile(path.join(directory, 'summary.md'), 'utf8');
  const stored = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
  assert.deepEqual(stored.contextOpens, result.contextOpens, 'all phases survive without memory snapshots');
  assert.match(summary, /Factory opens: \*\*1\*\*/);
  for (const phase of ['factory', 'prepare', 'close']) assert.ok(summary.includes(`| ${phase} | 1 | 1 | 10.00 / 10.00 / 10.00 | none |`));
  assert.match(summary, /Residency: \*\*trial\*\*; requested `trial`/);
  assert.match(summary, /"maxOpenContexts": 128/); assert.match(summary, /"deadlineMs": 30000/);
  assert.match(summary, /synthetic-generation-0/); assert.match(summary, /synthetic-generation-1/);
});

test('every context phase validates residency and memory labels independently of memory snapshots', async () => {
  const { assertResidency } = await import('../scripts/perf/capacity/residency.mjs');
  const { assertMemoryProfile } = await import('../scripts/perf/capacity/memory-profile.mjs');
  for (const phase of [undefined, 'before-restart', 'factory', 'prepare', 'close']) {
    const result = artifactFixture(), row = { phase, residency: 'trial', memoryProfile: 'default' };
    result.contextOpens = [row];
    assert.equal(assertResidency(result), 'trial');assert.equal(assertMemoryProfile(result), 'default');
    for (const value of ['default', undefined]) {
      row.residency = value;
      assert.throws(() => assertResidency(result), /Cannot combine residency settings/);
    }
    row.residency = 'trial';
    for (const value of ['budget-672', undefined]) {
      row.memoryProfile = value;
      assert.throws(() => assertMemoryProfile(result), /Cannot combine memory profiles/);
    }
  }
});

test('periodic samples retain missing diagnostics and HTTP evidence for both memory selections', () => {
  for (const memoryProfile of ['default', 'budget-672']) {
    const profile = { memoryProfile, residency: 'trial' };
    for (const server of [null, { health: {} }, { diagnostics: null }]) {
      const row = { measured: true, server };
      assert.equal(verifySampleProfiles(profile, row), row);
      assert.equal(row.residencyVerification.status, 'unverified');
      assert.equal(row.memoryProfileVerification.status, 'unverified');
    }
    const row = { server: { health: { memoryBudget: { profile: memoryProfile, enforced: memoryProfile === 'budget-672' } } } };
    verifySampleProfiles(profile, row);
    assert.equal(row.memoryProfileVerification.status, 'pass');
    assert.equal(row.residencyVerification.status, 'unverified');
  }
});

test('periodic samples still abort on observed residency or memory mismatches', () => {
  const profile = { memoryProfile: 'budget-672', residency: 'trial' };
  const memoryBudget = { profile: 'budget-672', enforced: true };
  for (const residency of [defaults, { ...trial, coldStartsGlobal: 1 }, {}]) {
    assert.throws(() => verifySampleProfiles(profile, { server: { health: { memoryBudget }, diagnostics: { residency } } }),
      { code: 'residency-unverified' });
  }
  for (const memoryProfile of ['default', 'budget-672']) {
    for (const source of ['health', 'diagnostics']) {
      const summary = { profile: memoryProfile, enforced: memoryProfile === 'default' };
      assert.throws(() => verifySampleProfiles({ ...profile, memoryProfile }, { server: { [source]: { memoryBudget: summary } } }),
        { code: 'memory-profile-unverified' });
    }
  }
});

test('startup and replacement readiness still refuse missing residency diagnostics before traffic', async t => {
  const { verifyServerResidency } = await import('../scripts/perf/capacity/residency.mjs');
  const { drive } = await import('../scripts/perf/capacity/driver.mjs');
  const { planFixture } = await import('../scripts/perf/capacity/model.mjs');
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.local/residency-readiness-', import.meta.url));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json', import.meta.url)));
  profile.residency = 'trial';
  const fixture = { groups: planFixture(profile).map(group => ({ ...group,
    members: group.members.map(member => ({ memberId: member.id, cookie: `synthetic-${group.index}-${member.id}` })) })) };
  let ready = false;
  const readiness = async () => {
    await verifyServerResidency('trial', async () => { throw new Error('Synthetic missing diagnostics'); });
    ready = true;
  };
  await assert.rejects(readiness(), { code: 'residency-unverified' });
  assert.equal(ready, false);
  await assert.rejects(drive({ base: 'http://127.0.0.1:0', initialServerId: 'synthetic-old', profile, fixture, directory,
    onSample: async () => {}, fetchRequest: async () => new Response('', { status: 503, headers: { 'retry-after': '1' } }),
    restartServer: readiness, schedule: async (events, run) => {
      await run({ ...events.find(event => event.kind === 'restart'), scheduledAt: 0 });
    } }), { code: 'residency-unverified' });
  assert.equal(ready, false);
});

test('results and summary count verified and missing samples without losing the run', async t => {
  const { writeRunResults } = await import('../scripts/perf/capacity/run-artifacts.mjs');
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.local/residency-sample-counts-', import.meta.url));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = artifactFixture();
  const missing = structuredClone(result.samples[1]);
  delete missing.server.diagnostics; delete missing.server.diagnosticsObservation;
  const restart = { residency: 'trial', memoryProfile: 'default', generation: 1, measured: true, restarting: true };
  const before = { ...structuredClone(result.samples[0]), measured: false };
  result.samples.push(missing, restart, before);
  await writeRunResults(directory, result);
  const stored = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
  for (const key of ['residencyVerification', 'memoryProfileVerification']) {
    assert.equal(stored[key].status, 'pass');
    assert.deepEqual(stored[key].samples, { verified: 3, unverified: 2, mismatched: 0, measured: { verified: 2, unverified: 2, mismatched: 0 } });
  }
  const summary = await readFile(path.join(directory, 'summary.md'), 'utf8');
  assert.match(summary, /Residency samples: 3 verified; 2 lacked evidence\. Measured: 2 verified; 2 lacked evidence/);
  assert.match(summary, /Memory profile samples: 3 verified; 2 lacked evidence\. Measured: 2 verified; 2 lacked evidence/);
});

test('results survive without measured proof and report unverified instead of claiming residency', async t => {
  const { writeRunResults } = await import('../scripts/perf/capacity/run-artifacts.mjs');
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.local/residency-no-proof-', import.meta.url));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = artifactFixture();
  result.samples = result.samples.flatMap(row => {
    const missing = structuredClone(row); delete missing.server.diagnostics; delete missing.server.diagnosticsObservation;
    return [{ ...row, measured: false }, missing];
  });
  await writeRunResults(directory, result);
  const stored = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
  assert.equal(stored.residencyVerification.residency, null);
  assert.equal(stored.memoryProfileVerification.memoryProfile, null);
  assert.equal(stored.gates.residency.reason, 'residency-unverified');
  assert.equal(stored.residencyVerification.samples.measured.verified, 0);
  const summary = await readFile(path.join(directory, 'summary.md'), 'utf8');
  assert.match(summary, /Residency: \*\*unverified\*\*/);
  assert.match(summary, /Memory profile: \*\*unverified\*\*/);
});

test('artifact writing still refuses observed mismatches', async t => {
  const { writeRunResults } = await import('../scripts/perf/capacity/run-artifacts.mjs');
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.local/residency-mismatch-', import.meta.url));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = artifactFixture(); result.samples[1].server.diagnostics.residency = defaults;
  await assert.rejects(writeRunResults(directory, result), { code: 'residency-unverified' });
  const memory = artifactFixture(); memory.samples[1].server.health.memoryBudget = { enforced: true };
  await assert.rejects(writeRunResults(directory, memory), { code: 'memory-profile-unverified' });
});

test('verdicts reject mixed residency labels and unverified replacement diagnostics', async () => {
  const { assertResidency, evaluateResidency } = await import('../scripts/perf/capacity/residency.mjs');
  const { evaluate } = await import('../scripts/perf/capacity/report.mjs');
  const { evaluateSustained } = await import('../scripts/perf/capacity/sustained-report.mjs');
  for (const mutate of [result => { result.profile.residency = 'default'; }, result => { result.load.residency = 'default'; },
    result => { result.load.operations[0].residency = 'default'; }, result => { delete result.load.operations[0].residency; },
    result => { result.load.restarts[0].residency = 'default'; }, result => { result.samples[1].residency = 'default'; },
    result => { result.samples[1].server.residency = 'default'; }, result => { result.samples[1].server.diagnosticsObservation.residency = 'default'; },
    result => { result.requestedResidency = 'default'; }]) {
    const result = artifactFixture(); mutate(result);
    for (const evaluateResult of [assertResidency, evaluate, evaluateSustained]) assert.throws(() => evaluateResult(result), /Cannot combine residency settings/);
  }
  for (const mutate of [result => { result.samples[1].server.diagnostics.residency = defaults; },
    result => { delete result.samples[1].server.diagnostics.residency; },
    result => { result.samples[1].server.diagnosticsObservation.generation = 0; },
    result => { result.samples.pop(); }]) {
    const result = artifactFixture(); mutate(result);
    assert.equal(evaluateResidency(result).reason, 'residency-unverified');
  }
});
