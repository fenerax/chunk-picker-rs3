import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let phase = 'module-import', app, evidence = [], safeFailure;
const root = process.env.RS3_INDEPENDENT_ROOT;
const origin = process.env.RS3_INDEPENDENT_ORIGIN;
const datasetId = process.env.RS3_DATASET ?? 'open-starter';
const result = { passed: false, method: 'Real HTTP requests to the shared server from a cookie-authenticated client; module/lazy-import closure fetched over HTTP. No browser-rendering claim.',
  workerMode: 'process', workflow: [], requests: evidence };
try {
  const { createServer } = await import('../../app/server.mjs');
  const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
  phase = 'server-startup';
  assert.equal(selectedDataset.datasetId ?? selectedDataset.id, datasetId);
  assert.equal(selectedDataset.capabilities.independent, true);
  app = await createServer({ dataDir: path.join(root, '.scratch', datasetId), host: '127.0.0.1',
    port: Number(process.env.RS3_INDEPENDENT_PORT), predictionPrewarm: false,
    idleMemoryOptions: { delayMs: 60000 },
  });
  await app.listen();
  let cookie;
  async function request(route, { body, auth = cookie, expect = 200, method = body === undefined ? 'GET' : 'POST', label } = {}) {
    const url = new URL(route, origin); assert.equal(url.origin, origin);
    const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(45000),
      headers: { ...(auth ? { Cookie: auth } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // Invitation URLs and credentials never enter evidence or diagnostics.
    const publicRoute = url.pathname.startsWith('/join/') ? '/join/[redacted]' : url.pathname + url.search;
    evidence.push({ method, route: publicRoute, status: response.status, ...(label ? { workflow: label } : {}) });
    if (response.status !== expect) { safeFailure = { method, route: publicRoute, status: response.status, expected: expect }; throw new Error('HTTP response mismatch.'); }
    return response;
  }
  const json = async (route, options) => (await request(route, options)).json();
  const joined = await request('/join/' + app.store.getAccessToken(), { auth: null, expect: 303, label: 'administrator-session' });
  cookie = joined.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const session = await json('/api/session'); assert.equal(session.admin, true); assert.equal(session.label, 'Administrator');
  result.workflow.push('create-fresh-game-and-cookie-session');
  let state = (await json('/api/state?view=play-v1')).state;
  const memberId = state.members[0].id, peerId = state.members[1].id;
  assert.deepEqual(state.members.map(member => [member.id, member.name]), selectedDataset.gameDefaults.members.map(member => [member.id, member.name]));
  assert.ok(state.members.every(member => member.sourceMapId == null));
  const seededManualTask = state.tasks.find(row => row.id === selectedDataset.gameDefaults.tasks[0]?.id);
  assert.ok(seededManualTask, 'The ordinary fresh game seeds its authored manual goals.');
  const definitions = await json('/api/definitions');
  const cells = Object.keys(definitions.chunks ?? {});
  assert.ok(cells.length >= 2, 'Dataset has at least two selectable cells.');
  const ownedCell = String(selectedDataset.gameDefaults.startingCell ?? selectedDataset.value('app/data/surface-grid.mjs#SURFACE_GRID').startId);
  const adjacent = Object.values(definitions.sections?.[ownedCell] ?? {}).flat().map(String);
  const selectedCell = adjacent.find(id => cells.includes(id) && id !== ownedCell
    && Object.values(definitions.sections?.[id] ?? {}).flat().map(String).includes(ownedCell));
  assert.ok(cells.includes(ownedCell) && selectedCell, 'The provider start has a reciprocal selectable neighbour.');
  async function command(payload, label = payload.type) {
    const response = await json('/api/command?view=play-v1', { body: { expectedRevision: state.revision, command: payload }, label });
    state = response.state; return response;
  }
  phase = 'ownership-selection';
  await command({ type: 'set-chunk', memberId, chunkId: ownedCell, status: 'unlocked' }, 'own-cell');
  assert.ok(state.members[0].unlocked.includes(ownedCell));
  await command({ type: 'set-chunk', memberId, chunkId: selectedCell, status: 'selected' }, 'select-cell');
  assert.ok(state.members[0].selected.includes(selectedCell));
  result.workflow.push('own-cell', 'select-cell');
  phase = 'roll';
  const beforeRoll = new Set(state.members[0].unlocked);
  await command({ type: 'roll', memberId, count: 1 }, 'roll-neighbour');
  assert.ok(state.members[0].unlocked.some(id => !beforeRoll.has(id)), 'A draw unlocks a real dataset cell.');
  result.workflow.push('roll-neighbour');
  phase = 'own-and-manual-task-completion';
  const own = await json(`/api/tasks?memberId=${memberId}`);
  const activityPrefix = datasetId === 'open-starter' ? 'rs3:task:open-starter:' : `${selectedDataset.identityNamespace}:activity:`;
  const task = own.tasks.find(row => row.id.startsWith(activityPrefix) && !row.completed && row.status === 'available');
  assert.ok(task, 'The owned start generates an available dataset activity.');
  await command({ type: 'complete-task', memberId, taskId: task.id, completed: true }, 'complete-own-task');
  assert.ok(state.members[0].completedTasks.includes(task.id));
  state = (await json('/api/state?view=play-v1', { label: 'reload-completed-activity' })).state;
  assert.ok(state.members[0].completedTasks.includes(task.id));
  await command({ type: 'undo' }, 'undo-generated-activity-completion');
  assert.ok(!state.members[0].completedTasks.includes(task.id), 'Undo removes the generated activity check.');
  await command({ type: 'complete-task', memberId, taskId: task.id, completed: true }, 'complete-own-task-again');
  await command({ type: 'complete-task', memberId, taskId: seededManualTask.id, completed: true }, 'complete-seeded-manual-goal');
  assert.ok(state.members[0].completedTasks.includes(seededManualTask.id));
  const manualId = 'custom:independent-verification';
  await command({ type: 'add-task', task: { id: manualId, label: 'Check my own journey notes', category: 'Custom', memberIds: [memberId] } }, 'create-manual-task');
  await command({ type: 'complete-task', memberId, taskId: manualId, completed: true }, 'complete-manual-task');
  assert.ok(state.members[0].completedTasks.includes(manualId));
  result.workflow.push('complete-own-task', 'reload-and-undo-generated-activity-completion', 'complete-own-task-again', 'complete-seeded-manual-goal', 'create-and-complete-manual-task');
  if (datasetId === 'open-f2p') {
    phase = 'quest-task-completion';
    const quest = own.tasks.find(row => row.category === 'Quest' && row.record.BaseQuest === "Cook's Assistant" && row.record.Chunks.includes(ownedCell));
    assert.ok(quest, 'The starting area has a sourced quest task, including its manual gates.');
    await command({ type: 'complete-task', memberId, taskId: quest.id, completed: true }, 'record-quest-completion');
    state = (await json('/api/state?view=play-v1', { label: 'reload-quest-completion' })).state;
    assert.ok(state.members[0].completedTasks.includes(quest.id));
    await command({ type: 'undo' }, 'undo-quest-completion');
    assert.ok(!state.members[0].completedTasks.includes(quest.id));
    await command({ type: 'complete-task', memberId, taskId: quest.id, completed: true }, 'record-quest-completion-again');
    result.questTask = { id: quest.id, initialStatus: quest.status, reloaded: true, undone: true, recordedAgain: true };
    result.workflow.push('record-reload-undo-quest-completion');
    phase = 'equipment-task-completion';
    const batch = selectedDataset.json('app/datasets/open-f2p/wiki-derived/dataset.json');
    const equipmentIds = new Set(batch.tasks.filter(row => row.itemId || row.id.includes(':activity:obtain')).map(row => row.id));
    const equipment = own.tasks.find(row => equipmentIds.has(row.id) && /Bronze hatchet/i.test(row.label)
      && row.status === 'available' && row.record.Chunks.includes(ownedCell));
    assert.ok(equipment, 'The starting area has an available, independently sourced Bronze hatchet acquisition.');
    await command({ type: 'complete-task', memberId, taskId: equipment.id, completed: true }, 'record-equipment-completion');
    state = (await json('/api/state?view=play-v1', { label: 'reload-equipment-completion' })).state;
    assert.ok(state.members[0].completedTasks.includes(equipment.id));
    await command({ type: 'undo' }, 'undo-equipment-completion');
    assert.ok(!state.members[0].completedTasks.includes(equipment.id));
    await command({ type: 'complete-task', memberId, taskId: equipment.id, completed: true }, 'record-equipment-completion-again');
    result.equipmentTask = { id: equipment.id, initialStatus: equipment.status, reloaded: true, undone: true, recordedAgain: true };
    result.workflow.push('record-reload-undo-equipment-completion');
  }
  phase = 'note-reload-undo';
  const note = 'Independent verification note';
  await command({ type: 'set-note', memberId, chunkId: ownedCell, note }, 'write-note');
  await request('/', { label: 'reload-shell' });
  state = (await json('/api/state?view=play-v1', { label: 'reload-state' })).state;
  assert.equal(state.members[0].notes[ownedCell], note);
  assert.ok(state.members[0].completedTasks.includes(task.id), 'The generated activity remains complete after reload.');
  await command({ type: 'set-note', memberId, chunkId: ownedCell, note: 'Temporary undo note' }, 'change-note');
  await command({ type: 'undo' }, 'undo-note');
  assert.equal(state.members[0].notes[ownedCell], note);
  result.workflow.push('write-note', 'reload-over-http', 'undo');
  phase = 'backup-and-restore';
  const backup = await json('/api/backup', { label: 'take-backup' });
  assert.equal(backup.state.members[0].notes[ownedCell], note);
  await command({ type: 'set-note', memberId, chunkId: ownedCell, note: 'After backup' }, 'mutate-after-backup');
  const preview = await json('/api/restore/preview?view=play-v1', { body: { backup }, label: 'preview-backup-restore' });
  assert.equal(preview.currentRevision, state.revision);
  assert.equal((await json('/api/state?view=play-v1')).state.members[0].notes[ownedCell], 'After backup', 'Preview does not apply restoration.');
  const restored = await json('/api/restore?view=play-v1', { body: { backup, expectedRevision: state.revision }, label: 'restore-backup' });
  state = restored.state; assert.equal(state.members[0].notes[ownedCell], note);
  assert.ok(state.members[0].completedTasks.includes(manualId));
  const restoredBackup = await json('/api/backup', { label: 'backup-after-restore' });
  assert.equal(restoredBackup.state.provenance.dataset.id, selectedDataset.datasetId);
  assert.equal(restoredBackup.state.provenance.dataset.digest, selectedDataset.digest);
  const restoredAgain = await json('/api/restore?view=play-v1', { body: { backup: restoredBackup, expectedRevision: state.revision }, label: 'restore-backup-again' });
  state = restoredAgain.state; assert.equal(state.members[0].notes[ownedCell], note);
  for (const kind of ['foreign', 'missing']) {
    const invalid = structuredClone(restoredBackup);
    if (kind === 'foreign') invalid.state.provenance.dataset.id = 'another-invented-game';
    else delete invalid.state.provenance.dataset;
    for (const route of ['/api/restore/preview?view=play-v1', '/api/restore?view=play-v1']) await request(route, {
      body: { backup: invalid, expectedRevision: state.revision }, expect: 422, label: `${kind}-dataset-backup-refused` });
  }
  for (const route of ['/api/import/preview', '/api/import']) await request(route, { body: {}, expect: 404, label: 'unsupported-legacy-import' });
  assert.equal((await json('/api/state?view=play-v1')).state.revision, state.revision, 'Refused backup/imports do not mutate the game.');
  result.workflow.push('take-backup', 'preview-and-restore-backup', 'backup-after-restore-and-restore-again', 'foreign-and-missing-dataset-backups-refused');
  phase = 'all-worker-lanes';
  const revision = state.revision;
  const foreground = await json(`/api/tasks?memberId=${memberId}&view=play-v1`);
  const duo = await json(`/api/tasks?memberId=${peerId}&view=play-v1&lane=duo-v1&peerFor=${memberId}&revision=${revision}`);
  const prediction = await json(`/api/predict?memberId=${memberId}&chunkId=${selectedCell}`);
  await request(`/api/death-estimates?memberId=${memberId}&chunkId=${selectedCell}`, { expect: 422, label: 'unsupported-death-estimates' });
  const planning = await json(`/api/chunk-planning?memberId=${memberId}&chunkId=${ownedCell}`);
  await request(`/api/area-check?memberId=${memberId}&revision=${revision}&chunks=${ownedCell},${selectedCell}`, { expect: 422, label: 'unsupported-area-check' });
  for (const value of [foreground, duo, prediction, planning]) assert.equal(value.stateRevision, revision);
  result.workerRoutes = ['foreground-task-evaluation', 'duo-task-evaluation', 'prediction', 'chunk-planning'];
  result.unsupportedRoutesRefused = ['death-estimates', 'area-check'];
  phase = 'invitation-and-viewer';
  const playerInvite = await json('/api/invites', { body: { label: 'Second independent player', memberId: peerId }, expect: 201, label: 'create-player-invitation' });
  const playerJoin = await request(new URL(playerInvite.link).pathname, { auth: null, expect: 303 });
  const playerCookie = playerJoin.headers.get('set-cookie').split(';')[0];
  const player = await json('/api/session', { auth: playerCookie }); assert.equal(player.memberId, peerId); assert.equal(player.readOnly, false);
  const viewerInvite = await json('/api/invites', { body: { label: 'Independent observer', viewer: true }, expect: 201, label: 'create-viewer-invitation' });
  const viewerJoin = await request(new URL(viewerInvite.link).pathname, { auth: null, expect: 303 });
  const viewerCookie = viewerJoin.headers.get('set-cookie').split(';')[0];
  const viewer = await json('/api/session', { auth: viewerCookie }); assert.equal(viewer.readOnly, true); assert.equal(viewer.capabilities.canWrite, false);
  await json('/api/state?view=play-v1', { auth: viewerCookie, label: 'viewer-read' });
  await request('/api/command?view=play-v1', { auth: viewerCookie, expect: 403, body: { expectedRevision: revision,
    command: { type: 'set-note', memberId, chunkId: ownedCell, note: 'Forbidden viewer edit' } }, label: 'viewer-write-denied' });
  const finalState = (await json('/api/state?view=play-v1')).state; assert.equal(finalState.revision, revision); assert.equal(finalState.members[0].notes[ownedCell], note);
  result.workflow.push('player-invitation-and-session', 'viewer-invitation-and-read', 'viewer-write-denied');
  phase = 'served-module-and-lazy-route-closure';
  const queue = ['/', '/data/dataset-runtime.json', ...selectedDataset.files
    .filter(file => file.kind === 'input' && file.path.endsWith('.json'))
    .map(file => file.path.startsWith('app/data/') ? file.path.slice('app'.length)
      : `/api/dataset-input?key=${encodeURIComponent(file.path)}&digest=${selectedDataset.digest}`)], seen = new Set(), outside = [], nodeOnlyImportsSkipped = [];
  function enqueue(specifier, from) {
    if (specifier.startsWith('node:') || specifier.startsWith('data:') || specifier.startsWith('#')) return;
    const url = new URL(specifier, new URL(from, origin));
    if (url.origin !== origin) { outside.push(url.origin); return; }
    const route = url.pathname + url.search; if (!seen.has(route) && !queue.includes(route)) queue.push(route);
  }
  while (queue.length) {
    const route = queue.shift(); if (seen.has(route)) continue; seen.add(route);
    const response = await request(route, { label: 'served-module-closure' });
    const source = await response.text();
    if (route === '/' || /\.html$/.test(route)) {
      for (const match of source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g)) enqueue(match[1], route);
    } else if (/\.mjs(?:\?|$)/.test(route)) {
      // Both static imports and literal lazy imports are edges in this check.
      for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
        // These two imports are explicitly inside the server-only branches of
        // the shared runtime. A browser never requests the filesystem loader.
        if (route === '/dataset-runtime.mjs' && ['./datasets.mjs', './dataset-inputs.mjs'].includes(match[1])) {
          nodeOnlyImportsSkipped.push(match[1]); continue;
        }
        enqueue(match[1], route);
      }
      for (const match of source.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) enqueue(match[1], route);
      // Helper sections use import(section.module), with literal module entries.
      for (const match of source.matchAll(/\bmodule\s*:\s*["']([^"']+\.mjs)["']/g)) enqueue(match[1], route);
    } else if (/\.css(?:\?|$)/.test(route)) {
      // Fonts declared but unused by the independent system-font stylesheet
      // are optional artwork, not browser requests. The browser check owns
      // evidence that the selected font face is not requested at runtime.
      const withoutOptionalFaces = source.replace(/@font-face\s*\{[^}]*\}/g, '');
      for (const match of withoutOptionalFaces.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) enqueue(match[1], route);
    }
  }
  assert.equal(outside.length, 0, 'Served module closure contains no outside resource edge.');
  result.modules = { fetchedRoutes: [...seen].sort(), outsideResourceEdges: outside, missingRoutes: [], literalLazyImportsIncluded: true, nodeOnlyImportsSkipped,
    limitation: 'Static import/literal lazy-import graph and HTML/CSS resources excluding unused @font-face declarations; JavaScript UI and nonliteral URLs are not executed.' };
  const art = await json('/api/art-status');
  assert.equal(art.placeholderPictures, true);
  assert.deepEqual(art.availableRoutes, []);
  assert.ok(Object.values(art.components).every(sources => sources.every(source => source === 'placeholder')));
  result.artStatus = art;
  result.dataset = { id: selectedDataset.datasetId ?? selectedDataset.id, digest: selectedDataset.digest };
  result.game = { cells: cells.length, ownedCell, selectedCell, ownTaskId: task.id, seededManualTaskId: seededManualTask.id, manualTaskId: manualId, finalRevision: revision,
    administratorLabel: session.label };
  result.passed = true;
} catch (error) {
  result.failureStage = phase; result.failure = error.code === 'INDEPENDENT_FORBIDDEN' ? error.message : 'Independent workflow assertion failed.';
  result.failureCode = error.code ?? error.name;
  result.sourceFrames = String(error.stack ?? '').split('\n').slice(1).filter(line => line.includes(root.replaceAll('\\', '/')) || line.includes(root))
    .slice(0, 8).map(line => line.replaceAll(root.replaceAll('\\', '/'), '[candidate]').replaceAll(root, '[candidate]'));
  if (safeFailure) result.failedRequest = safeFailure;
  process.exitCode = 1;
} finally {
  if (app) try { await app.close(); result.serverClosed = true; } catch { result.serverClosed = false; result.passed = false; process.exitCode = 1; }
}
process.stdout.write(JSON.stringify(result));
