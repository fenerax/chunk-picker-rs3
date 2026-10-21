import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAccessIndex, calculateAccess, walkingConnections } from '../app/tasks/access.mjs';
import { surfaceReachability } from '../app/core/cache-surface.mjs';

const reference = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
const state = (unlocked, sectionOverrides = {}, f2p = false) => ({
  rules: { 'content.f2p': f2p }, members: [{ id: 'm', unlocked, sectionOverrides }],
});

// Focused cache geometry keeps the task resources and legacy policy IDs small.
function fixture({ numericGate = true, transport = false } = {}) {
  const definitions = { chunks: {
    100: { Object: { Source: 1 } },
    200: { Sections: {
      1: { Object: { Tree: 1 }, Connect: { Cave: { Tasks: { 'Open cave': 'Nonskill' } }, '200-2': numericGate } },
      2: { Object: { Furnace: 1 } }, 3: { Object: { Altar: 1 } },
    } },
    300: { Sections: { 1: { Object: { 'Ambiguous tree': 1 } }, 2: {} } },
    Cave: { Object: { Ore: 1 } },
  }, sections: { 100: { 0: ['200-1'] }, 200: { 1: ['100'], 2: ['100'], 3: ['200-2'] }, 300: { 1: ['100'], 2: [] } } };
  const index = buildAccessIndex(definitions);
  const components = new Map([
    ['100-1000001', { base: '100', label: 1, free: true }],
    ['200-1000001', { base: '200', label: 1, free: true }],
    ['200-1000002', { base: '200', label: 2, free: false }],
    ['200-1000003', { base: '200', label: 3, free: true }],
    ['300-1000001', { base: '300', label: 1, free: true }],
    ['300-1000002', { base: '300', label: 2, free: true }],
  ]);
  index.world.cacheWalking = {
    components,
    topology: new Map([
      ['100', new Map([['1000001', ['200-1000001']]])],
      ['200', new Map([['1000001', ['100-1000001']], ['1000002', []], ['1000003', []]])],
      ['300', new Map([['1000001', []], ['1000002', []]])],
    ]),
    legacyToComponents: new Map([
      ['100-0', ['100-1000001']], ['200-1', ['200-1000001']],
      ['200-2', ['200-1000002']], ['200-3', ['200-1000003']],
    ]),
    componentToLegacy: new Map([
      ['100-1000001', ['100-0']], ['200-1000001', ['200-1']],
      ['200-1000002', ['200-2']], ['200-1000003', ['200-3']],
    ]),
    fallback: new Set(), mapping: [],
  };
  index.world.f2p = new Set(['100', '200', '300']);
  index.world.walkable = new Set(['100', '200', '300']);
  // buildAccessIndex's full-reference test below checks suppression itself.
  for (const [from, edges] of index.reverse) index.reverse.set(from, edges.filter(edge => edge.via !== 'topology'));
  if (transport) index.world.sectionRoutes = new Map([['200-2', new Map([['200-1', 'transport']])]]);
  return index;
}

test('full-reference access index replaces surface topology reversal with cache traversal', () => {
  const index = buildAccessIndex(reference, { dataset: selectedDataset });
  assert(index.world.cacheWalking);
  for (const edges of index.reverse.values()) for (const edge of edges) {
    if (index.world.cacheWalking.topology.has(edge.to.split('-')[0])) assert.notEqual(edge.via, 'topology');
  }
  assert(index.reverse.get('11825-2').some(edge => edge.to === '12082-1' && edge.via === 'transport'));
  assert(index.reverse.get('10287-2').some(edge => edge.to === '10030' && edge.via === 'transport'));
});

test('cache boundaries grant legacy resources without stale topology or unconditional numeric Connect bypasses', () => {
  const index = fixture();
  const access = calculateAccess(index, state(['100', '200'], { '200-1': true }), 'm');
  assert(access.sections.has('200-1'));
  assert(access.components.has('200-1000001'));
  assert(access.sections.has('200-1000001'), 'Territory callers receive canonical component IDs');
  assert(access.objects.has('Tree'));
  assert(!access.sections.has('200-2'));
  assert(!access.objects.has('Furnace'));
  assert(!access.areas.has('Cave'));
  assert(!walkingConnections(index, new Set()).some(([from, to]) => from === '200-1' && to === '200-2'));
  const gated = calculateAccess(index, state(['100', '200'], { '200-1': true }), 'm', {
    validTasks: new Set(['Nonskill\u0000Open cave']),
  });
  assert(gated.areas.has('Cave'));
  assert(gated.objects.has('Ore'));
});

test('personal completed numeric task gates seed their certified components but remain blocked by false overrides', () => {
  const index = fixture({ numericGate: { Tasks: { 'Open bridge': 'Nonskill' } } });
  const validTasks = new Set(['Nonskill\u0000Open bridge']);
  const access = calculateAccess(index, state(['200'], { '200-1': true }), 'm', { validTasks });
  assert(access.sections.has('200-2'));
  assert(access.components.has('200-1000002'));
  assert(access.objects.has('Furnace'));
  const blocked = calculateAccess(index, state(['200'], { '200-1': true, '200-2': false }), 'm', { validTasks });
  assert(!blocked.sections.has('200-2'));
  assert(!blocked.components.has('200-1000002'));
  assert(!blocked.objects.has('Furnace'));
  assert(!calculateAccess(index, state(['200']), 'm', { validTasks }).sections.has('200-2'), 'A task cannot seed an unentered cycle');
});

test('F2P component membership still applies to automatically task-gated surface resources', () => {
  const index = fixture({ numericGate: { Tasks: { 'Open bridge': 'Nonskill' } } });
  const validTasks = new Set(['Nonskill\u0000Open bridge']);
  const access = calculateAccess(index, state(['200'], { '200-1': true }, true), 'm', { validTasks });
  assert(!access.sections.has('200-2'));
  assert(!access.components.has('200-1000002'));
  assert(!access.objects.has('Furnace'));
  const manual = calculateAccess(index, state(['200'], { '200-1': true, '200-2': true }, true), 'm', { validTasks });
  assert(manual.objects.has('Furnace'), 'An explicit personal resource override remains reviewable');
  assert(!manual.components.has('200-1000002'), 'A resource override cannot turn members terrain free');
});

test('duplicate unconditional numeric metadata cannot masquerade as a personal task gate', () => {
  const index = fixture({ numericGate: { __all: [true, true] } });
  const access = calculateAccess(index, state(['200'], { '200-1': true }), 'm');
  assert(!access.sections.has('200-2'));
  assert(!walkingConnections(index, new Set()).some(([from, to]) => from === '200-1' && to === '200-2'));
});

test('ambiguous manual legacy sections retain their resources without granting arbitrary walking components', () => {
  const access = calculateAccess(fixture(), state(['300'], { '300-1': true }), 'm');
  assert(access.sections.has('300-1'));
  assert(access.objects.has('Ambiguous tree'));
  assert(![...access.components].some(id => id.startsWith('300-')));
});

test('classified numeric transport retains resource access and is excluded from walking routes', () => {
  const index = fixture({ transport: true });
  const access = calculateAccess(index, state(['200'], { '200-1': true }), 'm');
  assert(access.objects.has('Furnace'));
  assert(!walkingConnections(index, new Set()).some(([from, to]) => from === '200-1' && to === '200-2'));
});

test('cache component access never claims an intermediate or borrows a partner seed', () => {
  const index = fixture();
  const doc = state(['300']);
  doc.members.push({ id: 'partner', unlocked: ['200'], sectionOverrides: { '200-1': true } });
  const access = calculateAccess(index, doc, 'm');
  assert(!access.bases.has('200'));
  assert(!access.components.has('200-1000001'));
  assert(!access.objects.has('Tree'));
});

test('blocked unsplit component ownership does not collect its resources or seed entrances', () => {
  const index = fixture();
  const access = calculateAccess(index, state(['100'], { '100-0': false }), 'm');
  assert(access.bases.has('100'), 'Ownership survives a personal component block');
  assert(!access.components.has('100-1000001'));
  assert(!access.objects.has('Source'));
});

test('partner capability recomputation cannot seed an unadmitted component from bare ownership', () => {
  const index = fixture();
  const access = calculateAccess(index, state(['300']), 'm', {
    territory: { bases: new Set(['100', '200', '300']), sections: new Set(['200-1000001']) },
  });
  assert(access.components.has('200-1000001'));
  assert(!access.components.has('100-1000001'));
  assert(!access.objects.has('Source'));
});

test('retained bare-base underground entrances use an entered split section without seeding surface geometry', () => {
  const index = buildAccessIndex(reference, { dataset: selectedDataset });
  const doc = state(['11317'], { '11317-2': true }, true);
  const validTasks = new Set(['Nonskill\u0000Taverley Well Cave']);
  assert(!calculateAccess(index, doc, 'm').areas.has('Taverley Well Cave'), 'Retained area task gates still apply');
  const access = calculateAccess(index, doc, 'm', { validTasks });
  assert(access.sections.has('11317-2'));
  assert(access.areas.has('Taverley Well Cave'));
  const surface = surfaceReachability(index.world, new Set(['11317']), doc.members[0].sectionOverrides, { f2p: true });
  assert.deepEqual([...access.components].sort(), [...surface].sort(), 'Interior return markers cannot seed another component');
  assert(!calculateAccess(index, state(['11317'], {}, true), 'm', { validTasks }).areas.has('Taverley Well Cave'), 'Ownership without entered section cannot use an entrance');
  assert(!calculateAccess(index, state(['11317'], { '11317-2': false }, true), 'm', { validTasks }).areas.has('Taverley Well Cave'), 'Blocked approach remains unavailable');
});

function compatibilityFixture({ mapped = false, candidates = [1, 2] } = {}) {
  const index = fixture();
  const mapping = { legacy: '300-1', components: mapped ? [2] : [], candidates, project: false };
  index.world.cacheWalking.mapping = [mapping];
  if (mapped) index.world.cacheWalking.legacyToComponents.set('300-1', ['300-1000002']);
  index.resourceCompatibility = [{ to: '300-1', from: '200-1', mapping }];
  index.world.sectionTopology.get('300').set('1', ['200-1']);
  index.world.neighbors.set('200', ['100', '300']);
  index.world.neighbors.set('300', ['200']);
  index.world.cacheWalking.topology.get('200').get('1000001').push('300-1000001');
  index.world.cacheWalking.topology.get('300').get('1000001').push('200-1000001');
  index.nodes.set('Resource cave', { id: 'Resource cave', base: 'Resource cave', kind: 'area', data: { Object: { Ore: 1 } } });
  index.reverse.set('300-1', [{ to: 'Resource cave', via: 'connect', gate: { Tasks: { 'Open resource cave': 'Nonskill' } } }]);
  index.reverse.set('Resource cave', [{ to: '200-2', via: 'connect', gate: true }]);
  index.connectors.push({ label: 'Resource bridge', locations: ['300-1', '200-3'] });
  return index;
}

test('unresolved resource compatibility needs a real entered boundary and cannot seed transit through interiors or connectors', () => {
  const index = compatibilityFixture(), doc = state(['200', '300'], { '200-1': true });
  const saved = JSON.stringify(doc);
  const validTasks = new Set(['Nonskill\u0000Open resource cave', 'Nonskill\u0000Resource bridge']);
  const access = calculateAccess(index, doc, 'm', { validTasks });
  assert(access.compatibilitySections.has('300-1'));
  assert(access.objects.has('Ambiguous tree'));
  assert(access.areas.has('Resource cave'));
  assert(access.objects.has('Ore'));
  assert(!access.sections.has('200-2'));
  assert(!access.sections.has('200-3'));
  assert(!access.components.has('200-1000002'));
  assert(!access.components.has('300-1000002'));
  assert(access.diagnostics.some(value => value.code === 'resource-section-compatibility' && value.location === '300-1'));
  const surface = surfaceReachability(index.world, new Set(doc.members[0].unlocked), doc.members[0].sectionOverrides);
  assert.deepEqual([...access.components].sort(), [...surface].sort());
  assert.equal(JSON.stringify(doc), saved);
  assert(!calculateAccess(index, doc, 'm').areas.has('Resource cave'), 'Named interior task gates still apply');
  assert(!calculateAccess(index, state(['200'], { '200-1': true }), 'm').compatibilitySections.has('300-1'), 'Locked resource bases remain unavailable');
  assert(!calculateAccess(index, state(['200', '300']), 'm').compatibilitySections.has('300-1'), 'Unentered source cycles cannot establish compatibility');
});

test('resource compatibility fails closed for blocked sections, member policy and known unreachable correspondences', () => {
  assert(!calculateAccess(compatibilityFixture(), state(['200', '300'], { '200-1': true, '300-1': false }), 'm').objects.has('Ambiguous tree'));
  const members = compatibilityFixture();
  members.world.sectionMembership.set('300', new Map([['1', false]]));
  assert(!calculateAccess(members, state(['200', '300'], { '200-1': true }, true), 'm').compatibilitySections.has('300-1'));
  assert(!calculateAccess(compatibilityFixture({ mapped: true }), state(['200', '300'], { '200-1': true }), 'm').compatibilitySections.has('300-1'));
  assert(!calculateAccess(compatibilityFixture({ candidates: [2] }), state(['200', '300'], { '200-1': true }), 'm').compatibilitySections.has('300-1'));
});

test('resource compatibility cannot recover a missing positive-cache boundary from retained entry metadata', () => {
  const index = compatibilityFixture();
  index.world.cacheWalking.topology.get('300').get('1000001').length = 0;
  const access = calculateAccess(index, state(['200', '300'], { '200-1': true, '300-1000001': true }), 'm');
  assert(access.components.has('300-1000001'));
  assert(!access.compatibilitySections.has('300-1'));
  assert(!access.objects.has('Ambiguous tree'));
});

test('partner resource compatibility is bounded by its actually admitted canonical components', () => {
  const index = compatibilityFixture(), doc = state(['200'], { '200-1': true });
  const bases = new Set(['200', '300']);
  const admitted = calculateAccess(index, doc, 'm', { validTasks: new Set(['Nonskill\u0000Resource bridge']),
    territory: { bases, sections: new Set(['200-1', '200-1000001', '300-1', '300-1000001']) } });
  assert(admitted.compatibilitySections.has('300-1'));
  assert(admitted.objects.has('Ambiguous tree'));
  assert(!admitted.sections.has('200-3'), 'Carried resource-only selectors cannot become connector origins');
  const denied = calculateAccess(index, doc, 'm', { territory: { bases, sections: new Set(['200-1', '200-1000001']) } });
  assert(!denied.compatibilitySections.has('300-1'));
  assert(!denied.objects.has('Ambiguous tree'));
});

test('resource compatibility preserves explicit entry and source task gates', () => {
  const index = compatibilityFixture(), doc = state(['200', '300'], { '200-1': true });
  index.reverse.get('200-1').push({ to: '300-1', via: 'connect', gate: { Tasks: { 'Permit entry': 'Nonskill' } } });
  index.definitions.taskUnlocks = { Objects: { 'Ambiguous tree': { '300-1': [{ 'Permit harvest': 'Nonskill' }] } } };
  assert(!calculateAccess(index, doc, 'm').compatibilitySections.has('300-1'));
  const entered = calculateAccess(index, doc, 'm', { validTasks: new Set(['Nonskill\u0000Permit entry']) });
  assert(entered.sections.has('300-1'));
  assert(!entered.objects.has('Ambiguous tree'));
  const harvested = calculateAccess(index, doc, 'm', { validTasks: new Set(['Nonskill\u0000Permit entry', 'Nonskill\u0000Permit harvest']) });
  assert(harvested.objects.has('Ambiguous tree'));
});

test('carried resource-only territory aliases cannot seed a known unreachable component on the personal map', () => {
  const index = compatibilityFixture({ mapped: true });
  const access = calculateAccess(index, state(['200', '300'], { '200-1': true }), 'm', {
    territory: { bases: new Set(['200', '300']), sections: new Set(['200-1', '200-1000001', '300-1', '300-1000001']) },
  });
  assert(access.components.has('300-1000001'));
  assert(!access.components.has('300-1000002'));
  assert(!access.compatibilitySections.has('300-1'));
  assert(!access.objects.has('Ambiguous tree'));
});

test('resource compatibility cannot substitute another reached fragment for known source-section candidates', () => {
  const index = compatibilityFixture();
  index.world.cacheWalking.legacyToComponents.delete('200-1');
  index.world.cacheWalking.mapping.push({ legacy: '200-1', components: [], candidates: [2], project: false });
  const access = calculateAccess(index, state(['200', '300'], { '200-1': true, '200-1000001': true }), 'm');
  assert(access.components.has('200-1000001'));
  assert(access.components.has('300-1000001'));
  assert(!access.components.has('200-1000002'));
  assert(!access.compatibilitySections.has('300-1'));
});
