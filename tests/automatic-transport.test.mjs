import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { evaluateRollPool, createRuleRegistry, builtInRules } from '../app/core/rules.mjs';
import { evaluatePartnerConnections } from '../app/core/territory.mjs';
import { evaluateTransportRoutes as evaluateRoutes, transportBudget, expandTransportReachability, affordableTransportPaths, physicalTransportRoutes } from '../app/core/transport-access.mjs';
import { configureAutomaticTransport, deriveAutomaticTransport, releaseAutomaticTransportCaches } from '../app/core/automatic-transport.mjs';
import { automaticTravelInputKey } from '../app/core/travel-inputs.mjs';

const requirements = extra => ({ levels: {}, quests: [], items: [], fare: null, conditions: [], confirmations: [], ...extra });
const station = (id, chunkId, section = '0') => ({ id, name: id, chunkId, locationId: `${chunkId}-${section}`,
  x: (Number(chunkId) >> 8) * 64 + 1, y: (Number(chunkId) & 255) * 64 + 1, mapId: 28, plane: 0, coordinateEvidence: 'synthetic coordinate' });
const evaluateTransportRoutes = (world, state, memberId) => evaluateRoutes(world, state, memberId, { transportRoutes: world.transportRoutes });
const route = (id, extra = {}) => ({ id, name: id, from: 'home', to: 'away', kind: 'teleport', members: false, f2p: true,
  requirements: requirements(), ...extra });
const observation = (level, runescapeName = 'DemoExplorer') => ({ level, xp: 1, source: 'runemetrics', runescapeName });
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, metadataCorrections: false, equipmentCorrections: false,
  retainedTaskCorrections: false, cacheShops: false, lodestones: [] };
function fixture({ items = [], training = { Magic: { level: 99 }, Woodcutting: { level: 57 } } } = {}) {
  const definitions = { chunks: { '12853': { Spawn: { 'Air rune': 1, 'Fire rune': 1 } }, '13108': { Spawn: { 'Law rune': 1 } }, '11569': { Object: { Anvil: true } } },
    sections: { '12853': { '0': [] }, '13108': { '0': [] }, '11569': { '0': [] } },
    walkableChunks: ['12853', '13108', '11569'], walkableChunksF2P: ['12853', '13108', '11569'],
    challenges: { Extra: { Anvil: { Objects: ['Anvil'] } } }, codeItems: {} };
  const world = buildWorld(definitions, options);
  const state = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['12853'] }, { id: 'reed', name: 'Reed', unlocked: ['11569'] }]);
  state.rules['travel.automatic'] = true; state.rules['access.transport'] = true;
  const catalogue = { stations: [station('home', '12853'), station('away', '13108'), station('partner', '11569')], routes: [] };
  world.transportRoutes = catalogue;
  let calls = 0;
  const baseline = { training, access: { bases: ['12853'], sections: [] }, items };
  configureAutomaticTransport(world, { definitions, engine: { evaluate(input, memberId, options) {
    calls++; assert.equal(input.rules['travel.automatic'], false); assert.equal(input.rules['access.transport'], false);
    assert.deepEqual(options, { reuseEligibility: false }, 'Transport owns the baseline cache');
    assert.equal(memberId, 'actor1'); return baseline;
  } } });
  return { definitions, world, state, catalogue, baseline, calls: () => calls };
}
const supply = (name, kind = 'drop', extra = {}) => ({ name, sources: [{ kind, location: '12853', ...extra }] });

test('idle release rebuilds the same transport facts with the configured evaluator', () => {
  const f = fixture({ items: [supply('Air rune')] });
  const before = deriveAutomaticTransport(f.world, f.state, 'actor1');
  assert.equal(deriveAutomaticTransport(f.world, f.state, 'actor1'), before);
  assert.equal(f.calls(), 1);
  releaseAutomaticTransportCaches(f.world);
  const after = deriveAutomaticTransport(f.world, f.state, 'actor1');
  assert.notEqual(after, before); assert.deepEqual(after, before);
  assert.equal(f.calls(), 2);
  releaseAutomaticTransportCaches(f.world); releaseAutomaticTransportCaches(f.world);
  assert.deepEqual(deriveAutomaticTransport(f.world, f.state, 'actor1'), before);
  assert.equal(f.calls(), 3);
});
const spell = () => route('spell--varrock', { from: null, consumable: true, automatic: { type: 'standard-spell' }, requirements: requirements({
  levels: { Magic: 25 }, items: [{ name: 'Air rune', quantity: 3 }, { name: 'Fire rune', quantity: 1 }, { name: 'Law rune', quantity: 1 }],
  conditions: ['standard-spellbook-active', 'teleport-origin-permitted'], confirmations: ['teleport-runes-or-valid-substitution-available'] }) });

test('automatic OFF preserves declared-fact route behavior and never evaluates capabilities', () => {
  const f = fixture(); f.catalogue.routes = [spell()]; f.state.rules['travel.automatic'] = false;
  const before = evaluateTransportRoutes(f.world, f.state, 'actor1');
  assert.equal(before[0].available, false); assert.equal(before[0].estimated, false); assert.equal(f.calls(), 0);
  f.state.members[0].teleportOverrides = { 'spell--varrock': true };
  assert.deepEqual(evaluateTransportRoutes(f.world, f.state, 'actor1'), before);
  assert.equal(f.calls(), 0);
});




test('standard spellbook aliases and selecting a free world use explicit F2P planning evidence', () => {
  const f = fixture({ items: [supply('Air rune'), supply('Fire rune'), supply('Law rune')] });
  f.state.rules['roll.consumableTeleports'] = true;
  const teleport = spell(); teleport.requirements.conditions = ['standard-spellbook', 'free-to-play-world', 'teleport-origin-permitted'];
  f.catalogue.routes = [teleport];
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, true);
  f.state.members[0].transportFacts = { conditions: { 'standard-spellbook-active': false } };
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false);
  f.state.members[0].transportFacts = { conditions: { 'standard-spellbook-active': true } };
  f.state.rules['content.f2p'] = false;
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false, 'Members planning mode does not establish a free world');
  f.state.members[0].transportFacts.conditions['free-to-play-world'] = true;
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, true);
});

test('automatic canoe availability declares familiar dismissal as preparation, never an observed familiar state', () => {
  const f = fixture(); f.catalogue.routes = [route('canoe', { kind: 'canoe', requirements: requirements({
    levels: { Woodcutting: 12 }, confirmations: ['canoe-familiar-state-supported'] }) })];
  let row = evaluateTransportRoutes(f.world, f.state, 'actor1')[0];
  assert.equal(row.available, true); assert.match(row.reason, /dismissing a familiar if present/); assert.equal(row.preparations.length, 1);
  assert.equal(deriveAutomaticTransport(f.world, f.state, 'actor1').facts.confirmations['canoe-familiar-state-supported'], undefined);
  f.state.members[0].transportFacts = { confirmations: { 'canoe-familiar-state-supported': false } };
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false);
  delete f.state.members[0].transportFacts; f.state.rules['travel.automatic'] = false;
  row = evaluateTransportRoutes(f.world, f.state, 'actor1')[0]; assert.equal(row.available, false); assert.equal(row.preparations.length, 0);
});

test('reachable activation proves ordinary lodestones; special builds and unreachable stones remain unconfirmed', () => {
  const f = fixture(); f.catalogue.routes = [route('home-stone', { kind: 'lodestone', to: 'home', automatic: { activation: 'touch' },
    requirements: requirements({ conditions: ['teleport-origin-permitted'], confirmations: ['lodestone-home-activated'] }) }),
  route('away-stone', { kind: 'lodestone', requirements: requirements({ confirmations: ['lodestone-away-activated'] }) }),
  route('build-stone', { kind: 'lodestone', to: 'home', automatic: { activation: 'build' }, requirements: requirements({ confirmations: ['lodestone-build-activated'] }) })];
  const rows = evaluateTransportRoutes(f.world, f.state, 'actor1');
  assert.equal(rows[0].available, true); assert.equal(rows[1].available, false); assert.equal(rows[2].available, false);
});

test('unknown currencies, conditions and confirmations fail closed without blind auto declarations', () => {
  const f = fixture({ items: [supply('Coins', 'shop'), supply('Token', 'reward')] });
  f.catalogue.routes = [route('fare', { from: 'home', kind: 'ferry', requirements: requirements({ fare: { currency: 'tokens', amount: 1 } }) }),
    route('hard', { requirements: requirements({ conditions: ['door-open'], confirmations: ['bosses-killed'] }) })];
  const rows = evaluateTransportRoutes(f.world, f.state, 'actor1'); assert.equal(rows[0].available, false); assert.equal(rows[1].available, false);
  assert.equal(deriveAutomaticTransport(f.world, f.state, 'actor1').facts.currencies.coins, undefined);
});

test('a task consuming a finite quest reward cannot manufacture a renewable fare budget', () => {
  const f = fixture({ items: [supply('Coins', 'task', { taskId: 'sell-reward' })] });
  f.state.members[0].completedTasks = ['quest'];
  f.baseline.tasks = [{ id: 'sell-reward', category: 'Magic', record: { Items: ['Quest reward'] },
    sources: [{ item: 'Quest reward', kind: 'reward', taskId: 'quest' }] }];
  assert.equal(deriveAutomaticTransport(f.world, f.state, 'actor1').renewableBudget['currencies:coins'], undefined);
  f.baseline.tasks[0].sources = [{ item: 'Quest reward', kind: 'drop', location: '12853' }];
  configureAutomaticTransport(f.world, { definitions: f.definitions, engine: { evaluate: () => f.baseline } });
  assert.ok(deriveAutomaticTransport(f.world, f.state, 'actor1').renewableBudget['currencies:coins'] >= 60);
});

test('reviewed global item teleports use obtainable items while arbitrary global routes still need a confirmation', () => {
  const f = fixture({ items: [supply('Earth altar teleport', 'shop')] });
  f.state.rules['roll.consumableTeleports'] = true;
  const req = requirements({ items: [{ name: 'Earth altar teleport', quantity: 1, consumed: true }], conditions: ['teleport-origin-permitted'] });
  f.catalogue.routes = [route('reviewed-item', { from: null, consumable: true, automatic: { type: 'item-teleport' }, requirements: req }),
    route('arbitrary-global', { from: null, consumable: true, requirements: req })];
  const rows = evaluateTransportRoutes(f.world, f.state, 'actor1'); assert.equal(rows[0].available, true); assert.equal(rows[1].available, false);
  assert.equal(rows[0].group, 'items');
});

test('Explorer ring automatic itemAlternatives accepts either obtainable upgrade without blind confirmation', () => {
  for (const name of ["Explorer's ring 3", "Explorer's ring 4"]) {
    const f = fixture({ items: [supply(name)] });
    f.catalogue.routes = [route('explorer-ring--cabbage-port', { from: null, automatic: { type: 'item-teleport',
      itemAlternatives: ["Explorer's ring 3", "Explorer's ring 4"] }, requirements: requirements({ confirmations: ['explorer-ring-3-or-4-available'] }) })];
    assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, true);
    f.state.members[0].transportFacts = { confirmations: { 'explorer-ring-3-or-4-available': false } };
    assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false);
  }
  const absent = fixture(); absent.catalogue.routes = [route('explorer-ring--cabbage-port', { from: null,
    automatic: { itemAlternatives: ["Explorer's ring 3", "Explorer's ring 4"] },
    requirements: requirements({ confirmations: ['explorer-ring-3-or-4-available'] }) })];
  assert.equal(evaluateTransportRoutes(absent.world, absent.state, 'actor1')[0].available, false);
});

test('overrides remain personal and cannot bypass membership, consumables or endpoint section safety', () => {
  const f = fixture(); f.catalogue.routes = [route('unknown', { requirements: requirements({ quests: ['Unobserved'] }) }),
    route('member', { members: true, f2p: false }), route('consumed', { consumable: true }), route('bad-endpoint', { to: 'missing' })];
  f.state.members[0].teleportOverrides = Object.fromEntries(f.catalogue.routes.map(r => [r.id, true]));
  let rows = evaluateTransportRoutes(f.world, f.state, 'actor1'); assert.equal(rows[0].available, true); assert.ok(rows.slice(1).every(row => !row.available));
  f.state.members[0].sectionOverrides = { '13108-0': false }; assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false);
  delete f.state.members[0].sectionOverrides; f.state.members[0].teleportOverrides.unknown = false;
  rows = evaluateTransportRoutes(f.world, f.state, 'actor1'); assert.equal(rows[0].available, false); assert.equal(rows[0].override, false);
});

test('renewable fares support real round trips, finite balances and one-way routes keep their limits', () => {
  const f = fixture({ items: [supply('Coins')] });
  f.catalogue.routes = [route('ferry', { from: 'home', to: 'partner', kind: 'ferry', bidirectional: true, requirements: requirements({ fare: { currency: 'coins', amount: 30 } }) })];
  f.state.members[0].transportFacts = { currencies: { coins: 30 } };
  let connections = evaluatePartnerConnections(f.world, f.state, 'actor1', { lodestones: [], sectionsByMember: { actor1: [], reed: [] } });
  assert.equal(connections.byChunk['11569'].connected, true);
  f.catalogue.routes[0].bidirectional = false;
  connections = evaluatePartnerConnections(f.world, f.state, 'actor1', { lodestones: [], sectionsByMember: { actor1: [], reed: [] } });
  assert.equal(connections.byChunk['11569'].connected, false);
  const finite = fixture(); finite.catalogue.routes = [route('ferry', { from: 'home', to: 'partner', kind: 'ferry', bidirectional: true, requirements: requirements({ fare: { currency: 'coins', amount: 30 } }) })];
  finite.state.members[0].transportFacts = { currencies: { coins: 30 } };
  connections = evaluatePartnerConnections(finite.world, finite.state, 'actor1', { lodestones: [], sectionsByMember: { actor1: [], reed: [] } });
  assert.equal(connections.byChunk['11569'].connected, false);
});

test('baseline capability work is cached and invalidated by personal progress changes', () => {
  const f = fixture(); f.catalogue.routes = [route('plain')];
  evaluateTransportRoutes(f.world, f.state, 'actor1'); evaluateTransportRoutes(f.world, f.state, 'actor1'); transportBudget(f.state, 'actor1', undefined, f.world);
  assert.equal(f.calls(), 1);
  f.state.members[0].skillProgress = { Magic: observation(1) }; evaluateTransportRoutes(f.world, f.state, 'actor1'); assert.equal(f.calls(), 2);
});

test('travel input identity ignores bookkeeping, ticks and notes, including replaced task catalogues', () => {
  const f = fixture(); f.catalogue.routes = [spell()];
  const key = automaticTravelInputKey(f.state);
  deriveAutomaticTransport(f.world, f.state, 'actor1');
  for (const change of [
    state => { state.revision++; state.history.push({ type: 'roll' }); },
    state => { state.members[0].taskStatus = { task: { challengeCompleted: true, favorite: true, note: 'Plan' } }; },
    state => { state.members[0].taskStatus.task.challengeCompleted = false; },
    state => { state.members[0].selected = ['13108']; state.members[0].pendingRoll = ['11569']; state.members[0].blacklisted = ['13108']; },
    state => { state.members[0].notes = { '12853': 'Plan' }; state.members[0].journal = 'Plan'; },
    state => { state.members[0].taskAlternatives = { Extra: { group: 'task' } }; },
    state => { state.rules['roll.adjacent'] = false; state.rules['tasks.completion'] = 'personal'; },
    state => { state.tasks = structuredClone(state.tasks); },
  ]) {
    change(f.state);
    assert.equal(automaticTravelInputKey(f.state), key);
    deriveAutomaticTransport(f.world, f.state, 'actor1');
    assert.equal(f.calls(), 1, change.toString());
  }
  const reversed = structuredClone(f.state);
  reversed.rules = Object.fromEntries(Object.entries(reversed.rules).reverse());
  assert.equal(automaticTravelInputKey(reversed), key, 'Object insertion order is irrelevant');
});

test('travel invalidation covers both members, aliases, legacy controls and every capability input', () => {
  const original = fixture().state, key = automaticTravelInputKey(original);
  const changes = [
    state => { state.rules['content.f2p'] = false; },
    state => { state.rules['access.shared'] = false; },
    state => { state.rules['roll.consumableTeleports'] = true; },
    state => { state.rules['future-rule'] = true; },
    state => { state.taskRules = { Boosting: false }; },
    state => { state.legacy = { maps: { demo: { chunkinfo: { passiveSkill: { Magic: 30 } } } } }; },
  ];
  for (const index of [0, 1]) for (const [field, value] of Object.entries({
    unlocked: ['13108'], sectionOverrides: { '12853-0': false }, areaOverrides: { cave: false },
    sourceBacklogs: { items: { 'Air rune': true } }, taskRules: { Boosting: false },
    taskStatus: { task: { backlogged: false } }, completedTasks: ['quest'], obtainedEquipment: ['Fixture item'], runescapeName: 'DemoExplorer',
    skillProgress: { Magic: observation(25) }, questProgress: { quest: { source: 'runemetrics', runescapeName: 'DemoExplorer', title: 'A quest' } },
    primaryOverrides: { Magic: false }, passiveLevels: { Magic: 30 }, maxLevels: { Magic: 40 }, slayerLock: { level: 10 },
    xpChoices: { task: { 0: 'Magic' } },
    transportFacts: { confirmations: { 'lodestone-home-activated': false } },
    teleports: [{ id: 'home', destination: '13108', available: true }], teleportOverrides: { home: false },
    sourceMapId: original.members[0].id, name: 'Changed',
  })) changes.push(state => { state.members[index][field] = value; });
  for (const change of changes) {
    const changed = structuredClone(original); change(changed);
    assert.notEqual(automaticTravelInputKey(changed), key, change.toString());
  }
  assert.notEqual(automaticTravelInputKey(original, { actor1: { levels: { Magic: 25 } } }), key);
  const identity = structuredClone(original);
  identity.members[0].completedTasks = ['old'];
  identity.identityRegistry = { entries: { quest: { category: 'Quest', aliases: ['old'], label: 'Before' } } };
  const identityKey = automaticTravelInputKey(identity);
  identity.identityRegistry.entries.quest.label = 'After';
  assert.equal(automaticTravelInputKey(identity), identityKey, 'Registry review/display metadata is not identity resolution');
  identity.identityRegistry.aliases = { old: 'quest' };
  assert.notEqual(automaticTravelInputKey(identity), identityKey);
  const aliasedKey = automaticTravelInputKey(identity);
  delete identity.identityRegistry.entries.quest;
  assert.notEqual(automaticTravelInputKey(identity), aliasedKey, 'Candidate entry existence affects alias admission');
  const unrelated = structuredClone(original);
  const unrelatedKey = automaticTravelInputKey(unrelated);
  unrelated.identityRegistry = { entries: { registered: { category: 'Extra' } }, aliases: { registered: 'registered' } };
  unrelated.tasks.push({ id: 'registered', category: 'Extra', label: 'New tick registration' });
  unrelated.members[0].taskStatus = { registered: { challengeCompleted: true } };
  assert.equal(automaticTravelInputKey(unrelated), unrelatedKey, 'A first challenge tick can register its row without changing capabilities');
  unrelated.tasks.push({ id: 'quest', category: 'Quest', label: 'A quest' });
  assert.equal(automaticTravelInputKey(unrelated), unrelatedKey, 'An uncompleted saved Quest label cannot prove personal completion');
  unrelated.members[0].completedTasks = ['quest'];
  const questKey = automaticTravelInputKey(unrelated);
  unrelated.tasks.find(task => task.id === 'quest').label = 'Renamed quest';
  assert.notEqual(automaticTravelInputKey(unrelated), questKey, 'Completed Quest labels are keyed by content, including in-place edits');
  const aliases = structuredClone(original);
  aliases.members[0].taskStatus = { first: { backlogged: true }, second: { backlogged: false } };
  const ordered = automaticTravelInputKey(aliases);
  aliases.members[0].taskStatus = { second: { backlogged: false }, first: { backlogged: true } };
  assert.notEqual(automaticTravelInputKey(aliases), ordered, 'Alias backlog merge order is semantic');
  const beforeClear = automaticTravelInputKey(aliases);
  aliases.members[0].taskStatus.canonical = { backlogged: undefined };
  assert.notEqual(automaticTravelInputKey(aliases), beforeClear, 'Direct callers can explicitly clear an aliased flag');
  const legacy = structuredClone(original);
  legacy.legacy = { maps: { example: { chunkinfo: { manualAreas: { Cave: true, '%43ave': false } } } } };
  const beforeReorder = automaticTravelInputKey(legacy);
  legacy.legacy.maps.example.chunkinfo.manualAreas = { '%43ave': false, Cave: true };
  assert.notEqual(automaticTravelInputKey(legacy), beforeReorder, 'Decoded legacy names can collide; save order must survive');
});

test('cached travel, roll pool and task outputs equal cold calculations after representative edits', () => {
  const f = fixture();
  f.catalogue.routes = [spell(), route('home-stone', { kind: 'lodestone', to: 'home', automatic: { activation: 'default' },
    requirements: requirements({ confirmations: ['lodestone-home-activated'] }) })];
  f.state.members[0].runescapeName = 'DemoExplorer';
  f.state.members[0].taskStatus = {};
  f.state.rules['roll.neighborMode'] = 'manual';
  const quest = { id: taskId('Quest', 'A quest'), category: 'Quest', label: 'A quest' };
  f.state.tasks.push(quest);
  f.definitions.challenges.Quest = { 'A quest': { QuestPoints: 1 } };
  let proofs = 0;
  const engine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue });
  const registry = createRuleRegistry(['travel.automatic', 'access.transport', 'content.f2p'].filter(id => !builtInRules.some(rule => rule.id === id))
    .map(id => ({ id, type: 'boolean', default: false })));
  configureAutomaticTransport(f.world, { definitions: f.definitions, engine: { evaluate(state, id) { proofs++; return engine.evaluate(state, id); } } });
  // Elapsed time is diagnostic, not picker output.
  const clean = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
  const outputs = (taskEngine = engine) => clean({ routes: evaluateTransportRoutes(f.world, f.state, 'actor1'),
    pool: evaluateRollPool(f.world, f.state, 'actor1', registry), tasks: taskEngine.evaluate(f.state, 'actor1') });
  outputs();
  for (const [name, relevant, change] of [
    ['first generated tick', false, state => {
      state.tasks.push({ id: 'registered', category: 'Extra', label: 'New tick registration' });
      state.identityRegistry = { entries: { registered: { category: 'Extra' } }, aliases: { registered: 'registered' } };
      state.members[0].taskStatus.registered = { challengeCompleted: true };
    }],
    ['first Quest tick', false, state => {
      state.tasks.push({ id: 'registered-quest', category: 'Quest', label: 'New quest registration' });
      state.identityRegistry.entries['registered-quest'] = { category: 'Quest' };
      state.identityRegistry.aliases['registered-quest'] = 'registered-quest';
      state.members[0].taskStatus['registered-quest'] = { challengeCompleted: true };
    }],
    ['tick', false, state => { state.members[0].taskStatus[quest.id] = { challengeCompleted: true }; }],
    ['untick', false, state => { state.members[0].taskStatus[quest.id].challengeCompleted = false; }],
    ['task note', false, state => { state.members[0].taskStatus[quest.id].note = 'Plan'; }],
    ['travel rule', true, state => { state.rules['content.f2p'] = false; }],
    ['task capability rule', true, state => { state.members[0].taskRules = { Boosting: false }; }],
    ['roll rule', false, state => { state.rules['roll.adjacent'] = false; }],
    ['roll', false, state => { state.members[0].pendingRoll = ['13108']; }],
    ['unlock', true, state => { state.members[0].unlocked.push('13108'); }],
    ['roll pool', false, state => { state.members[0].selected = ['11569']; }],
    ['never roll', false, state => { state.members[0].blacklisted = ['11569']; }],
    ['lodestone override', true, state => { state.members[0].teleportOverrides = { 'home-stone': false }; }],
    ['lodestone confirmation', true, state => { state.members[0].transportFacts = { confirmations: { 'lodestone-home-activated': false } }; }],
    ['quest sync', true, state => { state.members[0].completedTasks = [quest.id]; state.members[0].questProgress = { [quest.id]: { source: 'runemetrics', runescapeName: 'DemoExplorer', title: 'A quest' } }; }],
    ['level sync', true, state => { state.members[0].skillProgress = { Magic: observation(25) }; }],
    ['backlog', true, state => { state.members[0].taskStatus[taskId('Extra', 'Anvil')] = { backlogged: true }; }],
  ]) {
    const before = proofs; change(f.state); f.state.revision++;
    const cached = outputs();
    assert.equal(proofs - before, relevant ? 1 : 0, `${name}: baseline cache boundary`);
    releaseAutomaticTransportCaches(f.world);
    const cold = outputs(createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue }));
    assert.deepEqual(cached, cold, name);
  }
});

test('shared retained/component providers reuse one unchanged baseline result', () => {
  const f = fixture(); let calls = 0;
  const provider = { definitions: f.definitions, engine: { evaluate: () => { calls++; return f.baseline; } } };
  const retained = { ...f.world };
  configureAutomaticTransport(f.world, provider); configureAutomaticTransport(retained, provider);
  deriveAutomaticTransport(f.world, f.state, 'actor1'); deriveAutomaticTransport(retained, f.state, 'actor1');
  assert.equal(calls, 1);
});

test('two exact baseline signatures retain actual and hypothetical supplies with bounded eviction', () => {
  const f = fixture(); let calls = 0;
  configureAutomaticTransport(f.world, { definitions: f.definitions, engine: { evaluate(state) {
    calls++; return { ...f.baseline, items: state.members[0].unlocked.includes('13108') ? [supply('Token')] : [] };
  } } });
  const actual = f.state, candidate = structuredClone(actual), third = structuredClone(actual);
  candidate.members[0].unlocked.push('13108'); third.members[0].unlocked.push('11569');
  assert.equal(deriveAutomaticTransport(f.world, actual, 'actor1').facts.items.Token, undefined);
  assert.ok(deriveAutomaticTransport(f.world, candidate, 'actor1').facts.items.Token);
  assert.equal(deriveAutomaticTransport(f.world, actual, 'actor1').facts.items.Token, undefined); assert.equal(calls, 2);
  deriveAutomaticTransport(f.world, third, 'actor1'); deriveAutomaticTransport(f.world, actual, 'actor1'); assert.equal(calls, 3);
  deriveAutomaticTransport(f.world, candidate, 'actor1'); assert.equal(calls, 4, 'Third state evicts the older candidate');
  candidate.taskRules = { 'Primary Woodcutting': false }; deriveAutomaticTransport(f.world, candidate, 'actor1'); assert.equal(calls, 5);
  candidate.identityRegistry = { aliases: { 'old-task': ['new-task'] } }; deriveAutomaticTransport(f.world, candidate, 'actor1'); assert.equal(calls, 5, 'Unreferenced identity does not affect capabilities');
  candidate.members[0].passiveLevels = { Magic: 2 }; deriveAutomaticTransport(f.world, candidate, 'actor1'); assert.equal(calls, 6);
  candidate.members[0].completedTasks = ['old-task']; deriveAutomaticTransport(f.world, candidate, 'actor1'); assert.equal(calls, 7);
  candidate.identityRegistry.aliases['old-task'] = 'other-task'; deriveAutomaticTransport(f.world, candidate, 'actor1'); assert.equal(calls, 8, 'Referenced identity changes invalidate');
});

test('automatic own-resource access requires an affordable return from the original walking bound', () => {
  const f = fixture();
  f.definitions.chunks['13108'] = { Sections: { '1': { Object: { Ore: true } }, '2': { Object: { Hidden: true } } } };
  f.definitions.sections['13108'] = { '1': [], '2': [] };
  f.definitions.challenges.Extra.Ore = { Objects: ['Ore'] };
  f.catalogue.stations.find(station => station.id === 'away').locationId = '13108-1';
  f.state.members[0].unlocked.push('13108');
  f.catalogue.routes = [route('own-ferry', { kind: 'ferry', bidirectional: false })];
  const engine = createTaskEngine(f.definitions, { ...options, transportRoutes: f.catalogue });
  f.state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const ore = () => engine.evaluate(f.state, 'actor1').access.objects.includes('Ore');
  assert.equal(ore(), false, 'Owned destination cannot supply a return by ownership alone');
  f.catalogue.routes[0].bidirectional = true;
  f.catalogue.routes[0].requirements.fare = { currency: 'coins', amount: 30 };
  f.state.members[0].transportFacts = { currencies: { coins: 30 } };
  assert.equal(ore(), false, 'Two 30-coin legs require 60 coins');
  f.state.members[0].transportFacts.currencies.coins = 60; assert.equal(ore(), true);
  f.catalogue.routes[0].bidirectional = false; f.state.members[0].transportFacts.currencies.coins = 30;
  f.state.members[0].teleports.push({ id: 'return', destination: '12853', available: true, consumable: false });
  assert.equal(ore(), true, 'A confirmed personal teleport to an existing home landing provides the return');
  f.state.members[0].teleports = [];
  const world = buildWorld(f.definitions, options); world.transportRoutes = f.catalogue;
  configureAutomaticTransport(world, { definitions: f.definitions, engine });
  const stone = { name: 'Home', chunkId: '12853', location: '12853', f2p: true };
  const withStone = () => expandTransportReachability(world, f.state, 'actor1', new Set(['12853']), { lodestones: [stone], transportRoutes: f.catalogue });
  assert.equal(withStone().has('13108-1'), true, 'A reached existing unique lodestone landing can provide the return');
  f.catalogue.routes.push(route('special-stone', { from: null, to: 'home', kind: 'lodestone', automatic: { activation: 'build' },
    requirements: requirements({ confirmations: ['special-build-completed'] }) }));
  assert.equal(withStone().has('13108-1'), false, 'Retained stone lookup cannot bypass a reviewed unknown special build');
  f.catalogue.stations.push({ ...station('unresolved-stone', '12853'), plane: 1 });
  f.catalogue.routes[1] = route('unresolved-stone', { from: null, to: 'unresolved-stone', kind: 'lodestone', automatic: { activation: 'default' } });
  assert.equal(withStone().has('13108-1'), false, 'A retained selector cannot supply a return when its reviewed station is unresolved');
  f.state.rules['travel.automatic'] = false;
  assert.equal(ore(), true, 'Automatic OFF preserves legacy outward-only own-resource semantics');
});

test('roll-only automation leaves task-access partner calculation free of automatic baseline work', () => {
  const f = fixture(); f.state.rules['access.transport'] = false;
  evaluatePartnerConnections(f.world, f.state, 'actor1', { lodestones: [] });
  assert.equal(f.calls(), 0, 'Untyped retained travel has no costs requiring automatic supplies');
  const home = '12853-1000001', partner = '11569-1000001';
  f.world.cacheWalking = { provenance: { mapId: 28 }, components: new Map([[home, { free: true }], [partner, { free: true }]]),
    fallback: new Set(), mapping: [], topology: new Map([['12853', new Map([['1000001', []]])], ['11569', new Map([['1000001', []]])]]),
    legacyToComponents: new Map([['12853-0', [home]], ['11569-0', [partner]]]),
    componentToLegacy: new Map([[home, ['12853-0']], [partner, ['11569-0']]]) };
  evaluatePartnerConnections(f.world, f.state, 'actor1', { lodestones: [], personalTravelSeeds: [home],
    sectionsByMember: { actor1: [home], reed: [partner] } });
  assert.equal(f.calls(), 0, 'Component recursion must not request a supply budget for walking-only task access');
});

test('evaluation-scoped transport graph memo skips repeated topology traversals while keeping root and bound changes', () => {
  const f = fixture(); f.state.members[0].unlocked.push('13108');
  f.catalogue.routes = [route('one-way', { kind: 'ferry', bidirectional: false })];
  const original = f.world.sectionTopology[Symbol.iterator]; let traversals = 0;
  f.world.sectionTopology[Symbol.iterator] = function () { traversals++; return original.call(this); };
  const transportMemo = {}, options = { transportRoutes: f.catalogue, lodestones: [], transportMemo };
  const fromHome = () => expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), options);
  assert.deepEqual([...fromHome()], ['12853']); const initialTraversals = traversals;
  assert.deepEqual([...fromHome()], ['12853']); assert.equal(traversals, initialTraversals, 'Unchanged lower, upper and actual graphs are reused');
  assert.deepEqual([...expandTransportReachability(f.world, f.state, 'actor1', new Set(['13108']), options)], ['13108']);
  assert.equal(traversals, initialTraversals, 'A different original root recomputes journey paths against the same graphs');
  assert.deepEqual([...expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), { ...options,
    claimed: new Set(['12853']) })], ['12853']); assert.ok(traversals > initialTraversals, 'Changed ownership bound rebuilds graphs'); const ownedTraversals = traversals;
  expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), { ...options, sectionOverrides: { '13108-0': false } });
  assert.ok(traversals > ownedTraversals, 'Changed section safety rebuilds graphs'); const blockedTraversals = traversals;
  const hypothetical = structuredClone(f.state); hypothetical.members[0].unlocked.push('11569');
  expandTransportReachability(f.world, hypothetical, 'actor1', new Set(['12853']), options);
  assert.ok(traversals > blockedTraversals, 'Different actual/hypothetical state cannot share the lifetime cache'); const stateTraversals = traversals;
  expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), { ...options, transportMemo: {} });
  assert.ok(traversals > stateTraversals, 'A new task evaluation gets fresh graphs');
});

test('physical no-op proof skips supplies but recomputes narrower walking roots and keeps the full availability API', () => {
  const f = fixture(); f.state.members[0].unlocked.push('13108');
  f.catalogue.routes = [route('ferry', { kind: 'ferry', bidirectional: true, requirements: requirements({
    levels: { Magic: 25 }, fare: { currency: 'coins', amount: 30 }, quests: ['Personal quest'] }) })];
  f.state.members[0].skillProgress = { Magic: observation(1) };
  f.state.members[0].teleportOverrides = { ferry: true }; f.state.members[0].transportFacts = { currencies: { coins: 60 } };
  const opts = { transportRoutes: f.catalogue, lodestones: [], transportMemo: {} };
  const both = expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853', '13108']), opts);
  assert.equal(both.transportNoop, true); assert.equal(f.calls(), 0, 'All physically valid destinations already belong to the exact walking roots');
  const narrow = expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), opts);
  assert.equal(narrow.has('13108'), true); assert.equal(f.calls(), 1, 'Changed task-gated roots need current supplies and override evaluation');
  f.state.members[0].teleportOverrides.ferry = false;
  assert.deepEqual([...expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), { ...opts, transportMemo: {} })], ['12853']);
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false, 'A no-op access proof never changes the full API');
  delete f.state.members[0].teleportOverrides.ferry;
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false, 'Authoritative low personal level remains restrictive');
});

test('shared physical bounds avoid irrelevant baselines and fall back for ambiguous custom landings', () => {
  const f = fixture(); f.catalogue.routes = [route('unused', { kind: 'ferry', requirements: requirements({ items: ['Unavailable item'] }) })];
  const result = evaluatePartnerConnections(f.world, f.state, 'actor1', { transportRoutes: f.catalogue, lodestones: [] });
  assert.equal(result.transportNoop, true); assert.equal(f.calls(), 0); assert.equal(result.byChunk['11569'].connected, false);
  f.world.sectionTopology.set('11569', new Map([['1', []], ['2', []]]));
  f.state.members[0].teleports.push({ id: 'ambiguous', available: true, destination: '11569' });
  evaluatePartnerConnections(f.world, f.state, 'actor1', { transportRoutes: f.catalogue, lodestones: [], sectionsByMember: { reed: ['11569-1'] } });
  assert.equal(f.calls(), 1, 'Legacy landing choice can depend on admitted nodes, so the proof must fall back');
});

test('partner round trips cannot bypass reviewed lodestone overrides, special builds or quests', () => {
  const f = fixture();
  const ferry = route('outbound', { to: 'partner', kind: 'ferry', bidirectional: false });
  const stone = route('home-stone', { from: null, to: 'home', kind: 'lodestone', automatic: { activation: 'default' },
    requirements: requirements({ confirmations: ['lodestone-home-activated'] }) });
  f.catalogue.routes = [ferry, stone];
  const connected = () => evaluatePartnerConnections(f.world, f.state, 'actor1', { transportRoutes: f.catalogue,
    lodestones: [{ name: 'Home', chunkId: '12853', location: '12853', f2p: true }] }).byChunk['11569'].connected;
  assert.equal(connected(), true);
  f.state.members[0].teleportOverrides = { 'home-stone': false }; assert.equal(connected(), false);
  delete f.state.members[0].teleportOverrides;
  stone.automatic.activation = 'build'; stone.requirements.confirmations = ['home-build-completed']; assert.equal(connected(), false);
  stone.automatic.activation = 'default'; stone.requirements = requirements({ quests: ['Unknown quest'], confirmations: ['lodestone-home-activated'] });
  assert.equal(connected(), false);
  f.state.rules['travel.automatic'] = false;
  f.state.members[0].transportFacts = { confirmations: { 'lodestone-home-activated': true } };
  assert.equal(connected(), true, 'Automatic OFF retains its historical raw activation behavior');
});

test('a dominating zero-cost path replaces a full frontier of paid alternatives', () => {
  const seeds = Array.from({ length: 64 }, (_, i) => ({ id: 'target', cost: { [`items:token-${i}`]: 1 } }));
  seeds.push({ id: 'zero' });
  const budget = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`items:token-${i}`, 1]));
  const paths = affordableTransportPaths(seeds, new Map([['zero', [{ to: 'target', cost: {} }]]]), budget);
  assert.deepEqual(paths.get('target'), [{}], 'The frontier cap cannot discard a later path dominating every paid option');
});

test('explicit-only warning refutation skips irrelevant supplies and preserves every actual available route in the upper bound', () => {
  const f = fixture(); f.state.members[0].unlocked.push('13108');
  f.catalogue.routes = [route('lever', { kind: 'portal', bidirectional: true,
    requirements: requirements({ confirmations: ['wilderness-pvp-warning-accepted'] }) })];
  const opts = { transportRoutes: f.catalogue, lodestones: [], transportMemo: {} };
  assert.equal(expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), opts).transportNoop, true);
  assert.equal(f.calls(), 0, 'Renewable supplies cannot establish personal warning acceptance');
  assert.equal(physicalTransportRoutes(f.world, f.state, 'actor1', opts)[0].available, false);
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[0].available, false, 'Actual automatic facts do not invent acceptance');
  for (const declaration of [false, true]) {
    const changed = structuredClone(f.state);
    changed.members[0].transportFacts = { confirmations: { 'wilderness-pvp-warning-accepted': declaration } };
    const actual = evaluateRoutes(f.world, changed, 'actor1', opts), upper = physicalTransportRoutes(f.world, changed, 'actor1', opts);
    assert.equal(actual[0].available, declaration); assert.equal(upper[0].available, declaration);
    assert.ok(actual.filter(row => row.available).every(row => upper.some(bound => bound.id === row.id && bound.available)));
  }
  const forced = structuredClone(f.state); forced.members[0].teleportOverrides = { lever: true };
  const reached = expandTransportReachability(f.world, forced, 'actor1', new Set(['12853']), opts);
  assert.equal(reached.has('13108'), true, 'Override in a new state invalidates the previous no-op proof');
  assert.equal(physicalTransportRoutes(f.world, forced, 'actor1', opts)[0].available, true);
  const injected = { ...opts, transportFactsByMember: { actor1: { confirmations: { 'wilderness-pvp-warning-accepted': true } } } };
  assert.equal(physicalTransportRoutes(f.world, f.state, 'actor1', injected)[0].available, true, 'Injected declarations use the same proof policy');
  assert.equal(expandTransportReachability(f.world, f.state, 'actor1', new Set(['12853']), injected).has('13108'), true,
    'The own proof must pass injected declarations to its upper bound');
  f.catalogue.routes[0].to = 'partner';
  f.world.transportFactsByMember = injected.transportFactsByMember;
  assert.equal(evaluatePartnerConnections(f.world, f.state, 'actor1', { transportRoutes: f.catalogue, lodestones: [], transportMemo: {} })
    .byChunk['11569'].connected, true, 'Shared proof must preserve world-injected declarations before deriving routes');
});

test('zero-cost physical routes contain actual available routes across personal supplies and hard house-rule guards', () => {
  const f = fixture({ items: [supply('Air rune'), supply('Fire rune'), supply('Law rune'), supply('Token')] });
  f.catalogue.routes = [spell(), route('paid', { kind: 'ferry', bidirectional: true, requirements: requirements({ fare: { currency: 'coins', amount: 30 } }) }),
    route('quest', { requirements: requirements({ quests: ['Quest A'] }) }), route('member', { members: true, f2p: false }),
    route('malformed', { requirements: requirements({ fare: { amount: 'unknown' } }) })];
  f.state.rules['roll.consumableTeleports'] = true; f.state.members[0].transportFacts = { currencies: { coins: 60 } };
  f.state.members[0].skillProgress = { Magic: observation(25) };
  for (const overrides of [{}, { quest: true, member: true, malformed: true }, { paid: false }]) {
    const changed = structuredClone(f.state); changed.members[0].teleportOverrides = overrides;
    const actual = evaluateRoutes(f.world, changed, 'actor1', { transportRoutes: f.catalogue });
    const upper = physicalTransportRoutes(f.world, changed, 'actor1', { transportRoutes: f.catalogue });
    assert.ok(actual.filter(row => row.available).every(row => upper.some(bound => bound.id === row.id && bound.available)));
    assert.ok(upper.every(row => !Object.keys(row.cost).length), 'The bound never requires supply-budget derivation');
    assert.equal(upper.find(row => row.id === 'member').available, false);
    assert.equal(upper.find(row => row.id === 'malformed').available, false);
  }
});

test('task access defers supply diagnostics only when the exact no-op proof succeeds', () => {
  const f = fixture(); f.catalogue.routes = [route('local', { to: 'home', kind: 'ferry', requirements: requirements({ levels: { Magic: 100 } }) })];
  const index = buildAccessIndex(f.definitions, { ...options, transportRoutes: f.catalogue });
  let calls = 0;
  configureAutomaticTransport(index.world, { definitions: f.definitions, engine: { evaluate() { calls++; return f.baseline; } } });
  let access = calculateAccess(index, f.state, 'actor1', { transportMemo: {} });
  assert.equal(calls, 0, 'Irrelevant diagnostics must not eagerly evaluate supplies');
  assert.ok(access.spawns.has('Air rune')); assert.ok(!access.diagnostics.some(row => row.code === 'transport-requirements'));
  assert.equal(evaluateRoutes(index.world, f.state, 'actor1', { transportRoutes: f.catalogue })[0].available, false, 'Full API still evaluates personal requirements');
  f.catalogue.routes = [route('extension', { kind: 'ferry', bidirectional: true, requirements: requirements({ levels: { Magic: 100 } }) })];
  f.state.members[0].unlocked.push('13108');
  f.definitions.sections['13108'] = { '1': [] }; f.catalogue.stations[1] = station('away', '13108', '1');
  const split = buildAccessIndex(f.definitions, { ...options, transportRoutes: f.catalogue });
  configureAutomaticTransport(split.world, { definitions: f.definitions, engine: { evaluate() { calls++; return f.baseline; } } });
  const before = calls; access = calculateAccess(split, f.state, 'actor1', { transportMemo: {} });
  assert.ok(calls > before, 'A physical extension requires current personal facts');
  assert.ok(access.diagnostics.some(row => row.code === 'transport-requirements' && row.routeId === 'extension'));
});


test('cache-component round-trip recursion preserves renewable budgets and does not promote resource-only sections', () => {
  const f = fixture({ items: [supply('Coins')] });
  const components = new Map(['12853', '13108', '11569'].map(base => [`${base}-1000001`, { id: `${base}-1000001`, base, free: true }]));
  f.world.cacheWalking = { provenance: { mapId: 28 }, components, fallback: new Set(), blockedRegions: new Set(), mapping: [],
    topology: new Map(['12853', '13108', '11569'].map(base => [base, new Map([['1000001', []]])])),
    legacyToComponents: new Map(['12853', '13108', '11569'].map(base => [`${base}-0`, [`${base}-1000001`]])),
    componentToLegacy: new Map(['12853', '13108', '11569'].map(base => [`${base}-1000001`, [`${base}-0`]])),
    tileComponents: new Map(f.catalogue.stations.map(s => [`28:0:${s.x}:${s.y}`, `${s.chunkId}-1000001`])) };
  f.baseline.access = { bases: ['12853'], components: ['12853-1000001'], sections: ['13108-0'] };
  f.catalogue.routes = [route('cached-ferry', { from: 'home', to: 'partner', kind: 'ferry', bidirectional: true,
    requirements: requirements({ fare: { currency: 'coins', amount: 30 } }) }),
    route('resource-only-stone', { from: null, kind: 'lodestone', automatic: { activation: 'touch' },
      requirements: requirements({ confirmations: ['lodestone-away-activated'] }) })];
  assert.equal(evaluateTransportRoutes(f.world, f.state, 'actor1')[1].available, false);
  const connections = evaluatePartnerConnections(f.world, f.state, 'actor1', { lodestones: [],
    sectionsByMember: { actor1: ['12853-1000001'], reed: ['11569-1000001'] } });
  assert.equal(connections.byChunk['11569'].connected, true);
});



