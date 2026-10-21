import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateState } from '../app/core/state.mjs';
import { createTaskEngine, skillCaps } from '../app/tasks/engine.mjs';
import { skillGuideCatalogue, skillGuideBreakpoints } from '../app/data/skill-guides.mjs';
import { applySkillguideCombatCorrections } from '../app/data/skillguide-combat-corrections.mjs';
import { loadPreviewState } from './preview-metadata-corrections.mjs';

export { loadPreviewState };
const availabilityFields = ['status', 'hidden', 'hiddenReasons', 'blockers', 'personalCompleted', 'challengeSatisfied',
  'obligation', 'primaryMethod', 'sources', 'explanation'];
const scenarios = [{ id: 'original', tasks: false, corrections: false }, { id: 'tasks', tasks: true, corrections: false },
  { id: 'corrections', tasks: false, corrections: true }, { id: 'both', tasks: true, corrections: true }];
const comparisons = [['original', 'tasks'], ['original', 'corrections'], ['original', 'both'], ['tasks', 'both']];
function differences(before = {}, after = {}) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(field => {
    const beforeExists = Object.hasOwn(before, field), afterExists = Object.hasOwn(after, field);
    if (beforeExists === afterExists && isDeepStrictEqual(before[field], after[field])) return [];
    return [{ field, before: beforeExists ? before[field] : null, after: afterExists ? after[field] : null,
      ...(!beforeExists || !afterExists ? { beforeExists, afterExists } : {}) }];
  });
}
function indexed(result) {
  const map = new Map();
  for (const row of result.tasks) {
    if (map.has(row.id)) throw new TypeError(`Duplicate generated task ID: ${row.id}`);
    map.set(row.id, row);
  }
  return map;
}
const availability = row => row ? Object.fromEntries(availabilityFields.map(field => [field, row[field] ?? null])) : {};
const capabilities = result => Object.fromEntries(['access', 'obligationAccess', 'items', 'ownItems', 'training', 'points'].map(field => [field, result[field]]));

/** Compare independent switches against identical validated personal facts.
 * Pure evaluation includes hidden/blocked tasks and downstream capabilities.
 * State hydration reuses the read-only backup/sidecar loader; no store opens. */
export function previewSkillGuides({ state, definitions, catalogue = skillGuideCatalogue, corrections, engineOptions = {} }) {
  const validated = validateState(state);
  const engines = new Map(scenarios.map(scenario => [scenario.id, createTaskEngine(definitions, { dataset: selectedDataset, ...engineOptions,
    skillGuideCatalogue: catalogue, skillGuideTasks: scenario.tasks, skillGuideCorrections: scenario.corrections,
    ...(corrections === undefined ? {} : { skillGuideCorrectionOverlay: data => applySkillguideCombatCorrections(data, { corrections }) }) })]));
  const results = new Map(scenarios.map(scenario => [scenario.id, new Map(validated.members.map(member =>
    [member.id, engines.get(scenario.id).evaluate(validated, member.id)]))]));
  return { revision: validated.revision, catalogueVersion: catalogue.version,
    scenarios: scenarios.map(scenario => ({ ...scenario })),
    comparisons: comparisons.map(([beforeId, afterId]) => ({ id: `${beforeId}-to-${afterId}`, before: beforeId, after: afterId,
      members: validated.members.map(member => {
        const beforeResult = results.get(beforeId).get(member.id), afterResult = results.get(afterId).get(member.id);
        const before = indexed(beforeResult), after = indexed(afterResult);
        const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
        const tasks = ids.flatMap(id => {
          const oldRow = before.get(id), newRow = after.get(id), row = newRow ?? oldRow;
          const metadata = differences(oldRow?.record, newRow?.record);
          const changes = differences(availability(oldRow), availability(newRow));
          if (!metadata.length && !changes.length && oldRow?.label === newRow?.label && oldRow?.category === newRow?.category) return [];
          return [{ id, category: row.category, label: row.label,
            ...(!oldRow || !newRow ? { presence: { before: !!oldRow, after: !!newRow } } : {}),
            metadata, availability: changes }];
        });
        return { id: member.id, name: member.name, checkedTaskCount: ids.length, changedTaskCount: tasks.length, tasks,
          capabilities: differences(capabilities(beforeResult), capabilities(afterResult)) };
      }) })),
    trainingBreakpoints: Object.keys(skillCaps).filter(skill => skill !== 'Combat').map(skill => ({ skill,
      breakpoints: skillGuideBreakpoints(skill, { catalogue, members: validated.rules?.['content.f2p'] === false }) })).filter(row => row.breakpoints.length) };
}

export function formatPreview(report) {
  const lines = [`Skill-guide preview (state revision ${report.revision}; catalogue ${report.catalogueVersion})`];
  for (const comparison of report.comparisons) {
    lines.push('', `${comparison.before} -> ${comparison.after}`);
    for (const member of comparison.members) {
      lines.push(`  ${member.name} (${member.id}): ${member.changedTaskCount} changed / ${member.checkedTaskCount} checked tasks`);
      for (const task of member.tasks) {
        lines.push(`    ${task.category}: ${task.label} [${task.id}]`);
        if (task.presence) lines.push(`      presence: ${task.presence.before} -> ${task.presence.after}`);
        for (const [kind, changes] of [['metadata', task.metadata], ['availability', task.availability]]) for (const change of changes) {
          lines.push(`      ${kind}.${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
        }
      }
      lines.push(`    Changed capability fields: ${member.capabilities.map(change => change.field).join(', ') || 'none'}`);
    }
  }
  lines.push('', `Training breakpoint metadata: ${report.trainingBreakpoints.reduce((count, row) => count + row.breakpoints.length, 0)} reviewed joins`);
  return lines.join('\n');
}

const usage = 'Usage: node scripts/preview-skill-guides.mjs --state PATH [--definitions PATH] [--catalogue PATH] [--corrections PATH] [--no-cache-walking] [--synthetic-definitions] [--json]';
export async function runPreviewCli(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') { process.stdout.write(`${usage}\n`); return; }
    if (flag === '--no-cache-walking') {
      if (options.noCacheWalking) throw new TypeError(usage);
      options.noCacheWalking = true; continue;
    }
    if (flag === '--synthetic-definitions') {
      if (options.syntheticDefinitions) throw new TypeError(usage);
      options.syntheticDefinitions = true; continue;
    }
    if (flag === '--json') { if (options.json) throw new TypeError(usage); options.json = true; continue; }
    if (!['--state', '--definitions', '--catalogue', '--corrections'].includes(flag) || !args[index + 1]
      || args[index + 1].startsWith('--') || options[flag.slice(2)]) throw new TypeError(usage);
    options[flag.slice(2)] = args[++index];
  }
  if (!options.state || (options.syntheticDefinitions && !options.definitions)) throw new TypeError(usage);
  const state = await loadPreviewState(options.state);
  const definitions = JSON.parse(await readFile(options.definitions ?? new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const catalogue = options.catalogue ? JSON.parse(await readFile(options.catalogue, 'utf8')) : undefined;
  const correctionDocument = options.corrections ? JSON.parse(await readFile(options.corrections, 'utf8')) : undefined;
  const report = previewSkillGuides({ state, definitions, catalogue, corrections: correctionDocument?.corrections ?? correctionDocument,
    engineOptions: { ...(options.noCacheWalking ? { cacheWalking: false } : {}),
      ...(options.syntheticDefinitions ? { reviewedOverlays: false } : {}) } });
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatPreview(report)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPreviewCli().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
