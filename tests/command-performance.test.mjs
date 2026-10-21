import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';

const TASKS = 24_000;
const ALIASES = 90_000;
const STATUSES = 4_000;
const HISTORY = 1_200;
const COMMAND_LIMIT_MS = 5_000;
const AT = '2026-01-01T00:00:00.000Z';

// Authored here, with no captured maps, external definitions or personal save.
function largeSyntheticState() {
  const state = createGroupState([
    { id: 'synthetic-a', name: 'Synthetic A', sourceMapId: 'synthetic-map-a' },
    { id: 'synthetic-b', name: 'Synthetic B', sourceMapId: 'synthetic-map-b' },
  ]);
  state.identityRegistry = { schemaVersion: 1, entries: {}, aliases: {}, unresolved: [] };
  for (let i = 0; i < TASKS; i++) {
    const id = `rs3:task:synthetic-save:${i}`;
    const row = { id, label: `Synthetic saved objective ${i}`, category: 'Synthetic' };
    state.tasks.push(row);
    state.identityRegistry.entries[id] = { ...row, kind: 'task' };
  }
  for (let i = 0; i < ALIASES; i++) {
    state.identityRegistry.aliases[`rs3:Synthetic:Historical%20objective%20label%20${i}`] = state.tasks[i % TASKS].id;
  }
  for (const member of state.members) {
    member.taskStatus = {};
    for (let i = 0; i < STATUSES; i++) {
      member.taskStatus[state.tasks[i].id] = { challengeCompleted: true, favorite: i % 2 === 0,
        note: `${member.id}: retained authored objective note ${i}` };
    }
  }
  // A valid sparse chain, constructed without repeatedly applying/validating a
  // growing history. The initial and final preference are both false.
  state.members[0].preferences = { ids: false };
  state.revision = HISTORY;
  for (let i = 0; i < HISTORY; i++) {
    const before = i % 2 === 1, after = !before;
    state.history.push({ id: `revision-${i + 1}`, revision: i + 1, type: 'set-preference', at: AT,
      command: { type: 'set-preference', memberId: 'synthetic-a', preferenceId: 'ids', value: after },
      undo: { memberChanges: [{ id: 'synthetic-a', changes: [{ path: ['preferences', 'ids'], kind: 'value',
        before: { exists: true, value: before }, after: { exists: true, value: after } }] }] } });
  }
  const evidence = Array.from({ length: 12_000 }, (_, i) => ({
    sourceMapId: `synthetic-map-${i % 2 ? 'b' : 'a'}`, originalId: `t_synthetic_${i}`,
    canonicalId: state.tasks[i].id, sourceField: 'chunkinfo.checkedAllTasks',
    note: `Retained synthetic migration evidence ${i}: ${'Exact imported objective evidence. '.repeat(12)}`,
  }));
  state.legacy = { maps: { 'synthetic-map-a': { chunkNotes: { '12341': 'Exact synthetic imported note' } } },
    gameplayMigration: { schemaVersion: 2, taskStatusProvenance: evidence, unresolved: [] } };
  state.provenance = { taskIdentityMigration: { schemaVersion: 1, archives: [{
    at: AT, reason: 'Synthetic historical identity boundary', tasks: structuredClone(state.tasks),
    members: structuredClone(state.members), history: structuredClone(state.history),
    identityRegistry: { schemaVersion: 1, entries: {}, aliases: { 'synthetic-old-id': state.tasks[0].id }, unresolved: [] },
  }] } };
  return state;
}

function retainedDigest(state) {
  return createHash('sha256').update(JSON.stringify({ tasks: state.tasks,
    identityRegistry: state.identityRegistry, legacy: state.legacy, provenance: state.provenance })).digest('hex');
}

// Conflict snapshots deliberately remain complete and are outside the command
// latency check. A fresh native HTTP socket avoids Undici's paused-parser error
// while draining a large response whose server closes the connection.
function fullConflictResponse(url, options) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method, agent: false,
      headers: { ...options.headers, Connection: 'close', 'Accept-Encoding': 'identity',
        'Content-Length': Buffer.byteLength(options.body) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

test('large retained state saves preferences and chunk selection promptly without whole-state JSON copies', { timeout: 250_000 }, async t => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'rs3-command-performance-'));
  assert.equal(path.dirname(directory), temporaryRoot, 'Cleanup must stay in the explicitly isolated temporary directory');
  let application;
  t.after(async () => {
    try { await application?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const initialState = largeSyntheticState();
  const bytes = Buffer.byteLength(JSON.stringify(initialState));
  assert.ok(bytes >= 24 * 1024 * 1024, `Synthetic state must exercise the large-save regression (${bytes} bytes)`);
  const expectedDigest = retainedDigest(initialState);
  t.diagnostic(`Synthetic save: ${(bytes / 1024 / 1024).toFixed(1)} MiB, ${TASKS} tasks, ${ALIASES} aliases, ${STATUSES} statuses/member, ${HISTORY} sparse history events`);
  const dataDir = path.join(directory, 'data');
  // Missing challenges intentionally avoids task workers and full definition
  // imports. Only the already prepared save/response path is measured.
  const serverOptions = { dataDir, port: 0, taskMap: {},
    definitions: { chunks: { '12341': {}, '12342': {} },
      walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] },
    retention: { historyEntries: 2_000, backupDays: 90 } };
  application = await createServer({ ...serverOptions, initialState });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  const invitation = await fetch(application.inviteUrl, { redirect: 'manual', headers: { Connection: 'close' } });
  assert.equal(invitation.status, 303);
  const cookie = invitation.headers.get('set-cookie').split(';')[0];
  const measurements = [];
  // Initial full-state HTTP transfer has separate server coverage. Start this
  // save benchmark from the fully hydrated client baseline without making its
  // setup depend on a large download under parallel test load.
  let responseBaseline = application.store.getState();
  assertRetained(responseBaseline);

  function assertRetained(state) {
    assert.equal(state.tasks.length, TASKS);
    assert.equal(Object.keys(state.identityRegistry.aliases).length, ALIASES);
    assert.equal(state.provenance.taskIdentityMigration.archives[0].history.length, HISTORY);
    assert.deepEqual(state.history.slice(0, HISTORY), initialState.history, 'The full existing sparse undo history must remain intact');
    assert.equal(retainedDigest(state), expectedDigest, 'Every catalogue row, alias, legacy fact and exact archive must survive');
    assert.deepEqual(state.members[1], initialState.members[1], 'The other member must remain unchanged');
    assert.deepEqual(state.members[0].taskStatus, initialState.members[0].taskStatus);
  }

  async function post(command, expectedRevision, expectedStatus = 200) {
    const originalStringify = JSON.stringify;
    let wholeStateCopies = 0;
    const ordinarySave = expectedStatus === 200;
    // This deterministic guard rejects the old cloning/validation path even on
    // fast hosts; the generous wall-clock limit tolerates parallel test load.
    // Revision-conflict snapshots remain a separate conservative boundary.
    if (ordinarySave) JSON.stringify = function (value, ...args) {
      const candidate = value?.state ?? value;
      if (candidate?.tasks?.length >= TASKS && Array.isArray(candidate.members)) wholeStateCopies++;
      return originalStringify.call(this, value, ...args);
    };
    let response, body, elapsedMs, headersMs;
    try {
      const started = performance.now();
      const options = { method: 'POST', headers: {
        Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip',
      }, body: originalStringify({ command, expectedRevision }) };
      response = ordinarySave ? await fetch(`${origin}/api/command`, options)
        : await fullConflictResponse(`${origin}/api/command`, options);
      headersMs = performance.now() - started;
      body = await response.json();
      elapsedMs = performance.now() - started;
    } finally { JSON.stringify = originalStringify; }
    assert.equal(response.status, expectedStatus, body.message);
    if (ordinarySave) {
      const measurement = { command: command.type, status: command.status, elapsedMs: Math.round(elapsedMs),
        headersMs: Math.round(headersMs), bodyMs: Math.round(elapsedMs - headersMs), wholeStateCopies };
      measurements.push(measurement);
      t.diagnostic(JSON.stringify(measurement));
      assert.equal(wholeStateCopies, 0, 'A small save must reuse prepared immutable JSON instead of cloning/serializing the whole state');
      assert.ok(elapsedMs < COMMAND_LIMIT_MS, `${command.type} ${command.status ?? ''} took ${Math.round(elapsedMs)} ms (limit ${COMMAND_LIMIT_MS} ms)`);
    }
    if (ordinarySave) {
      assert.equal(body.baseRevision, expectedRevision, 'Omitted fields must be anchored to the exact submitted revision');
      assert.deepEqual([...body.unchangedFields].sort(), ['identityRegistry', 'legacy', 'provenance', 'tasks']);
      for (const field of body.unchangedFields) assert.equal(Object.hasOwn(body.state, field), false, 'An omitted field must not also appear in the projection');
      assert.equal(mergeCommandState({ ...responseBaseline, revision: expectedRevision + 1 }, body), null,
        'A client with another revision must fetch complete state rather than merge stale retained fields');
    }
    const mergedState = mergeCommandState(responseBaseline, body);
    assert.ok(mergedState, 'The exact command baseline must reconstruct complete state');
    responseBaseline = mergedState;
    assertRetained(mergedState);
    const durable = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
    assert.equal(durable.storage.schemaVersion, 1);
    const referenceFields = Object.keys(durable.storage.fields);
    assert.deepEqual(referenceFields.sort(), ['identityRegistry', 'legacy', 'provenance', 'tasks']);
    const mutableState = Object.fromEntries(Object.entries(mergedState).filter(([key]) => !referenceFields.includes(key)));
    assert.deepEqual(durable.state, mutableState, 'Every acknowledged gameplay change and undo event must already be durable');
    return mergedState;
  }

  let state = await post({ type: 'set-preference', memberId: 'synthetic-a', preferenceId: 'ids', value: true }, HISTORY);
  assert.equal(state.revision, HISTORY + 1);
  assert.equal(state.members[0].preferences.ids, true);
  assert.deepEqual(state.history.at(-1).undo.memberChanges[0].changes.find(change => change.path.join('/') === 'preferences/ids'), {
    path: ['preferences', 'ids'], kind: 'value', before: { exists: true, value: false }, after: { exists: true, value: true },
  }, 'Preference save must retain an exact sparse undo delta');
  state = await post({ type: 'set-chunk', memberId: 'synthetic-a', chunkId: '12342', status: 'selected' }, state.revision);
  assert.deepEqual(state.members[0].selected, ['12342']);
  assert.deepEqual(state.history.at(-1).undo.memberChanges[0].changes.find(change => change.path.join('/') === 'selected'), {
    path: ['selected'], kind: 'value', before: { exists: true, value: [] }, after: { exists: true, value: ['12342'] },
  }, 'Chunk selection must retain its exact undo delta');
  state = await post({ type: 'set-chunk', memberId: 'synthetic-a', chunkId: '12342', status: 'locked' }, state.revision);
  assert.equal(state.revision, HISTORY + 3);
  assert.deepEqual(state.members[0].selected, []);
  assert.deepEqual(state.history.at(-1).undo.memberChanges[0].changes.find(change => change.path.join('/') === 'selected'), {
    path: ['selected'], kind: 'value', before: { exists: true, value: ['12342'] }, after: { exists: true, value: [] },
  }, 'Clearing selection must retain its exact undo delta');

  const savedBytes = await readFile(path.join(dataDir, 'state.json'));
  const conflict = await post({ type: 'set-preference', memberId: 'synthetic-a', preferenceId: 'ids', value: false }, HISTORY, 409);
  assert.equal(conflict.revision, state.revision);
  assert.equal(conflict.members[0].preferences.ids, true);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), savedBytes, 'A stale save must not alter durable bytes');

  const durable = JSON.parse(savedBytes.toString('utf8'));
  for (const [field, reference] of Object.entries(durable.storage.fields)) {
    assert.match(reference.sha256, /^[a-f0-9]{64}$/);
    assert.equal(reference.id, `static-${reference.sha256}.json.gz`);
    const staticDirectory = path.resolve(dataDir, 'static');
    const file = path.resolve(staticDirectory, reference.id);
    assert.equal(path.dirname(file), staticDirectory, 'Sidecar verification must stay inside this isolated test store');
    const bytes = gunzipSync(await readFile(file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256, 'Every referenced immutable field must be durably stored under its exact content hash');
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), state[field], `Durable ${field} sidecar must contain the complete API field`);
  }
  assert.deepEqual((await application.store.backup()).state, state, 'Portable backups must contain complete state, including all retained archives');
  await application.close();
  application = await createServer(serverOptions);
  await application.listen();
  const recovered = application.store.getState();
  assertRetained(recovered);
  assert.deepEqual(recovered, state, 'Restart must hydrate the exact acknowledged state from state.json and its durable sidecars');

  t.diagnostic(JSON.stringify({ stateMiB: +(bytes / 1024 / 1024).toFixed(1), tasks: TASKS,
    aliases: ALIASES, statusesPerMember: STATUSES, historyEvents: HISTORY, measurements }));
});
