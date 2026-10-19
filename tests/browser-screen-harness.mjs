import { readFile } from 'node:fs/promises';
import { runInContext, Script } from 'node:vm';
import * as customTasks from '../app/web/custom-tasks-model.mjs';
import { playerControlSkills, validateControlLevel } from '../app/core/player-controls.mjs';
import { createStreamSafe } from '../app/web/stream-safe.mjs';
import { bindTaskViewPreferences } from '../app/web/task-view-preferences.mjs';
import { createQuestMap } from '../app/web/quest-map.mjs';
import { selectDuoTaskLists } from '../app/web/duo-task-lists.mjs';
import { createDuoBacklogView } from '../app/web/duo-backlog-view.mjs';
import { createMembersStart } from '../app/web/members-start.mjs';
import { createProfileView } from '../app/web/profile-view.mjs';
import { createBackupUpload, downloadFullBackup } from '../app/web/backup-transfer.mjs';
import { createFinishLineView } from '../app/web/finish-line-view.mjs';
import { createPartnerSupplyView } from '../app/web/partner-supply-view.mjs';
import { createXpChoices } from '../app/web/lamp-choices.mjs';
import { chunkColourLegend } from '../app/web/chunk-colour-picker.mjs';
import { createGroupGoals } from '../app/web/group-goals.mjs';
import { groupGoalCommandTypes } from '../app/core/group-goal-types.mjs';
import { createCalculationFeedback, calculationLabel } from '../app/web/calculation-feedback.mjs';
import { createMapActivityLayers } from '../app/web/map-activity-layers.mjs';
import { dialogUsageId, handleUsageControl } from '../app/web/usage-client.mjs';
import { usageSummary } from '../app/web/usage-model.mjs';
import { supportsDatasetFeature, applyDatasetFeatureControls, applyDatasetLaunchCopy } from '../app/web/dataset-features.mjs';
import { buildChunkPlanningIndex } from '../app/tasks/chunk-planning-index.mjs';
import { createLiveSwapCommandClient } from '../app/web/live-swap-client.mjs';

const entry = new URL('../app/web/main.mjs', import.meta.url);
const imports = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\r?\n/gm;
const isScreen = specifier => /(?:^|\/)(?:screen-[^/]+|pool-ranking)\.mjs$/.test(specifier);

// Follow the shipped screen graph, rather than maintaining a second list of
// feature modules. Existing browser collaborators remain explicit fixture mocks.
export async function readScreenGraph() {
  const modules = new Map();
  async function visit(url) {
    if (modules.has(url.href)) return;
    const source = await readFile(url, 'utf8');
    modules.set(url.href, source);
    for (const match of source.matchAll(imports)) if (isScreen(match[2])) await visit(new URL(match[2], url));
  }
  await visit(entry);
  return modules;
}

export function runScreenGraph(context, modules) {
  // Keep dataset selection explicit in this VM, like the other browser collaborators.
  context.selectedDataset ??= { capabilities: {}, gameDefaults: { members: [
    { id: 'actor1', name: 'Player', mapId: 'bbb' }, { id: 'reed', name: 'Reed', mapId: 'aaa' },
  ] } };
  context.supportsDatasetFeature ??= supportsDatasetFeature;
  context.mountOriginalSyncControl ??= () => {};
  context.applyDatasetFeatureControls ??= applyDatasetFeatureControls;
  context.applyDatasetLaunchCopy ??= applyDatasetLaunchCopy;
  for (const [name, value] of Object.entries({ ...customTasks, playerControlSkills, validateControlLevel })) if (!(name in context)) context[name] = value;
  context.createStreamSafe ??= createStreamSafe;
  context.bindTaskViewPreferences ??= get => bindTaskViewPreferences(get, () => context.localStorage);
  context.createQuestMap ??= createQuestMap;
  context.buildChunkPlanningIndex ??= buildChunkPlanningIndex;
  context.selectDuoTaskLists ??= selectDuoTaskLists;
  context.createDuoBacklogView ??= createDuoBacklogView;
  context.createMembersStart ??= createMembersStart;
  context.createProfileView ??= createProfileView;
  context.createBackupUpload ??= createBackupUpload;
  context.downloadFullBackup ??= downloadFullBackup;
  context.createFinishLineView ??= createFinishLineView;
  context.createPartnerSupplyView ??= createPartnerSupplyView;
  context.createXpChoices ??= createXpChoices;
  context.chunkColourLegend ??= chunkColourLegend;
  context.createScreenChunkColours ??= c => { c.chunkColours = { summary: () => c.el('div'), action: () => null }; };
  context.createGroupGoals ??= createGroupGoals;
  context.groupGoalCommandTypes ??= groupGoalCommandTypes;
  context.createCalculationFeedback ??= options => createCalculationFeedback({ ...options, setTimer: context.setTimeout, clearTimer: context.clearTimeout });
  context.calculationLabel ??= calculationLabel;
  context.createMapActivityLayers ??= createMapActivityLayers;
  const commandStorage = new Map();
  context.createLiveSwapCommandClient ??= options => createLiveSwapCommandClient({ ...options,
    acquireSession: () => () => {},
    storage: { getItem: key => commandStorage.get(key) ?? null, setItem: (key, value) => commandStorage.set(key, value), removeItem: key => commandStorage.delete(key) },
    fetch: async (path, options) => {
      // Session registration is transport plumbing; these screen fixtures inspect
      // their command/state traffic. Protocol persistence has its own tests.
      if (path === '/api/action-session') return { ok: true, status: 200, json: async () => ({ slot: 0, generation: 1, sequence: 0, acknowledged: 0 }) };
      const response = await context.fetch(path, options);
      if (!path.startsWith('/api/command')) return response;
      if (!response.ok) return { ...response, status: response.status ?? 500 };
      return { ...response, ok: response.ok, status: response.status ?? 200, headers: response.headers, json: async () => {
        const value = await response.json();
        return { ...value, receipt: { requestId: JSON.parse(options.body).requestId, revision: value.state?.revision,
          outcome: { type: JSON.parse(options.body).command.type, revision: value.state?.revision } } };
      } };
    },
  });
  context.dialogUsageId ??= dialogUsageId;
  context.handleUsageControl ??= handleUsageControl;
  context.usageSummary ??= usageSummary;
  // Networking/timers are exercised by usage-client tests; screen fixtures stay isolated.
  context.createUsageCounter ??= () => ({ enabled: true, count() {}, flush: async () => {}, start() {}, stop() {}, setEnabled() {}, refreshPreference() {} });
  // Area check is covered by its own DOM/controller fixture. Other screen
  // fixtures keep this toolbar collaborator explicit, like their existing mocks.
  context.createScreenAreaCheck ??= () => {};
  // The live legend/toolbar DOM is covered by map-control-discovery.test.mjs.
  context.createMapControlDiscovery ??= () => ({ mount() {}, close() {}, isOpen: () => false });
  context.mountMembersStartEntry ??= () => ({ refresh() {} });
  const loaded = new Map();
  function load(url) {
    if (loaded.has(url.href)) return loaded.get(url.href);
    let source = modules.get(url.href);
    const dependencies = [];
    source = source.replace(imports, (_, bindings, specifier) => {
      // Resolve collaborators through the fixture globals at call time, so tests
      // can replace a mock after screen construction (startup and memo counters).
      if (!isScreen(specifier)) return '';
      const dependency = load(new URL(specifier, url));
      const index = dependencies.push(dependency) - 1;
      if (!/^\{[\s\S]*\}$/.test(bindings.trim())) throw new Error(`Unsupported browser harness import: ${bindings}`);
      return bindings.trim().slice(1, -1).split(',').filter(value => value.trim()).map(value => {
        const [imported, local = imported] = value.trim().split(/\s+as\s+/);
        return `const ${local} = __dependencies[${index}][${JSON.stringify(imported)}];`;
      }).join('\n') + '\n';
    });
    const names = [];
    source = source.replace(/^export\s+(?=(?:async\s+)?function\s+|(?:const|let|class)\s+)/gm, '');
    for (const match of modules.get(url.href).matchAll(/^export\s+(?:(?:async\s+)?function|const|let|class)\s+(\w+)/gm)) names.push(match[1]);
    // Suppress only the entrypoint's automatic lifecycle; factory bodies run as shipped.
    if (url.href === entry.href) source = source.replace(/^(?:screen\.)?start\(\)\.catch\(.*$/m, '');
    const factory = runInContext(`(__dependencies) => {\n${source}\nreturn { ${names.join(', ')}${url.href === entry.href ? `${names.length ? ', ' : ''}__screen: screen` : ''} };\n}`, context, { filename: url.pathname });
    const exports = factory(dependencies);
    loaded.set(url.href, exports);
    return exports;
  }
  const screen = load(entry).__screen;
  for (const key of Object.keys(screen)) Object.defineProperty(context, key, { configurable: true, get: () => screen[key], set: value => { screen[key] = value; } });
  return screen;
}

// Focused fixtures still run their actual function ranges with tiny collaborators.
// Joining the graph lets those fixtures follow a function when its owning module moves.
export function screenFunctionSources(modules) {
  return [...modules.values()].join('\n').replace(/\bc\./g, '');
}

export function screenFunctionSource(modules, name) {
  for (const original of modules.values()) {
    const source = original.replace(/\bc\./g, '');
    const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\(`).exec(source);
    if (!match) continue;
    // Let JavaScript's parser identify the closing brace, including templates,
    // comments and regular expressions, without executing any candidate body.
    for (let end = source.indexOf('}', match.index); end >= 0; end = source.indexOf('}', end + 1)) {
      const candidate = source.slice(match.index, end + 1);
      try { new Script(`(${candidate})`); return candidate; } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
  }
  throw new Error(`Missing shipped screen function: ${name}`);
}
