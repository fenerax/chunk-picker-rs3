import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorld } from '../app/data/world.mjs';
import { TRANSPORT_ROUTES } from '../app/data/transport-routes.mjs';
import { TRANSPORT_ACCESS_RULE } from '../app/data/cache-entry-policy.mjs';
import { evaluateRollPool, reachableSections, partnerConnections } from '../app/core/rules.mjs';
import { evaluateTransportRoutes } from '../app/core/transport-access.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { readStateCopy, summarizeTask, diffTasks } from './preview-resource-contents.mjs';

const sorted = values => [...new Set(values)].sort();
const difference = (before, after) => ({ added: after.filter(id => !before.includes(id)), removed: before.filter(id => !after.includes(id)) });

/** Same immutable world and same personal unlocks on both sides. The single
 * admission switch is the only changed input. No hypothetical unlock is made. */
export function buildTransportPreview(definitions, state, { transportRoutes = TRANSPORT_ROUTES, transportFactsByMember, ...options } = {}) {
  const original = JSON.stringify(state);
  const world = buildWorld(definitions, { dataset: selectedDataset, ...options });
  world.transportRoutes = transportRoutes;
  world.transportFactsByMember = transportFactsByMember;
  const topology = JSON.stringify([...(world.cacheWalking?.topology ?? world.sectionTopology)].map(([base, parts]) => [base, [...parts]]));
  const engine = createTaskEngine(definitions, { dataset: selectedDataset, ...options, transportRoutes, transportFactsByMember });
  const collection = createCollectionEngine(definitions, { dataset: selectedDataset });
  const before = { ...state, rules: { ...state.rules, [TRANSPORT_ACCESS_RULE]: false } };
  const after = { ...state, rules: { ...state.rules, [TRANSPORT_ACCESS_RULE]: true } };
  const evaluate = (input, id) => {
    const result = engine.evaluate(input, id);
    const additional = collection.evaluate(input, id, result).tasks;
    const equipment = evaluateEquipment(result, input, id, definitions);
    return { ...result, tasks: [...new Map([...result.tasks, ...additional, ...equipment.catalogue].map(task => [task.id, task])).values()] };
  };
  const members = [...state.members].sort((a, b) => a.id.localeCompare(b.id)).map(member => {
    const priorPool = evaluateRollPool(world, before, member.id), nextPool = evaluateRollPool(world, after, member.id);
    const priorIds = priorPool.eligible.map(row => row.id), nextIds = nextPool.eligible.map(row => row.id);
    const delta = difference(priorIds, nextIds);
    const prior = evaluate(before, member.id), next = evaluate(after, member.id);
    const tasks = diffTasks(prior.tasks.map(task => summarizeTask(task, state.identityRegistry)), next.tasks.map(task => summarizeTask(task, state.identityRegistry)));
    const ownBefore = reachableSections(world, before, member.id), ownAfter = reachableSections(world, after, member.id);
    const connectionsBefore = partnerConnections(world, before, member.id), connectionsAfter = partnerConnections(world, after, member.id);
    const capabilityBefore = sorted(prior.access.components?.length ? prior.access.components : prior.access.sections);
    const capabilityAfter = sorted(next.access.components?.length ? next.access.components : next.access.sections);
    const routes = evaluateTransportRoutes(world, after, member.id, { transportRoutes, transportFactsByMember });
    return { id: member.id, name: member.name,
      rollPool: { before: priorPool, after: nextPool,
        additions: delta.added.map(id => nextPool.eligible.find(row => row.id === id)),
        removals: delta.removed.map(id => ({ ...priorPool.eligible.find(row => row.id === id), afterReasons: nextPool.excluded.find(row => row.id === id)?.reasons ?? [] })),
        reasonChanges: nextPool.eligible.filter(row => priorIds.includes(row.id) && JSON.stringify(row.reasons) !== JSON.stringify(priorPool.eligible.find(old => old.id === row.id).reasons)) },
      reachable: { own: { before: ownBefore, after: ownAfter, ...difference(ownBefore, ownAfter) },
        capability: { before: capabilityBefore, after: capabilityAfter, ...difference(capabilityBefore, capabilityAfter) },
        partnerBefore: connectionsBefore, partnerAfter: connectionsAfter },
      tasks, routes, requirements: routes.filter(route => !route.available).map(({ id, unmet, unknown }) => ({ routeId: id, unmet, unknown })),
      counts: { beforeRollPool: priorIds.length, afterRollPool: nextIds.length, rollAdditions: delta.added.length, rollRemovals: delta.removed.length,
        beforeAvailable: prior.tasks.filter(task => task.status === 'available').length, afterAvailable: next.tasks.filter(task => task.status === 'available').length,
        availabilityGains: tasks.filter(task => task.becameAvailable).length, availabilityLosses: tasks.filter(task => task.becameUnavailable).length,
        availableRoutes: routes.filter(route => route.available).length, unmetRoutes: routes.filter(route => route.unmet.length).length, unknownRoutes: routes.filter(route => route.unknown.length).length } };
  });
  if (original !== JSON.stringify(state)) throw new Error('Transport preview mutated its input state.');
  if (topology !== JSON.stringify([...(world.cacheWalking?.topology ?? world.sectionTopology)].map(([base, parts]) => [base, [...parts]]))) throw new Error('Transport preview changed walking topology.');
  return { schemaVersion: 1, switch: TRANSPORT_ACCESS_RULE, defaultEnabled: false, beforeEnabled: false, afterEnabled: true,
    walkingTopologyUnchanged: true, ownershipUnchanged: true,
    taskCoverage: 'Task engine, collection goals and equipment catalogue; current personal unlocks, access and availability. Fares/items are availability declarations and are not consumed.', members };
}

export function renderTransportPreview(report) {
  const lines = [`Transport access preview: ${report.switch} OFF -> ON (default OFF)`, 'Walking topology and personal ownership are unchanged.', report.taskCoverage];
  for (const member of report.members) {
    lines.push('', `${member.name || member.id} [${member.id}]`, `Roll pool: ${member.counts.beforeRollPool} -> ${member.counts.afterRollPool}; +${member.counts.rollAdditions}/-${member.counts.rollRemovals}`);
    for (const row of member.rollPool.additions) lines.push(`  Added ${row.id}: ${row.reasons.map(reason => `${reason.ruleId}: ${reason.detail}`).join('; ')}`);
    for (const row of member.rollPool.removals) lines.push(`  Removed ${row.id}: ${row.afterReasons.map(reason => `${reason.ruleId}: ${reason.detail}`).join('; ')}`);
    for (const [scope, reach] of Object.entries(member.reachable)) if (reach.before) lines.push(`Reachable ${scope}: ${JSON.stringify(reach.before)} -> ${JSON.stringify(reach.after)}`);
    lines.push(`Available task rows: ${member.counts.beforeAvailable} -> ${member.counts.afterAvailable}; gains ${member.counts.availabilityGains}, losses ${member.counts.availabilityLosses}`);
    for (const task of member.tasks) lines.push(`  ${task.label} [${task.id}]: ${task.becameAvailable ? 'became available' : task.becameUnavailable ? 'became unavailable' : 'sources changed'}`);
    lines.push(`Routes: ${member.counts.availableRoutes} usable, ${member.counts.unmetRoutes} with unmet requirements, ${member.counts.unknownRoutes} with unknown requirements`);
    for (const row of member.requirements) lines.push(`  ${row.routeId}: unmet ${JSON.stringify(row.unmet)}; unknown ${JSON.stringify(row.unknown)}`);
  }
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  const flags = {}, usage = 'Use node scripts/preview-transport-access.mjs --state <state.json copy> [--json] [--facts <facts.json>] [--routes <routes.json>] [--definitions <definitions.json>] [--no-cache-walking] [--synthetic-definitions]';
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--json' && !flags.json) flags.json = true;
    else if (flag === '--synthetic-definitions' && !flags.syntheticDefinitions) flags.syntheticDefinitions = true;
    else if (flag === '--no-cache-walking' && !flags.noCacheWalking) flags.noCacheWalking = true;
    else if (['--state', '--facts', '--routes', '--definitions'].includes(flag) && !flags[flag] && args[index + 1] && !args[index + 1].startsWith('--')) flags[flag] = args[++index];
    else throw new Error(usage);
  }
  if (!flags['--state'] || (flags.syntheticDefinitions && !flags['--definitions'])) throw new Error(usage);
  const loaded = await readStateCopy(flags['--state']), dependencies = [];
  async function readInput(file) {
    const resolved = await realpath(file);
    if (/[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(resolved)) throw new Error('Use copied inputs outside .local/duo.');
    const bytes = await readFile(resolved);
    dependencies.push({ file: resolved, bytes });
    return JSON.parse(bytes.toString('utf8'));
  }
  const definitions = flags['--definitions'] ? await readInput(flags['--definitions']) : JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const transportRoutes = flags['--routes'] ? await readInput(flags['--routes']) : TRANSPORT_ROUTES;
  const transportFactsByMember = flags['--facts'] ? await readInput(flags['--facts']) : undefined;
  const report = { ...buildTransportPreview(definitions, loaded.state, { transportRoutes, transportFactsByMember,
    ...(flags.noCacheWalking ? { cacheWalking: false } : {}),
    ...(flags.syntheticDefinitions ? { reviewedOverlays: false } : {}) }), sourceSha256: loaded.sourceSha256,
    inputSha256: dependencies.map(dependency => ({ file: dependency.file, sha256: createHash('sha256').update(dependency.bytes).digest('hex') })) };
  await loaded.verifyUnchanged();
  for (const dependency of dependencies) if (!dependency.bytes.equals(await readFile(dependency.file))) throw new Error('Preview input changed during evaluation.');
  process.stdout.write(`${flags.json ? JSON.stringify(report, null, 2) : renderTransportPreview(report)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
