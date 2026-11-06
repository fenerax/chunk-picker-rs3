// Public/synthetic, dependency-free Possible Tasks row benchmark (Node 24).
// Generate once, then run the same fixture against independent app directories:
//   node scripts/perf/possible-task-rows.mjs generate /tmp/rows.json 24000 4
//   node scripts/perf/possible-task-rows.mjs run /tmp/rows.json /tmp/baseline not-done
//   node scripts/perf/possible-task-rows.mjs matrix /tmp/small.json /tmp/baseline
// Timing covers complete selectDuoTasks calls, including all indexing and rows.
// Serialization/equality hashes, imports, fixture reads and warmup are untimed.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const registry = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };

/** Arithmetic sequences fix order/content without a clock or random source.
 * neverEvery=0 omits the list; otherwise every nth raw ID is never-show.
 * The two catalogues intentionally differ in labels, availability and ownership.
 */
export function possibleRowsFixture(size = 24000, neverEvery = 4) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 100000) throw new RangeError('Size must be 1..100000.');
  if (!Number.isSafeInteger(neverEvery) || neverEvery < 0) throw new RangeError('neverEvery must be nonnegative.');
  const state = { revision: 7, rules: {}, tasks: [], identityRegistry: { entries: {}, aliases: {} }, members: [
    { id: 'alpha', name: 'Alpha', completedTasks: [], taskStatus: {} },
    { id: 'beta', name: 'Beta', completedTasks: [], taskStatus: {} },
  ] };
  const results = state.members.map((member, owner) => {
    const tasks = [], neverShowIds = [];
    for (let i = 0; i < size; i++) {
      const canonical = `rs3:task:synthetic-${String(i).padStart(6, '0')}`, category = ['Mining', 'Fishing', 'Extra'][i % 3];
      state.identityRegistry.entries[canonical] = { category };
      const id = owner && i % 31 === 0 ? `old:${i}` : canonical;
      if (id !== canonical) state.identityRegistry.aliases[id] = canonical;
      if (i % 17 === owner) member.completedTasks.push(id);
      if (i % 19 === owner) member.taskStatus[id] = { challengeCompleted: true, favorite: i % 38 === owner };
      if (i % 23 === owner) member.taskStatus[id] = { ...member.taskStatus[id], backlogged: true, backlogReason: `Synthetic backlog ${owner}:${i}` };
      if (i % 29 === owner) continue;
      const blocked = i % (owner ? 7 : 11) === 0;
      tasks.push({ id, label: `Synthetic ${owner} task ${String((i * 7919) % size).padStart(6, '0')}`, category,
        level: 1 + i % 99, status: blocked ? 'blocked' : 'available', blockers: blocked ? [{ kind: 'synthetic', detail: `Owner ${owner} needs level ${i % 99}` }] : [],
        explanation: `Synthetic explanation ${owner}:${i}`, hidden: i % 101 === 0, obligation: i % 103 !== 0,
        ...(i % 107 === 0 ? { record: { NeverShow: true } } : {}), ...(i % 109 === 0 ? { neverShow: true } : {}),
        ...(i % 37 === 0 ? { completionIds: [canonical, `family:${i}`] } : {}) });
      if (neverEvery && i % neverEvery === 0) neverShowIds.push(id);
    }
    return { memberId: member.id, stateRevision: 7, tasks, ...(neverEvery ? { neverShowIds } : {}),
      presentation: { tasks: tasks.filter((_, i) => i % 3 === 0), completedTasks: tasks.filter((_, i) => i % 17 === 0) } };
  });
  state.tasks.push({ id: 'custom:alpha', label: 'Synthetic assigned custom', category: 'Extra', memberIds: ['alpha'] },
    { id: 'custom:both', label: 'Synthetic shared custom', category: 'Extra' },
    { id: 'preserved:beta', label: 'Synthetic preserved', category: 'Extra' });
  state.members[1].taskStatus['preserved:beta'] = { backlogged: false, note: 'Synthetic saved evidence' };
  return { schemaVersion: 1, synthetic: true, size, neverEvery, state, results };
}

async function load(fixturePath, appRoot) {
  const bytes = await readFile(fixturePath), fixture = JSON.parse(bytes);
  const { selectDuoTasks } = await import(pathToFileURL(resolve(appRoot, 'app/web/duo-tasks.mjs')));
  return { fixture, fixtureSha256: sha(bytes), select: options => selectDuoTasks({
    state: fixture.state, results: fixture.results, registry, selectedMemberId: 'alpha', ...options }) };
}

function fingerprint(output) {
  // No volatile fields are removed: all row identities/order, task contents,
  // explanations, per-owner facts, completion evidence and counts participate.
  const bytes = JSON.stringify(output);
  return { sha256: sha(bytes), bytes: Buffer.byteLength(bytes), rows: output.rows.length,
    allRows: output.allRows.length, counts: output.counts };
}

// Complete serialized outputs pin order, statuses, counts and owner evidence.
export function possibleRowsMatrix(fixture, select) {
  const cases = [];
  for (const completion of ['any', 'all', 'personal']) for (const selectedMemberId of ['alpha', 'beta'])
    for (const ownerFilter of ['all', 'alpha', 'beta', 'both']) for (const personalFilter of ['group', 'not-done', 'only-player'])
      for (const switches of Array.from({ length: 16 }, (_, i) => i)) for (const filter of ['', ' FISHING ', 'missing']) {
        fixture.state.rules['tasks.completion'] = completion;
        const options = { selectedMemberId, ownerFilter, personalFilter, filter,
          showCompleted: !!(switches & 1), showBlocked: !!(switches & 2), showAll: !!(switches & 4), searchAll: !!(switches & 8) };
        cases.push({ completion, ...options, ...fingerprint(select(options)) });
      }
  // Toggle each filter back and forth on the same mutable results, then change
  // both owners' lists in place. These calls must never retain stale membership.
  for (const selectedMemberId of ['alpha', 'beta']) for (const personalFilter of ['group', 'not-done', 'only-player', 'not-done', 'group'])
    cases.push({ toggle: true, selectedMemberId, personalFilter, ...fingerprint(select({ selectedMemberId, personalFilter })) });
  for (const result of fixture.results) result.neverShowIds = [];
  for (const selectedMemberId of ['alpha', 'beta']) for (const personalFilter of ['group', 'not-done', 'only-player'])
    cases.push({ emptyLists: true, selectedMemberId, personalFilter, ...fingerprint(select({ selectedMemberId, personalFilter })) });
  for (const transition of ['absent-list', 'null-list', 'unversioned', 'stale-peer', 'stale-selected']) {
    for (const result of fixture.results) {
      if (transition === 'absent-list') delete result.neverShowIds;
      if (transition === 'null-list') result.neverShowIds = null;
      if (transition === 'unversioned') delete result.stateRevision;
      if (transition === 'stale-peer') result.stateRevision = fixture.state.revision - Number(result.memberId === 'beta');
      if (transition === 'stale-selected') result.stateRevision = fixture.state.revision - Number(result.memberId === 'alpha');
    }
    for (const selectedMemberId of ['alpha', 'beta']) for (const personalFilter of ['group', 'not-done', 'only-player'])
      cases.push({ transition, selectedMemberId, personalFilter, ...fingerprint(select({ selectedMemberId, personalFilter })) });
  }
  return cases;
}

async function main([mode, fixturePath, appRoot, scenario = 'not-done']) {
  if (mode === 'generate') {
    const fixture = possibleRowsFixture(Number(appRoot ?? 24000), Number(scenario === 'not-done' ? 4 : scenario));
    await writeFile(fixturePath, `${JSON.stringify(fixture)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ fixtureSha256: sha(await readFile(fixturePath)), size: fixture.size, neverEvery: fixture.neverEvery,
      tasks: fixture.results.map(result => result.tasks.length), neverShowIds: fixture.results.map(result => result.neverShowIds?.length ?? 0) }));
    return;
  }
  if (!['run', 'matrix'].includes(mode) || !fixturePath || !appRoot) throw new Error('See usage at top of script.');
  const { fixture, fixtureSha256, select } = await load(fixturePath, appRoot);
  if (mode === 'matrix') {
    const cases = possibleRowsMatrix(fixture, select);
    console.log(JSON.stringify({ fixtureSha256, cases }));
    return;
  }
  const options = scenario === 'group' ? {} : { personalFilter: scenario };
  if (!['group', 'not-done', 'only-player'].includes(scenario)) throw new Error('Unknown scenario.');
  select(options); // One identical warmup in each fresh process; no retained row cache.
  const timingsMs = [];
  let output;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    output = select(options);
    timingsMs.push(performance.now() - start);
  }
  console.log(JSON.stringify({ runtime: process.version, fixtureSha256, scenario, timingsMs, output: fingerprint(output),
    processMaxRssKiB: process.resourceUsage().maxRSS }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
