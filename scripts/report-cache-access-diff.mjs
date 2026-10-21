import { selectedDataset } from '../app/dataset-runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWorld } from '../app/data/world.mjs';
import cacheWalkability from '../app/data/cache-walkability.2026-10-07.v1.json' with { type: 'json' };
import { cacheSectionId } from '../app/data/cache-topology.mjs';

const setDifference = (a = [], b = []) => a.filter(id => !b.includes(id));
const unique = values => [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
// Sources/diagnostics are sets for this comparison; actual UI order is reported
// independently by the renderer's arrays, so reordering cannot invent losses.
const canonical = value => Array.isArray(value) ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const code = value => '`' + JSON.stringify(value).replaceAll('`', '\\u0060').replaceAll('|', '\\u007c') + '`';
const legacy = values => values.filter(id => /^\d+-\d+$/.test(id) && Number(id.split('-')[1]) < 1000000);
const flattenStrings = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(flattenStrings)
  : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => [key, ...flattenStrings(child)]) : [];

export function createEvidenceLookup(definitions, world, before, after) {
  const cache = world.cacheWalking;
  const sourceCache = new Map(), locationCache = new Map(), diagnosticIndex = new Map();
  for (const record of [...after.diagnostics, ...after.access.diagnostics ?? [], ...after.obligationAccess.diagnostics ?? []]) {
    for (const key of unique([record.source, record.location, record.from, record.selector, record.taskId, record.task].filter(Boolean))) {
      if (!diagnosticIndex.has(key)) diagnosticIndex.set(key, []);
      diagnosticIndex.get(key).push(record);
    }
  }
  const mappingsByBase = new Map(), componentsByBase = new Map();
  const boundaryWitnesses = new Map();
  for (const [from, to, portals, x, y] of cacheWalkability.edges) {
    const [fromBase, fromLabel] = from.split(':'), [toBase, toLabel] = to.split(':');
    const a = cacheSectionId(fromBase, fromLabel), b = cacheSectionId(toBase, toLabel);
    const witness = { portals, exampleTile: [x, y], evidence: 'cache-walkability.edges' };
    boundaryWitnesses.set(`${a}:${b}`, witness); boundaryWitnesses.set(`${b}:${a}`, witness);
  }
  for (const record of cache.mapping) { const base = record.legacy.split('-')[0]; if (!mappingsByBase.has(base)) mappingsByBase.set(base, []); mappingsByBase.get(base).push(record); }
  for (const id of cache.components.keys()) { const base = id.split('-')[0]; if (!componentsByBase.has(base)) componentsByBase.set(base, []); componentsByBase.get(base).push(id); }
  const locationsForSource = key => unique([...(before.access.locations[key] ?? []), ...(after.access.locations[key] ?? []),
    ...(before.obligationAccess.locations[key] ?? []), ...(after.obligationAccess.locations[key] ?? [])]);
  const plural = { Object: 'Objects', NPC: 'NPCs', Monster: 'Monsters', Shop: 'Shops', Spawn: 'Spawns' };
  const sourceEvidence = key => {
    if (sourceCache.has(key)) return sourceCache.get(key);
    const separator = key.indexOf(':'), kind = key.slice(0, separator), name = key.slice(separator + 1);
    const declared = Object.keys(definitions.taskUnlocks?.[plural[kind]]?.[name] ?? {});
    const locations = unique([...locationsForSource(key), ...declared]);
    const evidence = { source: key, before: before.access.locations[key] ?? [], after: after.access.locations[key] ?? [],
      obligationBefore: before.obligationAccess.locations[key] ?? [], obligationAfter: after.obligationAccess.locations[key] ?? [], declared,
      diagnostics: (diagnosticIndex.get(name) ?? []).filter(record => record.source === name),
      locations: locations.map(locationEvidence) };
    sourceCache.set(key, evidence);
    return evidence;
  };
  const reached = new Set(after.access.components ?? []), ownReached = new Set(after.obligationAccess.components ?? []);
  function locationEvidence(id) {
    if (locationCache.has(id)) return locationCache.get(id);
    const numeric = /^\d+(?:-\d+)?$/.test(id), base = numeric ? id.split('-')[0] : null;
    const entrances = unique([...(before.access.entranceSources?.[id] ?? []), ...(after.access.entranceSources?.[id] ?? []),
      ...(before.obligationAccess.entranceSources?.[id] ?? []), ...(after.obligationAccess.entranceSources?.[id] ?? [])]);
    const mappings = numeric ? (mappingsByBase.get(base) ?? []).filter(record => record.legacy === id || !id.includes('-')) : [];
    const ids = base ? (componentsByBase.get(base) ?? []).filter(component =>
      (!id.includes('-') || component === id || mappings.some(record => [...record.components, ...record.candidates].includes(cache.components.get(component).label)))) : [];
    const evidence = { location: id, cacheCoverage: base ? cache.coverage.get(base) ?? 'outside-cache-surface' : 'retained-interior',
      fallback: base ? cache.fallback.has(base) : false, mappings,
      compatibility: { before: (before.access.compatibilitySections ?? []).includes(id), after: (after.access.compatibilitySections ?? []).includes(id),
        obligationAfter: (after.obligationAccess.compatibilitySections ?? []).includes(id) },
      components: ids.map(component => ({ ...cache.components.get(component), reached: reached.has(component), ownReached: ownReached.has(component),
        boundaries: (cache.topology.get(base)?.get(component.split('-')[1]) ?? []).map(from => ({ from, reached: reached.has(from), ownReached: ownReached.has(from), membership: cache.components.get(from)?.free ?? null,
          cacheWitness: boundaryWitnesses.get(`${from}:${component}`) ?? null,
          retainedFallback: cache.fallbackRoutes.filter(route => route.from === from && route.to === component) })) })),
      entrances: entrances.map(entrance => /^\d+(?:-\d+)?$/.test(entrance) ? locationEvidence(entrance) : { location: entrance, type: 'retained-interior-entrance' }),
      diagnostics: (diagnosticIndex.get(id) ?? []).filter(record => record.location === id || record.from === id || record.selector === id) };
    locationCache.set(id, evidence);
    return evidence;
  }
  function taskEvidence(a, b) {
    const tasks = [a, b].filter(Boolean), sourceKeys = new Set();
    const fieldKinds = { Objects: 'Object', NPCs: 'NPC', Monsters: 'Monster', Shops: 'Shop' };
    const locations = new Set();
    for (const task of tasks) {
      for (const field of ['Chunks', 'Sections', 'Areas']) for (const location of flattenStrings(task.requirements?.[field])) locations.add(location);
      for (const [field, kind] of Object.entries(fieldKinds)) for (const name of flattenStrings(task.requirements?.[field])) {
        for (const resolved of definitions.codeItems?.[`${field.toLowerCase()}Plus`]?.[name] ?? [name]) sourceKeys.add(`${kind}:${resolved}`);
      }
      for (const source of task.sources ?? []) {
        if (source.location) locations.add(source.location);
        for (const location of source.locations ?? []) locations.add(location);
        const kind = { object: 'Object', objects: 'Object', npc: 'NPC', npcs: 'NPC', drop: 'Monster', monsters: 'Monster', shop: 'Shop', shops: 'Shop' }[source.kind];
        if (kind && (source.name || source.source)) sourceKeys.add(`${kind}:${source.name || source.source}`);
      }
      // Blocked tasks frequently have no sources; blocker detail and declared
      // requirements remain the evidence rather than a fabricated location.
      for (const blocker of task.blockers ?? []) for (const value of flattenStrings(blocker)) if (/^\d+(?:-\d+)?$/.test(value)) locations.add(value);
    }
    return { sourceEvidence: [...sourceKeys].map(sourceEvidence), locationEvidence: [...locations].map(locationEvidence),
      diagnostics: tasks.flatMap(task => [...diagnosticIndex.get(task.id) ?? [], ...diagnosticIndex.get(task.label) ?? []]).filter(record => tasks.some(task => record.taskId === task.id || record.task === task.label)),
      note: locations.size || sourceKeys.size ? 'Boundary witnesses describe current component admission; task requirements and blockers determine the resulting task state.' : 'No direct geographic requirement/source is attached. Compare recorded blockers, suppression and training prerequisites; a cache boundary cause is not established for this row.' };
  }
  return { locationEvidence, sourceEvidence, taskEvidence };
}

export function renderComparison(before, after, definitions) {
  if (before.schemaVersion !== 2 || after.schemaVersion !== 2) throw new Error('Regenerate both snapshots with comparison schema 2.');
  if (before.cacheWalking !== false || after.cacheWalking !== true) throw new Error('Expected retained baseline false and cache comparison true.');
  if (before.sourceSha256 !== after.sourceSha256 || before.definitionSha256 !== after.definitionSha256) throw new Error('Snapshots must use the identical input and definitions.');
  if (before.members.length !== after.members.length || before.members.some((member, index) => member.member !== after.members[index].member)) throw new Error('Member snapshots do not align.');
  const world = buildWorld(definitions, { dataset: selectedDataset, cacheWalking: true });
  if (createHash('sha256').update(JSON.stringify(definitions)).digest('hex') !== after.definitionSha256) throw new Error('Current definitions differ from comparison; regenerate snapshots.');
  const cacheStateSha256 = createHash('sha256').update(JSON.stringify({ mapping: world.cacheWalking.mapping,
    components: [...world.cacheWalking.components], topology: [...world.cacheWalking.topology].map(([base, sections]) => [base, [...sections]]) })).digest('hex');
  if (after.cacheStateSha256 !== cacheStateSha256) throw new Error('Cache policy/topology changed since comparison or fingerprint is missing; regenerate snapshots.');
  const lines = ['# Anonymous derived cache access comparison', '',
    'Both calculations use the same unchanged input. Before is the corrected retained world with cache walking disabled; after uses cache walking. No private save, names, notes, account XP or history is included. Keep this derived gameplay report ignored.', '',
    `Definitions SHA-256: ${code(before.definitionSha256)}. Input equality SHA-256: ${code(before.sourceSha256)}.`, '',
    'This is an application behavior comparison. Each loss and gain below records the resulting blockers, source locations and available boundary evidence. An unresolved mapping neither proves a real-world loss nor excuses an application loss. Compatibility selectors expose retained resources without creating walking reachability.', '',
    'Task views run the actual browser renderTasks function in a DOM-free harness. Collection, equipment and presentation follow the server worker sequence. Activity training uses buildActivityInfo. Default controls use saved hideCompleted, empty search, Show blocked off and All possible tasks off; other views change one control. Counts cover all rows, including those behind Show more.', '',
    `Cache provenance: ${code(after.cacheProvenance)}.`, ''];
  const label = id => `${id} ${world.chunks.get(id)?.name ?? ''}`.trim();
  for (let index = 0; index < before.members.length; index++) {
    const a = before.members[index], b = after.members[index], evidence = createEvidenceLookup(definitions, world, a, b);
    const evidenceCatalogue = new Map();
    const proof = (kind, key) => {
      const identity = `${kind}:${key}`;
      if (!evidenceCatalogue.has(identity)) evidenceCatalogue.set(identity, { anchor: `member-${index + 1}-evidence-${evidenceCatalogue.size + 1}`, kind, key,
        data: kind === 'source' ? evidence.sourceEvidence(key) : evidence.locationEvidence(key) });
      const entry = evidenceCatalogue.get(identity);
      return `[${kind} ${key}](#${entry.anchor})`;
    };
    const taskProof = (old, next) => {
      const data = evidence.taskEvidence(old, next);
      return `${data.sourceEvidence.map(source => proof('source', source.source)).join(', ')} ${data.locationEvidence.map(location => proof('location', location.location)).join(', ')}. Diagnostics: ${code(data.diagnostics)}. ${data.note}`;
    };
    lines.push(`## ${a.member}`, '', '| Measure | Before | After |', '| --- | ---: | ---: |',
      `| Roll pool | ${a.pool.length} | ${b.pool.length} |`, `| Available obligation tasks (server) | ${a.availableTaskCount} | ${b.availableTaskCount} |`,
      `| Presented task IDs | ${a.presentedTasks.length} | ${b.presentedTasks.length} |`);
    for (const [view, value] of Object.entries(a.ui)) for (const measure of ['activeCount', 'backlogCount', 'completedCount']) lines.push(`| UI ${view} ${measure} | ${value[measure]} | ${b.ui[view][measure]} |`);
    lines.push('', '### Roll pool changes', '');
    const rollIds = unique([...a.pool.map(row => row.id), ...b.pool.map(row => row.id)]);
    let changes = 0;
    for (const id of rollIds) {
      const old = a.pool.find(row => row.id === id), next = b.pool.find(row => row.id === id);
      if (same(old, next)) continue;
      changes++;
      lines.push(`- ${!old ? 'Added' : !next ? 'Removed' : 'Reasons changed'} **${label(id)}**. Before: ${code(old ?? a.excluded.find(row => row.id === id) ?? null)}. After: ${code(next ?? b.excluded.find(row => row.id === id) ?? null)}. Evidence: ${proof('location', id)}`);
    }
    if (!changes) lines.push('No eligible chunk or eligibility reason changes.');
    lines.push('', '### Named region checks', '', '| Region | Before pool | After pool | Current reasons / boundary evidence |', '| --- | --- | --- | --- |');
    for (const id of ['13621', '13622', '13623', '13877', '13878', '17460', '17461', '17716', '17717', '18228', '18230', '18482', '12592', '8495']) {
      const old = a.pool.find(row => row.id === id), next = b.pool.find(row => row.id === id), excluded = b.excluded.find(row => row.id === id);
      lines.push(`| ${label(id)} | ${old ? 'Yes' : 'No'} | ${next ? 'Yes' : 'No'} | ${code(next?.reasons ?? excluded?.reasons ?? [])}; ${proof('location', id)} |`);
    }
    for (const scope of ['obligationAccess', 'access']) {
      lines.push('', `### ${scope === 'access' ? 'Own plus admitted partner capability' : 'Own obligation access'}`, '', '| Measure | Before | After |', '| --- | ---: | ---: |');
      const keys = ['bases', 'sections', 'components', 'compatibilitySections', 'areas', 'possibleAreas', 'blockedAreas', 'objects', 'npcs', 'monsters', 'shops'];
      for (const key of keys) lines.push(`| ${key} | ${a[scope][key]?.length ?? 0} | ${b[scope][key]?.length ?? 0} |`);
      lines.push(`| Legacy resource sections | ${legacy(a[scope].sections).length} | ${legacy(b[scope].sections).length} |`, '');
      for (const key of keys) {
        const additions = setDifference(b[scope][key], a[scope][key]), removals = setDifference(a[scope][key], b[scope][key]);
        if (!additions.length && !removals.length) continue;
        lines.push(`#### ${key}`, '');
        for (const [direction, ids] of [['Added', additions], ['Removed', removals]]) for (const id of ids) {
          const kind = { objects: 'Object', npcs: 'NPC', monsters: 'Monster', shops: 'Shop' }[key];
          lines.push(`- ${direction}: ${code(id)}. Evidence: ${kind ? proof('source', `${kind}:${id}`) : proof('location', id)}`);
        }
        lines.push('');
      }
      lines.push('#### Source-location changes (including sources still present)', '');
      let changedLocations = 0;
      for (const key of unique([...Object.keys(a[scope].locations), ...Object.keys(b[scope].locations)])) {
        const old = a[scope].locations[key] ?? [], next = b[scope].locations[key] ?? [];
        if (same(old, next)) continue;
        changedLocations++;
        lines.push(`- ${code(key)}: ${code(old)} → ${code(next)}. Added ${code(setDifference(next, old))}; removed ${code(setDifference(old, next))}. Evidence: ${proof('source', key)}`);
      }
      if (!changedLocations) lines.push('No source-location changes.');
      lines.push('', '#### Entrance provenance changes', '');
      let entranceChanges = 0;
      for (const id of unique([...Object.keys(a[scope].entranceSources ?? {}), ...Object.keys(b[scope].entranceSources ?? {})])) {
        const old = a[scope].entranceSources?.[id] ?? [], next = b[scope].entranceSources?.[id] ?? [];
        if (same(old, next)) continue;
        entranceChanges++;
        lines.push(`- ${code(id)}: ${code(old)} → ${code(next)}. Evidence: ${proof('location', id)}`);
      }
      if (!entranceChanges) lines.push('No entrance provenance changes.');
      lines.push('', '#### Spawn quantities and access metadata', '');
      let metadataChanges = 0;
      for (const key of ['spawns', 'questSteps', 'clues', 'backloggedSources', 'diagnostics']) {
        const old = a[scope][key], next = b[scope][key];
        if (same(old, next)) continue;
        metadataChanges++;
        if (key === 'diagnostics') {
          const oldKeys = new Set((old ?? []).map(row => JSON.stringify(canonical(row)))), nextKeys = new Set((next ?? []).map(row => JSON.stringify(canonical(row))));
          lines.push(`- diagnostics: added ${code((next ?? []).filter(row => !oldKeys.has(JSON.stringify(canonical(row)))))}; removed ${code((old ?? []).filter(row => !nextKeys.has(JSON.stringify(canonical(row)))))}.`);
        } else lines.push(`- ${key}: ${code(old ?? null)} → ${code(next ?? null)}.`);
      }
      if (!metadataChanges) lines.push('No spawn quantity or access metadata changes.');
    }
    lines.push('', '### Reachable travel sections and partner access', '');
    lines.push(`Travel sections added: ${code(setDifference(b.sections, a.sections))}. Removed: ${code(setDifference(a.sections, b.sections))}.`);
    if (!same(a.partner, b.partner)) lines.push('', `Before partner result: ${code(a.partner)}`, '', `After partner result: ${code(b.partner)}`);
    else lines.push('', 'No partner connection changes.');
    if (!same(a.rollPartner, b.rollPartner)) lines.push('', `Before roll-rule partner result: ${code(a.rollPartner)}`, '', `After roll-rule partner result: ${code(b.rollPartner)}`);
    lines.push('', '### UI visibility differences', '');
    for (const [view, old] of Object.entries(a.ui)) {
      const next = b.ui[view];
      lines.push(`#### ${view}`, '', `Controls: ${code(next.controls)}. Count label: ${code(old.countLabel)} → ${code(next.countLabel)}.`, '');
      for (const key of ['active', 'backlog', 'completed']) lines.push(`- ${key}: added ${code(setDifference(next[key], old[key]))}; removed ${code(setDifference(old[key], next[key]))}.`);
      if (!same(old.active, next.active) && !setDifference(next.active, old.active).length && !setDifference(old.active, next.active).length) lines.push('- Active order changed; membership stayed equal.');
      lines.push('');
    }
    lines.push('Presented IDs added: ' + code(setDifference(b.presentedTasks, a.presentedTasks)) + '; removed: ' + code(setDifference(a.presentedTasks, b.presentedTasks)) + '.', '', '### Task changes with reasons and source evidence', '');
    const oldTasks = new Map(a.tasks.map(task => [task.id, task])), nextTasks = new Map(b.tasks.map(task => [task.id, task]));
    let taskChanges = 0;
    for (const id of unique([...oldTasks.keys(), ...nextTasks.keys()])) {
      const old = oldTasks.get(id), next = nextTasks.get(id);
      if (same(old, next)) continue;
      taskChanges++;
      const fields = unique([...Object.keys(old ?? {}), ...Object.keys(next ?? {})]).filter(key => !same(old?.[key], next?.[key]));
      const priorSources = new Map((old?.sources ?? []).map(source => [JSON.stringify(canonical(source)), source]));
      const currentSources = new Map((next?.sources ?? []).map(source => [JSON.stringify(canonical(source)), source]));
      const sourceChanges = { beforeCount: old?.sources?.length ?? 0, afterCount: next?.sources?.length ?? 0,
        added: [...currentSources].filter(([key]) => !priorSources.has(key)).map(([, value]) => value), removed: [...priorSources].filter(([key]) => !currentSources.has(key)).map(([, value]) => value) };
      lines.push(`<a id="member-${index + 1}-task-${id.replaceAll(':', '-')}"></a>`, '', `#### ${next?.label ?? old.label} (${id})`, '', `Changed fields: ${fields.join(', ')}.`, '',
        `Before: ${code(old ? { ...old, sources: undefined } : null)}`, '', `After: ${code(next ? { ...next, sources: undefined } : null)}`, '',
        `Source changes: ${code(sourceChanges)}`, '', `Evidence: ${taskProof(old, next)}`, '');
    }
    if (!taskChanges) lines.push('No task state, obligation, suppression or source changes.', '');
    lines.push('### Activity Info training ceilings and methods', '', '| Skill | Ceiling before | Ceiling after | Primary before | Primary after |', '| --- | ---: | ---: | --- | --- |');
    const skills = unique([...a.activityTraining.map(row => row.skill), ...b.activityTraining.map(row => row.skill)]);
    for (const skill of skills) {
      const old = a.activityTraining.find(row => row.skill === skill), next = b.activityTraining.find(row => row.skill === skill);
      lines.push(`| ${skill} | ${old?.reachableLevel ?? '—'} | ${next?.reachableLevel ?? '—'} | ${old?.primary ?? '—'} | ${next?.primary ?? '—'} |`);
    }
    lines.push('');
    for (const skill of skills) {
      const old = a.activityTraining.find(row => row.skill === skill), next = b.activityTraining.find(row => row.skill === skill);
      if (same(old, next) && same(a.training[skill], b.training[skill])) continue;
      lines.push(`- ${skill}. Before: ${code({ activity: old, training: a.training[skill] })}. After: ${code({ activity: next, training: b.training[skill] })}.`);
    }
    lines.push('', '### Diagnostic differences', '');
    for (const key of ['diagnostics', 'presentationDiagnostics']) {
      const old = a[key] ?? [], next = b[key] ?? [];
      const additions = next.filter(row => !old.some(prior => same(row, prior))), removals = old.filter(row => !next.some(current => same(row, current)));
      lines.push(`- ${key}: added ${code(additions)}; removed ${code(removals)}.`);
    }
    lines.push('', `Changed task rows: ${taskChanges}. All differences are enumerated; no example limit or truncation is applied.`, '');
    lines.push('### Cache/source evidence catalogue', '', 'Evidence entries are shared by the per-item links above. Task source additions/removals are complete; unchanged source records are available in the paired JSON snapshots.', '');
    for (const entry of evidenceCatalogue.values()) lines.push(`<a id="${entry.anchor}"></a>`, '', `#### ${entry.kind} ${entry.key}`, '', code(entry.data), '');
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (![2, 3].includes(args.length)) throw new Error('Use DUAL_REPORT.json IGNORED_REPORT.md or BEFORE.json AFTER.json IGNORED_REPORT.md');
  let before, after;
  if (args.length === 2) ({ before, after } = JSON.parse(await fs.readFile(args[0], 'utf8')));
  else { before = JSON.parse(await fs.readFile(args[0], 'utf8')); after = JSON.parse(await fs.readFile(args[1], 'utf8')); }
  const output = path.resolve(args.at(-1)), localRoot = fileURLToPath(new URL('../.local/', import.meta.url)), relative = path.relative(localRoot, output);
  if (relative.startsWith('..') || path.isAbsolute(relative) || args.slice(0, -1).some(input => path.resolve(input).toLowerCase() === output.toLowerCase())) throw new Error('Write a distinct ignored output under this worktree .local/.');
  const definitions = JSON.parse(await fs.readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const report = renderComparison(before, after, definitions);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, report);
  console.log('Complete anonymous derived difference report written; no private state printed.');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
