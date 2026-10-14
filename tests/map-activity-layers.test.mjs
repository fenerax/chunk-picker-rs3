import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapActivityLayers } from '../app/web/map-activity-layers.mjs';

test('unsupported catalogue layers expose no controls and never load saved legacy choices', async () => {
  let reads = 0;
  const c = { supportsFeature: () => false, el: () => ({ children: [] }), api: () => { throw new Error('Unsupported catalogue requested'); } };
  const layer = createMapActivityLayers(c, { storage: { getItem() { reads++; return '{"clueTier":"all","showSlayer":true}'; } } });
  await layer.refresh(); layer.sync();
  assert.equal(reads, 0);
  assert.deepEqual(layer.preferences, { clueTier: 'off', showSlayer: false });
  assert.equal(layer.controls('display').children.length, 0);
  assert.equal(layer.model().clues.size, 0); assert.equal(layer.model().slayer.size, 0);
});

class Element {
  constructor(tag, text, className) {
    this.tag = tag; this.textContent = text ?? ''; this.className = className ?? '';
    this.children = []; this.attributes = {}; this.listeners = new Map();
    this.value = ''; this.checked = false; this.hidden = false;
  }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  change(value) {
    if (this.tag === 'select') this.value = value; else this.checked = value;
    this.listeners.get('change')?.();
  }
  find(id) {
    if (this.id === id) return this;
    for (const child of this.children) { const match = child.find(id); if (match) return match; }
  }
}
const definitions = () => ({
  clues: { easy: { '12341': true }, hard: { '12342-1': true } },
  codeItems: { slayerTasks: { Cows: { Cow: true }, Goblins: { Goblin: true } } },
  chunks: {
    '12341': { Sections: { '1': { Monster: { Cow: 2 } } } },
    '12342': { Sections: { '1': { Monster: { Goblin: 3 } } } },
  },
});
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ saved, storageFailure = false, api } = {}) {
  const requests = [], stored = [], paints = [], models = [], commands = [];
  const storage = {
    getItem(key) { assert.equal(key, 'picker.activity-layers'); if (storageFailure) throw new Error('blocked'); return saved ?? null; },
    setItem(key, value) { if (storageFailure) throw new Error('blocked'); stored.push([key, JSON.parse(value)]); },
  };
  const c = {
    memberId: 'a', viewer: true, sandbox: { active: false },
    state: { revision: 1, rules: { 'content.f2p': false }, members: [
      { id: 'a', slayerLock: { monster: 'Cows' } }, { id: 'b', slayerLock: { monster: 'Goblins' } },
    ] },
    world: { chunks: new Map([['12341', {}], ['12342', {}]]), f2p: new Set(['12341', '12342']) },
    member() { return this.state.members.find(member => member.id === this.memberId); },
    el: (tag, text, className) => new Element(tag, text, className),
    input(type) { const element = new Element('input'); element.type = type; return element; },
    api(path, options) { requests.push([path, options]); return api ? api(path, options) : Promise.resolve(definitions()); },
    command(...args) { commands.push(args); throw new Error('viewer command must not run'); },
    save(...args) { commands.push(args); throw new Error('layer preferences must not save game state'); },
    map: {
      setActivityLayerPreferences(value) { paints.push({ ...value }); },
      setActivityLayers(value) { models.push(value); },
    },
    legendRenders: 0,
    renderLegend() { this.legendRenders++; },
  };
  const layers = createMapActivityLayers(c, { storage });
  const display = layers.controls('display'), legend = layers.controls('legend');
  const clues = placement => (placement === 'legend' ? legend : display).find(`map-activity-clues-${placement}`);
  const slayer = placement => (placement === 'legend' ? legend : display).find(`map-activity-slayer-${placement}`);
  const note = placement => (placement === 'legend' ? legend : display).children.at(-1);
  return { c, layers, requests, stored, paints, models, commands, clues, slayer, note };
}

test('default-off controls and refresh request no activity data', async () => {
  const f = fixture(); await f.layers.refresh();
  assert.deepEqual(f.layers.preferences, { clueTier: 'off', showSlayer: false });
  assert.equal(f.clues('display').value, 'off'); assert.equal(f.slayer('legend').checked, false);
  assert.equal(f.requests.length, 0); assert.equal(f.stored.length, 0);
  assert.equal(f.note('display').hidden, true);
  assert.equal(f.models.at(-1).clues.size, 0); assert.equal(f.models.at(-1).slayer.size, 0);
});

test('display and legend controls sync and persist locally in viewer and Sandbox without game writes', async () => {
  for (const sandbox of [false, true]) {
    const f = fixture(); f.c.sandbox.active = sandbox;
    const before = JSON.stringify(f.c.state);
    f.clues('display').change('hard'); await settle();
    assert.equal(f.clues('legend').value, 'hard');
    f.slayer('legend').change(true); await settle();
    assert.equal(f.slayer('display').checked, true);
    assert.deepEqual(f.stored.at(-1), ['picker.activity-layers', { clueTier: 'hard', showSlayer: true }]);
    assert.deepEqual(f.paints.at(-1), { clueTier: 'hard', showSlayer: true });
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0][0], '/api/definitions?view=map-layers-v1');
    assert.equal(f.requests[0][1], undefined);
    assert.deepEqual(f.commands, []); assert.equal(JSON.stringify(f.c.state), before);
    assert.ok(f.c.legendRenders > 0);
    assert.match(f.note('legend').textContent, /Clue spots only/);
    assert.match(f.note('legend').textContent, /Surface spots only/);
    assert.equal(f.clues('display').attributes['aria-label'], 'Clue steps on map');
    assert.equal(f.note('display').attributes.role, 'status');
  }
});

test('saved valid preferences restore locally and malformed or unavailable storage falls back safely', async () => {
  const restored = fixture({ saved: JSON.stringify({ clueTier: 'elite', showSlayer: true }) });
  assert.equal(restored.requests.length, 0);
  assert.equal(restored.clues('legend').value, 'elite'); assert.equal(restored.slayer('display').checked, true);
  await restored.layers.refresh(); assert.equal(restored.requests.length, 1);
  for (const options of [{ saved: '{' }, { saved: '{"clueTier":"bogus","showSlayer":"yes"}' }, { storageFailure: true }]) {
    const f = fixture(options);
    assert.deepEqual(f.layers.preferences, { clueTier: 'off', showSlayer: false });
    f.clues('legend').change('easy'); await settle();
    assert.equal(f.clues('display').value, 'easy');
    assert.equal(f.layers.model().clues.size, 2);
  }
});

test('first opt-in shares one lazy read and later tier or Slayer switches reuse cached definitions', async () => {
  const pending = deferred(), f = fixture({ api: () => pending.promise });
  f.clues('display').change('easy'); f.slayer('legend').change(true); f.clues('legend').change('master');
  assert.equal(f.requests.length, 1);
  assert.match(f.note('display').textContent, /Finding map locations/);
  pending.resolve(definitions()); await settle();
  assert.equal(f.layers.model().slayerLabel, 'Cows');
  f.clues('display').change('all'); f.slayer('display').change(false); await settle();
  f.clues('legend').change('off'); await settle();
  assert.equal(f.layers.model().clues.size, 0); assert.equal(f.note('legend').hidden, true);
  f.slayer('display').change(true); await settle();
  assert.equal(f.requests.length, 1); assert.equal(f.layers.model().slayerLabel, 'Cows');
});

test('player and revision changes during a pending read publish only the newest target model', async () => {
  const pending = deferred(), f = fixture({ api: () => pending.promise });
  f.slayer('display').change(true);
  f.c.memberId = 'b'; const playerRefresh = f.layers.refresh();
  f.c.state = { ...f.c.state, revision: 2, members: f.c.state.members.map(member => ({ ...member, slayerLock: null })) };
  const revisionRefresh = f.layers.refresh();
  pending.resolve(definitions()); await Promise.all([playerRefresh, revisionRefresh]); await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.layers.model().slayer.size, 0);
  assert.ok(f.models.every(model => model.slayer.size === 0));
  assert.match(f.note('legend').textContent, /No Slayer monster or Reaper boss/);
  f.c.state = { ...f.c.state, revision: 3, members: [{ id: 'b', slayerLock: { monster: 'Goblins' } }] };
  await f.layers.refresh();
  assert.deepEqual([...f.layers.model().slayer.keys()], ['12342']);
  assert.equal(f.requests.length, 1);
});

test('turning every layer off during a pending read keeps the map empty after resolution', async () => {
  const pending = deferred(), f = fixture({ api: () => pending.promise });
  f.clues('display').change('all'); f.slayer('display').change(true);
  f.clues('legend').change('off'); f.slayer('legend').change(false);
  pending.resolve(definitions()); await settle();
  assert.equal(f.layers.model().clues.size, 0); assert.equal(f.layers.model().slayer.size, 0);
  assert.ok(f.models.every(model => model.clues.size === 0 && model.slayer.size === 0));
  assert.equal(f.note('display').hidden, true);
  f.clues('display').change('easy'); await settle();
  assert.equal(f.layers.model().clues.size, 2); assert.equal(f.requests.length, 1);
});

test('failed read shows synchronized retry guidance and off/on retries successfully', async () => {
  let attempt = 0;
  const f = fixture({ api: () => ++attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(definitions()) });
  f.slayer('legend').change(true); await settle();
  assert.match(f.note('legend').textContent, /could not load/);
  assert.equal(f.note('display').textContent, f.note('legend').textContent);
  assert.equal(f.layers.model().slayer.size, 0);
  f.slayer('display').change(false); await settle(); assert.equal(f.note('legend').hidden, true);
  f.slayer('display').change(true); await settle();
  assert.equal(f.requests.length, 2); assert.equal(f.layers.model().slayerLabel, 'Cows');
  assert.doesNotMatch(f.note('display').textContent, /could not load/);
});

test('rejection from an obsolete request cannot restore failure status after layers turn off', async () => {
  const pending = deferred(), f = fixture({ api: () => pending.promise });
  f.clues('display').change('easy'); f.clues('legend').change('off');
  pending.reject(new Error('late failure')); await settle();
  assert.equal(f.note('display').hidden, true);
  assert.equal(f.layers.model().clues.size, 0);
  assert.deepEqual(f.commands, []);
});

test('world replacement at the same player and revision rebuilds locations without refetching', async () => {
  const f = fixture(); f.clues('display').change('all'); f.slayer('display').change(true); await settle();
  assert.equal(f.layers.model().clues.size, 2); assert.equal(f.layers.model().slayer.size, 1);
  f.c.world = { ...f.c.world, chunks: new Map([['12342', {}]]) };
  await f.layers.refresh();
  assert.deepEqual([...f.layers.model().clues.keys()], ['12342']);
  assert.equal(f.layers.model().slayer.size, 0); assert.equal(f.requests.length, 1);
});
