// Independently authored invented game, 2026-10-13. No imported geography,
// catalogue, task wording, artwork or account data. These logical catalogue
// names are compatibility interfaces for shared algorithms, not source paths.
export const starterContract = Object.freeze({ datasetId: 'open-starter', datasetContractVersion: 1,
  identityNamespace: 'rs3:open-starter', coordinateSystem: 'open-starter-grid-v1', corePackApi: 1 });
export const starterGrid = Object.freeze({ columns: 6, rows: 5, stride: 16, startId: 100 });
export const starterCapabilities = Object.freeze({ independent: true, legacyHistory: false,
  cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  mapCorrections: false, divinationTraining: false, retainedTaskCorrections: false,
  retainedUnsupportedCorrections: false, metadataCorrections: false, equipmentCorrections: false,
  features: Object.freeze(Object.fromEntries(['originalSync', 'runeMetrics', 'training', 'equipment',
    'skillGuides', 'collections', 'mapMetadata', 'archaeology', 'quests', 'bis', 'rsCatalogues', 'externalNames', 'gallery', 'projectUpdates'].map(key => [key, false]))) });

const idAt = (x, y) => String(starterGrid.startId + x * starterGrid.stride - y);
const chunks = {}, sections = {};
for (let x = 0; x < starterGrid.columns; x++) for (let y = 0; y < starterGrid.rows; y++) {
  const id = idAt(x, y);
  chunks[id] = { Nickname: `Cell ${x + 1},${y + 1}` };
  sections[id] = { '0': [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .filter(([a, b]) => a >= 0 && b >= 0 && a < starterGrid.columns && b < starterGrid.rows).map(([a, b]) => idAt(a, b)) };
}
chunks['100'].Nickname = 'Starting clearing';
chunks['100'].Object = { 'Practice post': true };
chunks['116'].Nickname = 'Paper grove';
chunks['116'].Spawn = { 'Paper token': 1 };
chunks['99'].Nickname = 'Quiet pond';
chunks['99'].Object = { 'Reflection stone': true };
chunks['132'].Nickname = 'Lookout';
chunks['132'].Object = { 'Signal board': true };
chunks['115'].Nickname = 'Workshop';
chunks['115'].Object = { 'Fold table': true };

const task = (slug, Chunks, Description, extra = {}) => ({ PickerId: `rs3:task:open-starter:${slug}`, Chunks, Description, ...extra });
export const starterDefinitions = {
  chunks, sections, walkableChunks: Object.keys(chunks), walkableChunksF2P: Object.keys(chunks),
  challenges: { Extra: {
    'Try the practice post': task('practice', ['100'], 'Mark this goal when you have tried the clearing activity.', { Objects: ['Practice post'] }),
    'Collect a paper token': task('token', ['116'], 'Visit the paper grove and collect its invented token.', { Items: ['Paper token'] }),
    'Pause by the reflection stone': task('reflection', ['99'], 'Take a quiet moment beside the pond.', { Objects: ['Reflection stone'] }),
    'Leave a signal at the lookout': task('signal', ['132'], 'Reach the lookout and leave a signal.', { Objects: ['Signal board'] }),
    'Fold a paper keepsake': task('keepsake', ['115'], 'Bring a paper token to the workshop.', { Objects: ['Fold table'], Items: ['Paper token'] }),
  } },
  codeItems: {}, equipment: {}, monsters: {}, shopItems: {}, objectItems: {}, npcItems: {},
};
export const starterTaskMap = Object.fromEntries(Object.entries(starterDefinitions.challenges.Extra)
  .map(([label, row]) => [label, row.PickerId]));
const manualGoals = [
  ['rs3:task:custom:open-starter:journal', 'manual', 'Write one sentence about this journey', ['Keep a journey note'], 'Extra'],
  ['rs3:task:custom:open-starter:partner', 'manual', 'Choose a goal together', ['Agree on a shared goal'], 'Extra'],
];
export const starterManualGoals = manualGoals.map(([id, , label]) => ({ id, label,
  description: 'An optional manually checked goal. It has no automatic activity requirements.' }));
export const starterGameDefaults = Object.freeze({ title: 'Grid challenge', masterLabel: 'Administrator',
  members: Object.freeze([{ id: 'explorer-1', name: 'Explorer 1' }, { id: 'explorer-2', name: 'Explorer 2' }]),
  tasks: Object.freeze(manualGoals.map(([id, , label]) => Object.freeze({ id, label, category: 'Extra' }))) });

const sharedRules = [
  { id: 'access.shared', type: 'boolean', default: true, label: 'Share access', description: 'Both explorers may use owned cells.' },
  { id: 'roll.selected', type: 'boolean', default: true, label: 'Include chosen cells', description: 'Include cells explicitly selected for the next draw.' },
  { id: 'roll.adjacent', type: 'boolean', default: true, label: 'Include neighbouring cells', description: 'Draw from cells connected to owned cells.' },
  { id: 'roll.neighborMode', type: 'enum', default: 'accessible', options: ['accessible', 'geometric', 'manual'], label: 'Neighbour policy', description: 'Use connected neighbours, all grid neighbours, or your own selection.' },
  { id: 'roll.clearSelected', type: 'boolean', default: true, label: 'Clear selections after a draw', description: 'Start the following selection with an empty list.' },
  { id: 'roll.walkable', type: 'boolean', default: true, label: 'Use declared cells', description: 'Limit automatic draws to declared cells.' },
  { id: 'tasks.completion', type: 'enum', default: 'any', options: ['any', 'all', 'personal'], label: 'Goal completion', description: 'Choose whether one explorer, every explorer, or each explorer separately must check a goal.' },
];
const personalRules = [{ id: 'Extra', type: 'boolean', default: true, label: 'Show starter goals', description: 'Show the activities written for this grid.' }];
const contractRows = rows => rows.map(({ label, description, ...row }) => row);
const presentationRows = rows => rows.map(({ id, label, description }) => ({ id, label, description }));
const displaySettings = [
  ...[['chunkTasks', 'Show goals'], ['taskSidebar', 'Wide goal list'], ['taskSearchbar', 'Goal filter'],
    ['recent', 'History controls'], ['info', 'Cell details'], ['topButtons', 'Tool controls'], ['roll2', 'Draw two choices'],
    ['unpick', 'Clear choices'], ['ids', 'Cell numbers'], ['hideChecked', 'Hide completed goals'],
    ['completedTaskStrikethrough', 'Cross out completed goals']].map(([id, label]) => ({ id, type: 'boolean', default: true,
      label, description: `Show ${label.toLowerCase()} in this grid game.`, section: 'Display' })),
  { id: 'theme', type: 'enum', options: ['dark', 'gray', 'light'], default: 'dark', label: 'Appearance', description: 'Choose the page colours.', section: 'Display' },
  { id: 'completedTaskColor', type: 'color', default: '#81c784', label: 'Completed goal colour', description: 'Choose a colour for checked goals.', section: 'Display' },
  { id: 'advanced', type: 'boolean', default: false, label: 'Advanced details', description: 'Show data and technical details.', section: 'Display' },
  { id: 'startingChunk', type: 'string', default: '', label: 'Starting cell', description: 'Choose a cell to mark as the start.', section: 'Display' },
];
export const starterRulesCatalogue = { schemaVersion: 1, sections: [{ id: 'starter', name: 'Starter goals', rows: [{ key: 'Extra', label: 'Show starter goals', descriptionText: personalRules[0].description, parentKey: null, depth: 0, control: 'checkbox' }] }],
  rules: [{ key: 'Extra', default: true, hasDeclaredDefault: true, control: 'checkbox', parentKey: null, depth: 0 }],
  presets: [{ name: 'Starter defaults', values: { Extra: true }, effectiveValues: { Extra: true } }],
  inputs: { numeric: [] }, cascade: { enableAllChildrenParents: [], enableDefaults: {} }, selectAll: [] };

export const starterValues = {};
const put = (module, names, value) => { for (const name of names.split(' ')) starterValues[`app/${module}.mjs#${name}`] = structuredClone(value); };
put('data/settings', 'originalSettings originalSettingDescriptions originalSettingStructure originalRuleDefaults originalRuleDescriptions originalRuleStructure originalRulePresets originalRuleSubDefaults originalSettingConflicts settingLabels taskRuleCutoffDefaults originalRuleReferences taskRuleCategoryCounts explicitRuleBehavior partialRuleBehavior missingGeneratedBehavior retainedRuleBehavior', {});
put('data/settings', 'originalTaskGeneratingRules originalWorkerInputNames', []);
for (const name of ['settingDefinitions', 'authoredSettingDefinitions', 'neighborSettingDefinitions']) {
  put('data/settings', `${name}:contract ${name}:presentation`, []);
}
put('data/settings', 'settingDefinitions:contract', contractRows(displaySettings));
put('data/settings', 'settingDefinitions:presentation', presentationRows(displaySettings));
put('data/settings', 'originalSettings', Object.fromEntries(displaySettings.map(row => [row.id, row.default])));
put('data/settings', 'taskRuleDefinitions:contract', contractRows(personalRules));
put('data/settings', 'taskRuleDefinitions:presentation', presentationRows(personalRules));
put('data/settings', 'authoredTaskRules:contract authoredTaskRules:presentation', {});
put('data/settings', 'originalRuleDefaults', { Extra: true });
put('data/settings', 'originalRulePresets', { 'Starter defaults': { Extra: true } });
put('data/settings', 'originalRuleStructure', { Starter: { Extra: [] } });
put('core/rules', 'ruleContract', contractRows(sharedRules));
put('core/rules', 'rulePresentation', presentationRows(sharedRules));
put('web/rules-model', 'actualDefaults', { Extra: true });
put('data/identity-registry', 'identityRegistryVersion', 1);
put('data/identity-registry', 'authoredTasks', Object.entries(starterDefinitions.challenges.Extra).map(([label, row]) => [row.PickerId, 'Extra', label]));
put('data/identity-registry', 'authoredGoals', manualGoals);
put('data/identity-registry', 'authoredEntities authoredSources', []);
put('tasks/identity', 'verifiedProgressAliases', []);
put('data/access-policy', 'membershipSourcePolicies', []);
put('data/cache-entry-policy', 'cacheEntryPolicies cacheNonEntryPolicies', []);
put('data/cache-entry-policy', 'cacheEntryKinds', new Set());
put('data/cache-entry-policy', 'TRANSPORT_ACCESS_RULE', 'access.transport');
put('data/cache-entry-policy', 'TRANSPORT_MASK_SHA256 TRANSPORT_RUNTIME_SHA256', null);
put('data/lodestones', 'surfaceLodestones preCorrectionSurfaceLodestones', []);
put('data/map-corrections', 'walkable mixed MAP_CORRECTIONS', []);
put('data/map-pin-categories', 'entries MAP_PIN_LEGEND_GROUPS', []);
put('data/map-pin-categories', 'CACHE_PIN_CATEGORY_IDS cacheSpriteCategories', {});
put('data/map-pin-categories', 'MAP_PIN_CATEGORIES', [{ id: 'other', name: 'Other', label: 'Other', spriteIds: [], defaultVisible: false }]);
put('data/map-pins', 'CACHE_PIN_BUNDLE', {});
put('data/map-pins', 'CACHE_PIN_PATH CACHE_PIN_MANIFEST_PATH CACHE_PIN_SPRITE_DIRECTORY PIN_COMMIT PIN_SNAPSHOT_DATE', '');
put('data/map-pins', 'SURFACE_CROP', { minX: 384, maxX: 768, minY: 0, maxY: 320 });
put('data/surface-grid', 'SURFACE_GRID', starterGrid);
put('data/surface-grid', 'CACHE_SECTION_OFFSET', 1000000);
put('data/icons', 'ICON_VERSION', 'open-starter-1');
put('data/icons', 'ICON_MANIFEST_PATH', '');
put('data/icons', 'ICON_BUNDLES', []);
put('data/terrain-assets', 'TERRAIN_MANIFEST_PATH', '');
put('data/terrain-assets', 'TERRAIN_BUNDLE', null);
put('data/skill-guide-rules', 'SKILL_GUIDE_TASKS_RULE', 'tasks.skillGuides');
put('data/skill-guide-rules', 'SKILL_GUIDE_MILESTONES_RULE', 'tasks.skillGuideMilestones');
put('data/skill-guide-rules', 'SKILL_GUIDE_CORRECTIONS_RULE', 'tasks.skillGuideCorrections');
put('data/training/banking-destinations', 'surfaceMembers surfaceFree', new Set());
put('data/training/banking-destinations', 'bankingServiceEvidence', {});
put('core/game-progress', 'defaultRuneScapeNames', {});
put('core/f2p-skill-caps', 'helperTrialCaps', {});
put('core/player-controls', 'playerControlSkills', []);
for (const module of ['death', 'banking', 'mining', 'woodcutting']) put(`core/${module}-settings`, `${module}SettingDefinitions:contract ${module}SettingDefinitions:presentation`, []);
put('training/mining-rules', 'MINING_PICKAXES MINING_ROCKS MINING_PROFILES MINING_STAMINA_MILESTONES MINING_CRITICAL_LEVELS MINING_SOURCES', []);
put('training/mining-rules', 'MINING_BOUNDS', {});
put('training/woodcutting-rules', 'WOODCUTTING_HATCHETS WOODCUTTING_TREES WOODCUTTING_UNMODELLED_TREES WOODCUTTING_SOURCES', []);
put('training/woodcutting-rules', 'WOODCUTTING_BOUNDS WOODCUTTING_FORMULA', {});
put('training/fishing-rules', 'FISHING_SPECIES FISHING_METHODS FISHING_UNMODELLED_METHODS FISHING_SOURCES', []);
put('training/fishing-rules', 'FISHING_BOUNDS FISHING_FORMULA', {});
put('web/finish-line-model', 'finishLineSkillTargets finishLineGearTargets notableAchievements', []);
put('web/finish-line-model', 'skillReasons', {});
put('tasks/engine', 'F2P TWENTY PROCESSING MONSTER_TRAINING MAYBE_PRIMARY PRESENTATION_RULES UNSUPPORTED_RULES', new Set());
put('tasks/engine', 'skillCaps', {});
put('tasks/processing', 'processingSkills', new Set());
put('tasks/achievements', 'nonAreaFamilies', new Set());

const empty = () => ({ schemaVersion: 1, version: 'open-starter-1', coverage: [], provenance: { authorship: 'Independently authored empty catalogue; feature unsupported.' } });
export const starterJSON = {};
const json = (name, fields) => { starterJSON[`app/data/${name}`] = { ...empty(), ...fields }; };
for (const filename of ['archaeology-task-corrections.2026-10-08.v1.json', 'metadata-corrections.2026-10-08.v1.json',
  'npc-metadata-corrections.2026-10-08.v1.json', 'retained-entry-corrections.2026-10-12.v2.json',
  'retained-task-corrections.2026-10-09.v1.json', 'retained-unsupported-corrections.2026-10-13.v1.json',
  'retained-wording-corrections.2026-10-12.v1.json', 'skillguide-combat-corrections.2026-10-08.v1.json']) json(filename, { corrections: [] });
json('equipment-corrections.2026-10-08.v1.json', { corrections: [], identities: [] });
json('equipment-weights.2026-10-08.v1.json', { records: {} });
json('equipment-permanence.2026-10-08.v1.json', { records: {} });
json('cache-walkability.2026-10-07.v1.json', { regions: [], edges: [] });
json('cache-component-policy.2026-10-07.v1.json', { membership: [], mapping: [] });
json('cache-surface-corrections.2026-10-08.v1.json', { regionLabels: [], displayOnlyRegions: [], invalidRegionIds: [], nonWalkingComponentIds: [] });
for (const name of ['cache-resources.2026-10-08.v1.json', 'cache-divination.2026-10-13.v1.json', 'cache-archaeology.2026-10-08.v1.json']) json(name, { classes: [], placements: [], mappings: [] });
json('cache-resource-selectors.2026-10-08.v1.json', { mappings: [], unmatched: [] });
json('cache-shops.2026-10-08.v1.json', { shops: [], records: [] });
json('cache-npcs.2026-10-08.v1.json', { records: {} });
json('cache-interiors.2026-10-08.v2.json', { groups: [], interiors: [], connections: [] });
json('divination.2026-10-13.v1.json', { tiers: [], sources: [], colossi: {} });
for (const name of ['source-membership.2026-10-08.v1.json', 'source-row-membership.2026-10-08.v1.json',
  'source-method-requirements.2026-10-08.v1.json', 'source-incidental-outputs.2026-10-08.v1.json', 'monster-membership-review.2026-10-12.v1.json']) json(name, { records: [] });
for (const name of ['item-membership.2026-10-08.v1.json', 'item-membership-aliases.2026-10-08.v1.json', 'item-membership-review.2026-10-12.v1.json']) json(name, { entries: [], sourceRows: [] });
json('item-membership-flags.2026-10-08.v1.json', { rows: [] });
json('picker-entities.2026-10-08.v1.json', { records: [], entities: [], entries: [] });
json('map-connections.2026-10-09.v1.json', { connections: [], destinations: [] });
json('map-pin-details.2026-10-08.v2.json', { records: {}, details: [], pins: [] });
json('place-labels.2026-10-13.v1.json', { labels: [] });
json('transport-routes.2026-10-09.v2.json', { stations: [], routes: [], sources: [] });
json('members-start-banks.2026-10-12.v1.json', { optionA: [], optionAF2PExtension: [] });
json('poh-storage.2026-10-08.v1.json', { furniture: [], families: [], slots: [], tasks: [], records: [], housing: {} });
json('skill-guides.2026-10-08.v1.json', { entries: [], generatedTasks: [] });
json('skill-icons.2026-10-08.v1.json', { skills: {}, icons: [] });
for (const date of ['2026-10-08', '2026-10-09', '2026-10-12']) json(`item-icons.${date}.v1.json`, { items: {}, icons: [] });
json('training/methods.f2p.json', { scope: 'Training calculations are unavailable for this invented grid.', methods: [], sources: [], skills: [] });
json('training/banking-masks.v1.json', { regions: [], masks: [], limits: ['No bank-route coverage.'] });
json('training/banking-fishing-spots.v1.json', { spots: [], records: [], placements: [] });
for (const name of ['mining-rates', 'woodcutting-rates', 'fishing-rates', 'death-woodcutting-guide']) json(`training/${name}.v1.json`, { records: [], methods: [], sources: [], skills: [] });
starterJSON['app/data/original-rules-ui.2026-10-08.v1.json'] = starterRulesCatalogue;
starterJSON['app/open-starter-definitions.json'] = starterDefinitions;
starterJSON['app/open-starter-task-map.json'] = starterTaskMap;
starterJSON['app/open-starter-manual-goals.json'] = starterManualGoals;
starterJSON['app/open-starter-provenance.json'] = {
  schemaVersion: 1, authored: '2026-10-13', authorship: 'Authored fresh for this project', inputs: [],
  scope: 'Every cell, section, connection, task, manual goal, identity, alias, rule, default, preset, explanation and empty compatibility catalogue is authored for this starter game. No external or legacy input was used.',
  rows: [
    ...Object.keys(chunks).map(id => ({ kind: 'cell', id, origin: 'project-authored' })),
    ...Object.keys(sections).map(id => ({ kind: 'section', id: `${id}-0`, origin: 'project-authored' })),
    ...Object.values(starterDefinitions.challenges.Extra).map(row => ({ kind: 'task', id: row.PickerId, origin: 'project-authored' })),
    ...starterManualGoals.map(row => ({ kind: 'manual-goal', id: row.id, origin: 'project-authored' })),
    ...[...sharedRules, ...personalRules].map(row => ({ kind: 'rule', id: row.id, origin: 'project-authored' })),
    ...displaySettings.map(row => ({ kind: 'setting', id: row.id, origin: 'project-authored' })),
    { kind: 'preset', id: 'Starter defaults', origin: 'project-authored' },
  ],
};
starterJSON['app/web/gallery-fixture-data.json'] = { schemaVersion: 1, sections: [], scenarios: [], fixtures: [] };
