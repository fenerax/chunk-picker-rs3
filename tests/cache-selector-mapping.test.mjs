import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { placementWitness, decideSelector, applySelectorEvidence, collectTaskLocationDeclarations } from '../scripts/cache/selector-mapping.mjs';

function region(tiles) {
  const bytes = Buffer.alloc(8192);
  for (const [x, y, label] of tiles) bytes.writeUInt16LE(label, (x * 64 + y) * 2);
  return new Map([['0', { masks: { components: bytes.toString('base64') } }]]);
}

test('decoded footprint uses the complete cardinal perimeter and refuses competing fragments', () => {
  const regions = region([[9, 10, 2], [10, 9, 3], [11, 10, 2], [10, 11, 2], [8, 10, 99]]);
  const witness = placementWitness(regions, { base: '0', x: 10, y: 10 });
  assert.deepEqual(witness.components, ['0:2', '0:3']);
  assert.equal(witness.tiles.length, 4);
  assert.equal(decideSelector([{ conditional: false, witness }], 'decoded').reason, 'footprint-touches-several-components');
  assert.ok(!witness.components.includes('0:99'), 'a larger radius must not search for a convenient component');
});

test('exact walkable anchor identifies its component without snapping to nearby fragments', () => {
  const witness = placementWitness(region([[10, 10, 2], [9, 10, 3]]), { base: '0', x: 10, y: 10 });
  assert.equal(witness.method, 'exact-placement-tile');
  assert.deepEqual(witness.components, ['0:2']);
});

test('an object below a rendered bridge cannot identify the overlying component', () => {
  const regions = region([[10, 10, 2]]);
  const planes = Buffer.alloc(4096);
  planes[10 * 64 + 10] = 1;
  regions.get('0').masks.planes = planes.toString('base64');
  assert.deepEqual(placementWitness(regions, { base: '0', x: 10, y: 10, plane: 0 }).components, []);
});

test('all usable anchors must agree; morph-only and missing coverage stay unresolved', () => {
  const a = { conditional: false, witness: { components: ['0:1'] } };
  const b = { conditional: false, witness: { components: ['0:2'] } };
  assert.equal(decideSelector([a, b], 'decoded').reason, 'exclusive-anchors-disagree');
  assert.deepEqual(decideSelector([{ ...a, conditional: true }], 'decoded').components, []);
  assert.deepEqual(decideSelector([a], 'missing').components, []);
  assert.deepEqual(decideSelector([a, { conditional: false, witness: { components: ['0:1', '0:3'] } }], 'decoded').components, ['0:1'],
    'one common component must witness every anchor, including a complete ambiguous perimeter');
});

test('spatial evidence preserves pre-existing provenance and rejects foreign components', () => {
  const records = [{ legacy: '100-1', components: [], candidates: [2, 3], method: 'unresolved', signature: ['101'] },
    { legacy: '100-2', components: [2], candidates: [2], method: 'unique-boundary-signature', signature: ['101'] }];
  const proof = { legacy: '100-1', reason: 'exclusive-declared-object-spatial-agreement', components: ['100:3'], anchors: [], cohort: 'original-unresolved', foundNames: [] };
  applySelectorEvidence(records, [['100', 0, 0, [[2], [3]]]], { records: [proof] });
  assert.deepEqual(records[0].originalMapping, { components: [], candidates: [2, 3], method: 'unresolved', signature: ['101'] });
  assert.equal(records[1].method, 'unique-boundary-signature');
  assert.throws(() => applySelectorEvidence([{ legacy: '100-1', components: [], candidates: [], method: 'unresolved', signature: [] }],
    [['100', 0, 0, [[3]]]], { records: [{ ...proof, components: ['101:3'] }] }), /Invalid spatial component/);
});

test('task location audit expands declared aliases and preserves exact task provenance', () => {
  const declarations = collectTaskLocationDeclarations({ codeItems: { chunksPlus: { 'Area[+]': ['100-2', 'Nested[+]'], 'Nested[+]': ['200'], 'Cycle[+]': ['Cycle[+]'] } },
    challenges: { Test: { NamedAction: { Chunks: ['Area[+]'] }, Cycle: { Chunks: ['Cycle[+]'] } } } },
  [{ legacy: '100-1' }, { legacy: '100-2' }, { legacy: '200-0' }], (category, label) => `${category}:${label}`);
  assert.equal(declarations.get('100-1').length, 0);
  assert.equal(declarations.get('100-2')[0].rawToken, 'Area[+]');
  assert.equal(declarations.get('100-2')[0].rawLabel, 'NamedAction');
  assert.equal(declarations.get('200-0')[0].expandedLocation, '200');
  assert.equal(declarations.get('200-0')[0].taskId, 'Test:NamedAction');
});

test('complete original unresolved cohort and all accepted witnesses are reviewable', () => {
  const evidenceBytes = fs.readFileSync(new URL('../app/data/cache-selector-evidence.2026-10-07.v1.json', import.meta.url));
  const evidence = JSON.parse(evidenceBytes);
  const policy = JSON.parse(fs.readFileSync(new URL('../app/data/cache-component-policy.2026-10-07.v1.json', import.meta.url)));
  const originals = evidence.records.filter(r => r.cohort === 'original-unresolved');
  assert.equal(originals.length, 453);
  assert.equal(new Set(originals.map(r => r.legacy)).size, 453);
  assert.equal(policy.provenance.selectorEvidenceSha256, sha256RepositoryText(evidenceBytes));
  for (const row of policy.mapping.filter(r => r.method === 'declared-object-spatial-agreement')) {
    const proof = originals.find(r => r.legacy === row.legacy);
    assert.ok(proof?.anchors.length);
    assert.equal(row.originalMapping.method, 'unresolved');
    assert.deepEqual(row.components.map(label => `${row.legacy.split('-')[0]}:${label}`), proof.components);
    for (const anchor of row.evidence.anchors) {
      assert.ok(anchor.witness.components.includes(proof.components[0]));
    }
  }
  assert.equal(policy.mapping.filter(r => r.originalMapping).length, 80);
  assert.deepEqual(policy.mapping.find(r => r.legacy === '13620-2').components, [15]);
  assert.equal(policy.mapping.find(r => r.legacy === '13620-2').resourceUnresolvedReason, 'unlocated-declared-contents-or-entrances');
  assert.ok(policy.mapping.find(r => r.legacy === '13620-2').unlocatedDeclarations.some(d => d.category === 'Connect' && d.names.includes('9043')));
  assert.equal(policy.mapping.find(r => r.legacy === '13361-1').resourceUnresolved, true, 'located workbench cannot locate all Kharid-et NPCs and entrances');
  const alias = policy.mapping.find(r => r.legacy === '12342-3');
  assert.equal(alias.resourceUnresolvedReason, 'unlocated-declared-contents-or-entrances');
  assert.ok(alias.unlocatedDeclarations.some(d => d.category === 'LocationAlias' && d.names.includes('12610')),
    'a raw location-key declaration must not masquerade as an empty certified section');
  for (const legacy of ['13107-4', '12348-2']) {
    const row = policy.mapping.find(r => r.legacy === legacy);
    assert.equal(row.resourceUnresolved, true);
    assert.ok(row.unlocatedDeclarations.some(d => d.category === 'TaskLocation'));
    assert.ok(row.declaredTaskLocations.some(t => t.taskId && t.category && t.rawLabel && t.rawToken));
  }
  for (const legacy of ['13618-1', '13108-2', '13620-1']) {
    const row = policy.mapping.find(r => r.legacy === legacy);
    assert.equal(row.resourceUnresolved, true);
    assert.equal(row.resourceUnresolvedReason, 'declared-object-spatial-conflict');
  }
  assert.equal(policy.mapping.find(r => r.legacy === '12092-5').resourceUnresolvedReason, 'shared-component-resource-aliases');
});
