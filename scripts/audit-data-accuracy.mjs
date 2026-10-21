import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { loadPreviewState } from './preview-metadata-corrections.mjs';
import { createTaskFactsIndex } from '../app/core/progress-index.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { taskItemIcon } from '../app/tasks/task-icons.mjs';
import { createIconCatalogue } from '../app/data/icons.mjs';
import { createIconHelper } from '../app/web/icons.mjs';
import { projectPlayTask } from '../app/play-view.mjs';
import { sha256 } from './lib/provenance-hash.mjs';

// Whitelisted summaries from an isolated copied save, never a store or server.
// The fixture and optional historical source must remain in this worktree.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--state', '--source', '--label', '--icon-assets'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node scripts/audit-data-accuracy.mjs --state COPIED_STATE --label before|after [--source ARCHIVED_ROOT] [--icon-assets COPIED_ICON_ROOT]');
  options[args[index].slice(2)] = args[index + 1];
}
if (!options.state || !/^[a-z0-9-]+$/.test(options.label ?? '')) throw new Error('Copied state and safe label required.');
const local = await realpath(path.join(ROOT, '.local'));
const contained = target => { const relative = path.relative(local, target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };
const stateFile = await realpath(options.state);
if (!contained(stateFile)) throw new Error('Read only a copied state inside this worktree .local.');
const source = options.source ? await realpath(options.source) : ROOT;
if (source !== ROOT && !contained(source)) throw new Error('Historical source must be archived inside this worktree .local.');
const iconAssets = options['icon-assets'] ? await realpath(options['icon-assets']) : undefined;
if (iconAssets && !contained(iconAssets)) throw new Error('Icon manifests must be copied inside this worktree .local.');
const stateBytes = await readFile(stateFile), state = await loadPreviewState(stateFile);
const definitions = JSON.parse(await readFile(path.join(source, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
const { selectedDataset } = await import(pathToFileURL(path.join(source, 'app/dataset-runtime.mjs'))).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;
});
const { buildWorld } = await import(pathToFileURL(path.join(source, 'app/data/world.mjs')));
const oldManifests = await Promise.all(['skill', 'item'].map(kind => readFile(path.join(source, `app/data/${kind}-icons.2026-10-08.v1.json`), 'utf8').then(JSON.parse)));
const manifests = source === ROOT ? [...oldManifests, JSON.parse(await readFile(path.join(source, 'app/data/item-icons.2026-10-09.v1.json'), 'utf8'))] : oldManifests;
const icons = createIconCatalogue(manifests);
const lookup = name => icons.lookup('item', name)?.url ?? null;
const resolverFor = (catalogue, itemLookup = name => catalogue.lookup('item', name)?.url ?? null) => {
  return source === ROOT ? task => taskItemIcon(projectPlayTask(task), itemLookup) : task => {
    const marked = /~\|([^|#]*)/.exec(task.rawLabel ?? '')?.[1];
    return (task.equipmentName && itemLookup(task.equipmentName)) || (marked && itemLookup(marked)) || null;
  };
};
const iconFor = resolverFor(icons);
let deliveredIcons, deliveredIconFor;
const iconDelivery = [];
if (iconAssets) {
  const installed = [];
  for (const manifest of manifests) {
    const evidence = { assetDirectory: manifest.assetDirectory, accepted: false };
    try {
      const file = await realpath(path.join(iconAssets, manifest.assetDirectory, 'manifest.json'));
      const relative = path.relative(iconAssets, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Copied icon manifest escapes its asset root.');
      const copyBytes = await readFile(file), copy = JSON.parse(copyBytes);
      evidence.manifestSha256 = sha256(copyBytes);
      // Same full-object acceptance check as the server. Missing or mismatched
      // provenance excludes the entire bundle even when its artwork is present.
      if (JSON.stringify(copy) === JSON.stringify(manifest)) {
        installed.push(manifest); evidence.accepted = true;
      } else evidence.reason = 'manifest-mismatch';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      evidence.reason = 'missing-manifest';
    }
    iconDelivery.push(evidence);
  }
  deliveredIcons = createIconCatalogue(installed);
  // Exercise the compact browser name index over the accepted installed
  // bundles, without contacting a server or downloading artwork.
  const deliveredHelper = createIconHelper(async () => ({ ok: true, json: async () => deliveredIcons.manifest }));
  if (!await deliveredHelper.loadIcons()) throw new Error('Accepted installed icon catalogue failed compact client validation.');
  deliveredIconFor = resolverFor(deliveredIcons, deliveredHelper.itemIcon);
}
const worker = new Worker(pathToFileURL(path.join(source, 'app/tasks/worker.mjs')), { execArgv: [], workerData: { definitions, world: buildWorld(definitions, { dataset: selectedDataset }) } });
const summary = { label: options.label, revision: state.revision, stateSha256: sha256(stateBytes), members: [],
  ...(iconAssets ? { iconDelivery: { scope: 'Accepted installed full manifests; PNG bytes independently verified by copied-icon-bundle.json.', bundles: iconDelivery } } : {}) };
try {
  const [ready] = await once(worker, 'message');
  if (ready.type !== 'ready') throw new Error('Audit worker not ready.');
  for (const [index, member] of state.members.entries()) {
    const pending = once(worker, 'message'); worker.postMessage({ id: index + 1, state, memberId: member.id, type: 'evaluate' });
    const [message] = await pending;
    if (message.error) throw new Error('Copied-save evaluation failed.');
    const result = message.result;
    const eligible = task => task.obligation !== false && !task.hidden && task.status === 'available';
    const facts = createTaskFactsIndex(state, member.id, createRuleRegistry(), { tasks: result.tasks, completionGroups: result.collectionPlanning?.completionGroups });
    const active = task => eligible(task) && !member.taskStatus?.[task.id]?.backlogged && !facts.get(task.id, task.completionIds).group;
    const presented = result.presentation.tasks.filter(eligible), possible = result.tasks.filter(eligible);
    const countIcons = (rows, catalogue, resolveIcon) => ({ total: rows.length, itemIcons: rows.filter(resolveIcon).length,
      skillFallback: rows.filter(task => !resolveIcon(task) && catalogue.lookup('skill', task.category)).length,
      noIcon: rows.filter(task => !resolveIcon(task) && !catalogue.lookup('skill', task.category)).length });
    const counts = rows => countIcons(rows, icons, iconFor);
    const guides = result.tasks.filter(task => task.id.startsWith('rs3:task:skill-guide:')).map(task => ({ id: task.id, label: task.label, level: task.level,
      status: task.status, obligation: task.obligation, presented: presented.some(row => row.id === task.id), active: presented.some(row => row.id === task.id) && active(task) }));
    const war = result.tasks.find(task => task.id === 'rs3:task:0003c5');
    summary.members.push({ id: member.id, name: member.name, guideMilestones: guides,
      activeGuideMilestones: guides.filter(task => task.active),
      icons: { presented: counts(presented), active: counts(presented.filter(active)), possible: counts(possible),
        allPossibleActive: counts(possible.filter(active)),
        ...(deliveredIcons ? { delivered: { presented: countIcons(presented, deliveredIcons, deliveredIconFor),
          possible: countIcons(possible, deliveredIcons, deliveredIconFor),
          allPossibleActive: countIcons(possible.filter(active), deliveredIcons, deliveredIconFor) } } : {}) },
      engineAvailableCount: result.metrics.availableCount,
      war: war && { id: war.id, level: war.level, status: war.status, obligation: war.obligation, blockers: war.blockers, description: war.record?.Description,
        presented: presented.some(row => row.id === war.id), alternatives: war.record?.RequirementAlternatives },
      examples: ['Skull lantern (tier 10)', 'Team-1 cape', 'Death guard (tier 10)', 'Deathwarden robe top (tier 10)'].map(name => ({ name,
        assetAvailable: !!lookup(name), plainObtainTaskIcon: !!iconFor({ label: `Obtain a ${name}`, rawLabel: `Obtain a ${name}` }) })) });
    console.log(`${options.label} ${member.name}: ${presented.length} presented, ${possible.length} possible; ${guides.filter(task => task.active).length} active guide milestones.`);
  }
} finally { await worker.terminate(); }
if (sha256(await readFile(stateFile)) !== summary.stateSha256) throw new Error('Copied state changed during read-only audit.');
const output = path.join(local, 'dataacc-audit'); await mkdir(output, { recursive: true });
await writeFile(path.join(output, `${options.label}.json`), `${JSON.stringify(summary, null, 2)}\n`);
