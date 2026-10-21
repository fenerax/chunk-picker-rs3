import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorld } from '../app/data/world.mjs';
import { MAP_CORRECTIONS } from '../app/data/map-corrections.mjs';
import { evaluateRollPool, reachableSections } from '../app/core/rules.mjs';

const definitions = JSON.parse(await readFile(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
// Verify the retained overlay independently; cache geometry has its own suite.
const world = buildWorld(definitions, { dataset: selectedDataset, cacheWalking: false });
const ids = entries => entries.map(entry => entry.id);

function stateFor(unlocked, sectionOverrides = {}, rules = {}) {
  return {
    rules,
    members: [{ id: 'player1', unlocked, selected: [], pendingRoll: [], blacklisted: [], teleports: [], sectionOverrides }],
  };
}

function isolateDestination(base, section) {
  return Object.fromEntries([...world.sectionTopology.get(base).keys()]
    .filter(part => part !== section).map(part => [`${base}-${part}`, false]));
}

test('authored corrections leave retained definitions unchanged and retain dated source evidence', () => {
  const before = JSON.stringify(definitions);
  const rebuilt = buildWorld(definitions, { dataset: selectedDataset, cacheWalking: false });
  assert.equal(JSON.stringify(definitions), before);
  assert.ok(MAP_CORRECTIONS.length > 0);
  assert.ok(rebuilt.mapCorrections.length > 0);
  for (const correction of MAP_CORRECTIONS) {
    assert.match(correction.chunk, /^[1-9]\d*$/);
    assert.equal(typeof correction.field, 'string');
    assert.ok(Object.hasOwn(correction, 'oldValue'), `${correction.chunk}: previous value must be retained`);
    assert.ok(Object.hasOwn(correction, 'newValue'), `${correction.chunk}: corrected value must be retained`);
    assert.match(correction.evidenceUrl, /^(?:https:\/\/|docs\/research\/)/);
    assert.ok(['high', 'medium-high'].includes(correction.confidence), `${correction.chunk}: unsupported confidence`);
    assert.match(correction.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(rebuilt.mapCorrections.some(applied => JSON.stringify(applied) === JSON.stringify(correction)),
      `${correction.chunk} ${correction.field}: applied provenance must match the authored record`);
    const { chunk, section, field, newValue } = correction;
    if (field === 'walkable' || field === 'f2p') {
      assert.equal(rebuilt[field].has(chunk), newValue, `${chunk} ${field}`);
    } else if (field === 'connections') {
      assert.deepEqual(rebuilt.sectionTopology.get(chunk)?.get(section), newValue, `${chunk}-${section} connections`);
    } else if (field === 'record') {
      assert.equal(rebuilt.chunks.get(chunk)?.name, newValue.Nickname ?? newValue.Name, `${chunk} restored terrain`);
    } else if (field === 'sectionF2p') {
      assert.equal(rebuilt.sectionMembership.get(chunk)?.get(section), newValue, `${chunk}-${section} membership`);
    } else if (field === 'routeKind') {
      assert.equal(rebuilt.sectionRoutes.get(`${chunk}-${section}`)?.get(correction.edge), newValue, `${chunk}-${section} route kind`);
    } else {
      assert.fail(`An applied correction field needs a verification: ${field}`);
    }
  }
  assert.deepEqual(rebuilt.mapCorrections, world.mapCorrections, 'application and evidence are deterministic');
});

for (const id of ['15905', '9772', '12844', '8244', '14902', '15406', '15407']) {
  test(`${id} has walkable members terrain without changing the retained W list`, () => {
    assert.equal(definitions.walkableChunks.map(value => value.trim()).includes(id), false);
    assert.equal(world.walkable.has(id), true);
    assert.equal(world.f2p.has(id), false);
  });
}

for (const id of ['13118', '13374', '13628', '13629', '13630', '9769']) {
  test(`${id} is available as free terrain after its sourced correction`, () => {
    assert.equal(definitions.walkableChunksF2P.map(value => value.trim()).includes(id), false);
    assert.equal(world.f2p.has(id), true);
    assert.equal(world.walkable.has(id), true);
  });
}

test('Harpoon Shore W hygiene removes its F-only diagnostic and 9722 does not become a region', () => {
  assert.equal(world.walkable.has('17456'), true);
  assert.equal(world.f2p.has('17456'), true);
  assert.equal(world.issues.some(issue => issue.code === 'f2p-only-walkable' && issue.id === '17456'), false);
  assert.equal(world.chunks.has('9722'), false);
  assert.equal(world.surface.has('9722'), false);
  assert.equal(world.walkable.has('9722'), false);
});

test('low-confidence coast and ship terrain and unsupported missing records stay unresolved', () => {
  assert.equal(world.walkable.has('8495'), true, 'witnessed cache coast proposal is now applied');
  assert.equal(world.walkable.has('10540'), false);
  for (const id of ['9515', '9771', '12334', '13353', '15149', '6769']) assert.equal(world.chunks.has(id), false, id);
  assert.equal(world.f2p.has('11576'), false, 'the possible free Troll Arena fragment is unresolved');
});

const membership = {
  '17460': { '1': false, '2': true, '3': true },
  '17461': { '1': true, '2': true, '3': true, '4': false, '5': false, '6': false },
  '13622': { '1': true, '2': false },
  '11320': { '1': false, '2': false, '3': true, '4': true, '5': false },
  '11317': { '1': false, '2': true, '3': false, '4': true, '5': true },
  '13620': { '1': false, '2': false, '4': true },
};

for (const [base, sections] of Object.entries(membership)) {
  test(`${base} retains its free base and classifies all mixed destination sections`, () => {
    assert.equal(world.f2p.has(base), true);
    assert.deepEqual(Object.fromEntries(world.sectionMembership.get(base)), sections);
  });
}

const mixedEntries = [
  { base: '17460', memberSection: '1', memberSource: '17716', freeSection: '2', freeSource: '17204' },
  { base: '17461', memberSection: '4', memberSource: '17717-1', freeSection: '1', freeSource: '17462' },
  { base: '13622', memberSection: '2', memberSource: '13623', freeSection: '1', freeSource: '13366-1' },
  { base: '11320', memberSection: '5', memberSource: '11321-1', freeSection: '3', freeSource: '11319-3' },
  { base: '11317', memberSection: '1', memberSource: '11061', freeSection: '4', freeSource: '11573' },
  { base: '13620', memberSection: '1', memberSource: '13621', freeSection: '4', freeSource: '13364' },
];

for (const { base, memberSection, memberSource, freeSection, freeSource } of mixedEntries) {
  test(`${base} rolls only its qualifying free section in F2P mode`, () => {
    const blocked = stateFor([memberSource.split('-')[0]], {
      ...isolateDestination(base, memberSection),
      ...(memberSource.includes('-') ? { [memberSource]: true } : {}),
    });
    const free = stateFor([freeSource.split('-')[0]], {
      ...isolateDestination(base, freeSection),
      ...(freeSource.includes('-') ? { [freeSource]: true } : {}),
    });
    const blockedPool = evaluateRollPool(world, blocked, 'player1');
    assert.equal(ids(blockedPool.eligible).includes(base), false);
    assert.ok(blockedPool.excluded.find(entry => entry.id === base)?.reasons.some(reason => reason.ruleId === 'content.f2p'),
      'the qualifying members component must receive the F2P exclusion');
    const freeEntry = evaluateRollPool(world, free, 'player1').eligible.find(entry => entry.id === base);
    assert.ok(freeEntry, 'the independently reachable free component remains rollable');
    assert.ok(freeEntry.reasons.some(reason => reason.ruleId === 'roll.adjacent' && reason.destinationSection === freeSection));
    blocked.rules['content.f2p'] = false;
    const membersEntry = evaluateRollPool(world, blocked, 'player1').eligible.find(entry => entry.id === base);
    assert.ok(membersEntry, 'the members component remains rollable in members mode');
    assert.ok(membersEntry.reasons.some(reason => reason.destinationSection === memberSection));
  });
}

for (const { base, memberSection, memberSource, freeSection, freeSource } of mixedEntries) {
  test(`${base} frontier offers still require a free component at the owned boundary`, () => {
    const blocked = stateFor([memberSource.split('-')[0]], isolateDestination(base, memberSection), {
      'roll.neighborMode': 'frontier',
    });
    const free = stateFor([freeSource.split('-')[0]], isolateDestination(base, freeSection), {
      'roll.neighborMode': 'frontier',
    });
    const blockedPool = evaluateRollPool(world, blocked, 'player1');
    assert.equal(ids(blockedPool.eligible).includes(base), false);
    assert.ok(blockedPool.excluded.find(entry => entry.id === base)?.reasons.some(reason => reason.ruleId === 'content.f2p'));
    const freeEntry = evaluateRollPool(world, free, 'player1').eligible.find(entry => entry.id === base);
    assert.ok(freeEntry, 'a free component at this same owned boundary remains eligible');
    assert.ok(freeEntry.reasons.some(reason => reason.ruleId === 'roll.adjacent' && reason.destinationSection === freeSection));
    blocked.rules['content.f2p'] = false;
    const membersEntry = evaluateRollPool(world, blocked, 'player1').eligible.find(entry => entry.id === base);
    assert.ok(membersEntry, 'the eastern/members boundary is eligible in members frontier mode');
    assert.ok(membersEntry.reasons.some(reason => reason.destinationSection === memberSection));
  });

  test(`${base} accepts a qualifying free boundary alongside separate members reasons`, () => {
    const sources = [...new Set([memberSource.split('-')[0], freeSource.split('-')[0]])];
    const overrides = Object.fromEntries([memberSource, freeSource].filter(source => source.includes('-'))
      .map(source => [source, true]));
    for (const mode of ['accessible', 'frontier']) {
      const state = stateFor(sources, overrides, { 'roll.neighborMode': mode });
      const entry = evaluateRollPool(world, state, 'player1').eligible.find(candidate => candidate.id === base);
      assert.ok(entry, `${mode}: at least one independently qualifying free component suffices`);
      assert.ok(entry.reasons.some(reason => reason.destinationSection === freeSection), `${mode}: free evidence retained`);
      assert.ok(entry.reasons.some(reason => reason.destinationSection === memberSection), `${mode}: members evidence retained`);
    }
  });

  test(`${base} bare teleport landing needs membership evidence while explicit selection still bypasses it`, () => {
    // Isolate membership evidence from the independent one-way return gate.
    const home = [...world.f2p].find(id => id !== base && world.sectionTopology.get(id)?.has('0'));
    assert.ok(home);
    const state = stateFor([home], {}, { 'roll.adjacent': false });
    state.members[0].teleports.push({ id: 'home', destination: home, available: true, consumable: false });
    state.members[0].teleports.push({ id: `landing-${base}`, destination: base, available: true, consumable: false });
    const pool = evaluateRollPool(world, state, 'player1');
    assert.equal(ids(pool.eligible).includes(base), false);
    const excluded = pool.excluded.find(candidate => candidate.id === base);
    assert.ok(excluded?.reasons.some(reason => reason.ruleId === 'roll.teleports'));
    assert.ok(excluded?.reasons.some(reason => reason.ruleId === 'content.f2p'));
    state.rules['content.f2p'] = false;
    assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes(base));
    state.rules['content.f2p'] = true;
    state.members[0].selected.push(base);
    const selected = evaluateRollPool(world, state, 'player1').eligible.find(candidate => candidate.id === base);
    assert.ok(selected?.reasons.some(reason => reason.ruleId === 'roll.selected'));
  });
}

test('frontier cannot infer free Havenhythe landing from destination sections explicitly blocked by the player', () => {
  const state = stateFor(['17204'], { '17460-2': false, '17460-3': false }, { 'roll.neighborMode': 'frontier' });
  const pool = evaluateRollPool(world, state, 'player1');
  assert.equal(ids(pool.eligible).includes('17460'), false);
  assert.ok(pool.excluded.find(entry => entry.id === '17460')?.reasons.some(reason => reason.ruleId === 'content.f2p'));
});

for (const [section, source] of [['5', '17717-1'], ['6', '17460-1']]) {
  test(`Havenhythe waterfall east section ${section} remains outside F2P generated rolls`, () => {
    const state = stateFor([source.split('-')[0]], {
      ...isolateDestination('17461', section), [source]: true,
    });
    assert.equal(ids(evaluateRollPool(world, state, 'player1').eligible).includes('17461'), false);
    state.rules['content.f2p'] = false;
    assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes('17461'));
  });
}

test('unverified Nature Grotto section 3 fails closed in F2P without claiming it is members terrain', () => {
  assert.equal(world.sectionMembership.get('13620').has('3'), false);
  const state = stateFor(['13619'], {
    ...isolateDestination('13620', '3'), '13619-1': true,
  });
  assert.equal(ids(evaluateRollPool(world, state, 'player1').eligible).includes('13620'), false);
  state.rules['content.f2p'] = false;
  assert.ok(ids(evaluateRollPool(world, state, 'player1').eligible).includes('13620'));
});

const nonlocalEdges = [
  ['8752-2', '9009-1'], ['9532-3', '9275'], ['10029-0', '10286'],
  ['10030-0', '10287-2'], ['10287-2', '10030'], ['10545-0', '10290'],
  ['12082-1', '11825-2'], ['12082-1', '16179-2'], ['12329-4', '13097-2'],
  ['12857-0', '12602'], ['13097-2', '12329-4'], ['14386-3', '14131'],
  ['16179-2', '12082-1'],
];

for (const [destinationSection, remoteSource] of nonlocalEdges) {
  test(`${destinationSection} → ${remoteSource} is classified and cannot supply a walking roll`, () => {
    const [destination, part] = destinationSection.split('-');
    const source = remoteSource.split('-')[0];
    const kind = world.sectionRoutes.get(destinationSection)?.get(remoteSource);
    assert.ok(kind && kind !== 'walking', 'the audit edge must carry a nonwalking classification');
    assert.equal(world.neighbors.get(destination).includes(source), false, 'the listed dependency is nonlocal');
    const decoy = world.neighbors.get(destination).find(id => id !== source);
    assert.ok(decoy, 'an orthogonal owned neighbor exposes the old unrelated-source leak');
    const isolatedWorld = {
      ...world,
      sectionTopology: new Map([
        [destination, new Map([[part, [remoteSource]]])],
        [source, new Map([[remoteSource.split('-')[1] ?? '0', []]])],
        [decoy, new Map([['0', []]])],
      ]),
    };
    const state = stateFor([source, decoy], remoteSource.includes('-') ? { [remoteSource]: true } : {}, { 'content.f2p': false });
    const pool = evaluateRollPool(isolatedWorld, state, 'player1');
    assert.equal(ids(pool.eligible).includes(destination), false);
    assert.equal(ids(pool.excluded).includes(destination), false, 'a transport/invalid dependency must not generate a walking candidate at all');
  });
}

const correctedEdges = [
  ['9532-3', '9275', '9531-2'],
  ['10029-0', '10286', '10285'],
  ['10545-0', '10290', '10289'],
  ['12857-0', '12602', '12601'],
  ['14386-3', '14131', '14130-1'],
];

for (const [destinationSection, oldSource, correctedSource] of correctedEdges) {
  test(`${destinationSection} typo repairs walking access to reciprocal ${correctedSource}`, () => {
    const [destination, part] = destinationSection.split('-');
    const source = correctedSource.split('-')[0];
    const edges = world.sectionTopology.get(destination).get(part);
    assert.equal(edges.includes(oldSource), false);
    assert.ok(edges.includes(correctedSource));
    assert.ok(world.neighbors.get(destination).includes(source));
    assert.equal(world.sectionRoutes.get(destinationSection).get(oldSource), 'typo');
    const inward = stateFor([source], {
      ...isolateDestination(destination, part),
      ...(correctedSource.includes('-') ? { [correctedSource]: true } : {}),
    }, { 'content.f2p': false });
    const entry = evaluateRollPool(world, inward, 'player1').eligible.find(candidate => candidate.id === destination);
    assert.ok(entry?.reasons.some(reason => reason.ruleId === 'roll.adjacent' && reason.destinationSection === part));
    const outward = stateFor([destination], part === '0' ? {} : { [destinationSection]: true }, { 'content.f2p': false });
    assert.ok(ids(evaluateRollPool(world, outward, 'player1').eligible).includes(source), 'the existing reciprocal remains usable');
  });
}

test('unconfirmed Port Sarim/Havenhythe transport does not join owned walking sections', () => {
  const fromPort = stateFor(['12082', '16179'], { '12082-1': true }, { 'content.f2p': false });
  assert.equal(reachableSections(world, fromPort, 'player1').includes('16179-2'), false);
  const fromHavenhythe = stateFor(['12082', '16179'], { '16179-2': true }, { 'content.f2p': false });
  assert.equal(reachableSections(world, fromHavenhythe, 'player1').includes('12082-1'), false);
});

test('Daemonheim coast restoration uses retained terrain and reciprocal boundaries', () => {
  assert.equal(definitions.chunks['13883'], undefined, 'the archival missing record remains untouched');
  assert.equal(world.chunks.has('13883'), true);
  assert.equal(world.walkable.has('13883'), true);
  assert.equal(world.f2p.has('13883'), true);
  assert.deepEqual(world.sectionTopology.get('13883').get('0'), ['13882-2', '13627']);
  assert.ok(world.sectionTopology.get('13882').get('2').includes('13883'));
  assert.ok(world.sectionTopology.get('13627').get('0').includes('13883'));
  assert.ok(ids(evaluateRollPool(world, stateFor(['13627']), 'player1').eligible).includes('13883'));
  assert.ok(ids(evaluateRollPool(world, stateFor(['13882'], { '13882-2': true }), 'player1').eligible).includes('13883'));
  const outward = ids(evaluateRollPool(world, stateFor(['13883']), 'player1').eligible);
  assert.ok(outward.includes('13627'));
  assert.ok(outward.includes('13882'));
});

test('Crandor fragment returns to North Crandor without joining the Fishing Platform', () => {
  assert.ok(world.sectionTopology.get('11315').get('0').includes('11059-2'));
  assert.deepEqual(world.sectionTopology.get('11059').get('1'), []);
  assert.deepEqual(world.sectionTopology.get('11059').get('2'), ['11315']);
  const fromIsland = evaluateRollPool(world, stateFor(['11315'], {}, { 'content.f2p': false }), 'player1');
  const fragment = fromIsland.eligible.find(entry => entry.id === '11059');
  assert.ok(fragment?.reasons.some(reason => reason.destinationSection === '2'));
  const fragmentState = stateFor(['11059'], { '11059-2': true }, { 'content.f2p': false });
  assert.ok(ids(evaluateRollPool(world, fragmentState, 'player1').eligible).includes('11315'));
  const platformState = stateFor(['11059'], { '11059-1': true }, { 'content.f2p': false });
  assert.equal(ids(evaluateRollPool(world, platformState, 'player1').eligible).includes('11315'), false);
  assert.equal(ids(evaluateRollPool(world, stateFor(['11315']), 'player1').eligible).includes('11059'), false);
  const owned = stateFor(['11059', '11315'], { '11059-2': true }, { 'content.f2p': false });
  assert.deepEqual(reachableSections(world, owned, 'player1').filter(id => id.startsWith('11059-')), ['11059-2']);
});

test('volcano coast has its return boundary and the northwest edge typo is repaired', () => {
  assert.ok(world.sectionTopology.get('13629').get('0').includes('13628'));
  assert.ok(world.sectionTopology.get('13628').get('0').includes('13629'));
  assert.ok(world.sectionTopology.get('13374').get('2').includes('13118-2'));
  assert.equal(world.sectionTopology.get('13374').get('2').includes('13318-2'), false);
  assert.ok(ids(evaluateRollPool(world, stateFor(['13628']), 'player1').eligible).includes('13629'));
  assert.ok(ids(evaluateRollPool(world, stateFor(['13629']), 'player1').eligible).includes('13628'));
  assert.ok(ids(evaluateRollPool(world, stateFor(['13118'], { '13118-2': true }), 'player1').eligible).includes('13374'));
  assert.ok(ids(evaluateRollPool(world, stateFor(['13374'], { '13374-2': true }), 'player1').eligible).includes('13118'));
});

test('the tiny Mudskipper Corner is still a free walking roll', () => {
  const entry = evaluateRollPool(world, stateFor(['11824']), 'player1').eligible.find(candidate => candidate.id === '12080');
  assert.ok(entry);
  assert.ok(entry.reasons.some(reason => reason.ruleId === 'roll.adjacent' && reason.destinationSection === '0'));
});

test('Musa mainland entry does not open island or volcano sections', () => {
  const mainland = stateFor(['11825'], { '11825-1': true });
  const musa = evaluateRollPool(world, mainland, 'player1').eligible.find(entry => entry.id === '11569');
  assert.ok(musa?.reasons.some(reason => reason.destinationSection === '2'));
  mainland.members[0].unlocked.push('11569');
  assert.deepEqual(reachableSections(world, mainland, 'player1').filter(id => id.startsWith('11569-')), ['11569-2']);
  assert.equal(ids(evaluateRollPool(world, mainland, 'player1').eligible).includes('11313'), false);
  const island = stateFor(['11569'], { '11569-1': true });
  assert.ok(ids(evaluateRollPool(world, island, 'player1').eligible).includes('11313'));
  const volcano = stateFor(['11313', '11314']);
  assert.deepEqual(reachableSections(world, volcano, 'player1').filter(id => id.startsWith('11314-')), ['11314-3']);
  assert.equal(ids(evaluateRollPool(world, volcano, 'player1').eligible).includes('11315'), false);
});
