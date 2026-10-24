// Test-only, data-only oracle for the pinned shipping Possible Tasks / All view.
// No product imports. This validates the UI projection of complete retained bodies;
// it is not an independent proof that the backend task engine itself is correct.
export const ORACLE_VERSION = 'r79-all-planning-v1';
export const SOURCE_PIN = '6f22fefa782747790e2eaefa01e4e5ea7b557323';
const own = (v, key) => v != null && Object.hasOwn(v, key);
const fail = (status, code, extra = {}) => ({ status, code, oracle: ORACLE_VERSION, ...extra });
// Documented UI plain-label rules: links show their text before #, [+] markers and
// HTML tags are omitted, outer whitespace is removed. No provider is started.
export const plain = value => String(value ?? '').replace(/~\|([^|]*)\|~/g, (_, text) => text.split('#')[0]).replace(/\[\+\]/g, '').replace(/<[^>]*>/g, '').trim();
export function projectPlanningTask(task) {
  if (!task || typeof task.id !== 'string' || typeof task.status !== 'string') throw new TypeError('Planning row lacks task identity/status');
  const blocked = task.status !== 'available';
  return { id: task.id, label: plain(task.label), status: task.status, blocked,
    meta: blocked ? `${task.category} · ${plain(task.blockers?.[0]?.detail ?? task.status)}` : `${task.category} · doable now` };
}
const projectionKey = row => `${row.label.length}:${row.label}${row.meta.length}:${row.meta}:${row.blocked ? 1 : 0}`;
const matches = (record, request, member) => record?.bodyComplete === true
  && record.requestMemberId === member && record.requestRevision === request.revision
  && record.inputKey === request.inputKey && record.body?.memberId === member
  && record.body?.stateRevision === request.revision;

/**
 * request: immutable captured action scope (never reconstructed from current DOM).
 * responses: records from body consumption, with captured request provenance.
 * A body with no source-proven input key is unobservable, never a matching key.
 * Group All remains the selected owner's planning page: peer rows are not unioned.
 * Cached planning can predate the click generation only if its input/member/rev/
 * chunk scope matches; native->DOM action generation must still match exactly.
 */
export function auditPlanning({ request, native, responses = [], dom, duoReady } = {}) {
  if (!request || !own(request, 'inputKey') || request.inputKey == null || !own(request, 'generation') || request.generation == null)
    return fail('blocked', 'unobservable-request-input-key-or-generation');
  if (typeof request.memberId !== 'string' || !Number.isInteger(request.revision) || request.chunkId == null)
    return fail('blocked', 'incomplete-request-scope');
  if (!native?.trusted || !own(native, 'value') || native.value == null || !Number.isFinite(native.at))
    return fail('blocked', 'unobserved-trusted-native-value');
  if (native.value !== request.nativeValue || native.generation !== request.generation)
    return fail('incorrect', 'native-action-mismatch');
  if (!dom || !own(dom, 'generation')) return fail('blocked', 'unobserved-dom-generation');
  if (dom.generation !== request.generation || dom.memberId !== request.memberId || dom.revision !== request.revision)
    return fail('incorrect', 'dom-scope-mismatch');
  if (dom.visible !== true || dom.filter !== 'all') return fail('incorrect', 'requested-all-page-not-visible');
  if (!Number.isFinite(dom.at) || dom.at < native.at) return fail('incorrect', 'dom-precedes-native-input');
  const planning = responses.filter(record => record.path === '/api/chunk-planning');
  const candidates = planning.filter(record => matches(record, request, request.memberId)
    && String(record.body?.chunkId) === String(request.chunkId)
    && (record.chunkId == null || String(record.chunkId) === String(request.chunkId))
    && record.body?.format === 'chunk-planning-v1');
  if (!candidates.length) return fail('blocked', 'no-complete-matching-owner-planning-body');
  // Prefer the latest retained matching body consumed before this DOM observation.
  const eligible = candidates.filter(record => Number.isFinite(record.consumedAt) && Number.isFinite(record.parsedAt)
    && record.consumedAt <= record.parsedAt && record.parsedAt <= dom.at);
  if (!eligible.length) return fail('blocked', 'planning-body-consumption-unobserved-or-after-dom');
  const selected = eligible.reduce((a,b) => a.parsedAt > b.parsedAt ? a : b);
  const contributors = [selected];
  if (request.group) {
    if (duoReady !== true) return fail('blocked', 'group-not-ready');
    if (!Array.isArray(request.peerIds) || request.peerIds.length === 0) return fail('blocked', 'peer-scope-unobserved');
    for (const peer of request.peerIds) {
      if (peer === request.memberId) return fail('incorrect', 'selected-owner-listed-as-peer');
      const peerBody = responses.find(record => record.path === '/api/tasks' && matches(record, request, peer)
        && Number.isFinite(record.consumedAt) && Number.isFinite(record.parsedAt)
        && record.consumedAt <= record.parsedAt && record.parsedAt <= dom.at);
      if (!peerBody) return fail('blocked', 'missing-complete-matching-peer-body', { peer });
      contributors.push(peerBody);
    }
  }
  if (!Array.isArray(selected.body.rows)) return fail('incorrect', 'planning-rows-not-array');
  let all;
  try { all = selected.body.rows.map(row => projectPlanningTask(row.task)); }
  catch (error) { return fail('incorrect', 'malformed-planning-task', { detail: error.message }); }
  if (new Set(all.map(row => row.id)).size !== all.length) return fail('incorrect', 'duplicate-backend-task-id');
  // Stable partition is intentional: All preserves backend order within status.
  const ordered = [...all.filter(row => !row.blocked), ...all.filter(row => row.blocked)];
  const expected = ordered.slice(0, 60), actual = dom.rows;
  if (!Array.isArray(actual) || actual.length !== expected.length)
    return fail('incorrect', 'visible-row-count-mismatch', { expectedCount: expected.length, actualCount: actual?.length ?? null });
  const projectionCounts = new Map();
  for (const row of all) projectionCounts.set(projectionKey(row), (projectionCounts.get(projectionKey(row)) ?? 0) + 1);
  let projectionOnly = false;
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i], got = actual[i];
    if (!got || got.label !== want.label || got.meta !== want.meta || got.blocked !== want.blocked)
      return fail('incorrect', 'visible-row-content-or-order-mismatch', { row: i, expectedId: want.id });
    if (own(got, 'status') && got.status !== want.status)
      return fail('incorrect', 'visible-row-status-mismatch', { row: i, expectedId: want.id });
    if (own(got, 'id')) {
      if (got.id !== want.id) return fail('incorrect', 'visible-task-id-mismatch', { row: i, expectedId: want.id });
    } else {
      projectionOnly = true;
      if (projectionCounts.get(projectionKey(want)) !== 1)
        return fail('blocked', 'ambiguous-visible-identity-projection', { row: i, expectedId: want.id });
    }
  }
  return { status: 'correct', code: 'matching-visible-all-page', oracle: ORACLE_VERSION,
    total: all.length, shown: expected.length, expected,
    identityProjection: projectionOnly ? 'unique-label-meta-blocked-within-complete-owner-body' : 'explicit-dom-task-id',
    statusProjection: 'available-vs-blocked; exact-nonavailable-status-from-matched-backend-body',
    bodyBoundary: Math.max(...contributors.map(record => record.parsedAt)),
    correctDOMAt: dom.at, physicalPaint: 'unobserved',
    limit: 'Backend evaluation is not independently recomputed; Group peer readiness is required but peer planning rows are not unioned.' };
}
