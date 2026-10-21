import { createGroupState } from '../../app/core/state.mjs';

export const ordinaryRows = [
  { location: '10026', name: 'Copper rock', count: 8, classKeys: ['ore:copper'] },
  { location: '10026', name: 'Tin rock', count: 7, classKeys: ['ore:tin'] },
  { location: '10026', name: 'Forge', count: 1, classKeys: ['facility:forge'] },
  { location: '11317-1', name: 'Fruit tree patch', count: 2, classKeys: ['farming:fruit-tree'] },
  { location: '11572-1', name: 'Crystal tree', count: 3, classKeys: ['tree:crystal'] },
  { location: '11572-1', name: 'Fountain', count: 4, classKeys: ['facility:water-source:fountain'] },
  { location: '11574', name: 'Altar', count: 1, classKeys: ['facility:altar'] },
  { location: '11574', name: 'Camp Fire', count: 2, classKeys: ['facility:cooking-fire:camp-fire'] },
  { location: '11574', name: 'Potato patch', count: 3, classKeys: ['farming:potato'] },
  { location: '11574', name: 'Pottery oven', count: 4, classKeys: ['facility:pottery-oven'] },
  { location: '11574', name: 'Tree patch', count: 5, classKeys: ['farming:tree'] },
];
export const controlRows = [
  { location: '12339', name: 'Synthetic mixed resource', count: 6, classKeys: ['synthetic:first', 'synthetic:second'] },
  { location: '12339', name: 'Synthetic unmapped resource', count: 7, classKeys: [] },
  { location: '12339', name: 'Synthetic disabled resource', count: false, classKeys: ['synthetic:disabled'] },
  { location: '12339', name: 'Yew tree', count: 8, classKeys: ['tree:yew'] },
];
export const archaeologyNames = ['Synthetic remains', 'Synthetic material cache'];
export const outside = '12339-1000001', inside = '12339-1000002';

/** Entirely synthetic inputs; real selector keys and known walking component IDs only. */
export function archaeologyResourceProvenanceFixture({ cacheResources = true, originalProvenance = false } = {}) {
  const bases = ['10026', '11317', '11572', '11574', '12339'];
  const definitions = {
    chunks: Object.fromEntries(bases.map(base => [base, { Nickname: `Synthetic ${base}` }])),
    sections: Object.fromEntries(bases.map(base => [base, { 0: [] }])),
    walkableChunks: [...bases], walkableChunksF2P: [...bases],
    challenges: { Nonskill: {}, Archaeology: {
      'Excavate synthetic remains': { Level: 1, Objects: [archaeologyNames[0]] },
    } },
  };
  for (const row of [...ordinaryRows, ...controlRows]) {
    const [base, section] = row.location.split('-');
    const node = section
      ? ((definitions.chunks[base].Sections ??= {})[section] ??= {})
      : definitions.chunks[base];
    (node.Object ??= {})[row.name] = row.count;
    if (section) definitions.sections[base][section] = [];
    if (originalProvenance) (node.ObjectProvenance ??= {})[row.name] = {
      source: 'retained-only', classKey: row.classKeys[0] ?? 'synthetic:unmapped',
      reason: 'Synthetic original annotation.', evidence: { kind: 'synthetic', location: row.location },
      objectIds: [990001], placements: ['synthetic:original'], components: [], retainedLocations: [row.location],
    };
    definitions.challenges.Nonskill[`Use ${row.name}`] = { Objects: [row.name] };
  }
  definitions.chunks['12339'].Object[archaeologyNames[0]] = 9;
  const coverage = bases.map(base => [base, 'decoded']);
  const resourceSelectors = { mappings: [...ordinaryRows, ...controlRows]
    .filter(row => row.classKeys.length).map(({ name, classKeys }) => ({ name, classKeys: [...classKeys] })) };
  resourceSelectors.mappings.push({ name: 'Oak tree', classKeys: ['tree:oak'] });
  const resourceCatalogue = {
    coverage, provenance: { kind: 'synthetic', fixture: 'ordinary resources' },
    classes: resourceSelectors.mappings.flatMap(row => row.classKeys.map(key => ({ key, name: row.name }))),
    placements: [
      { id: 'synthetic:yew', objectId: 990101, classKey: 'tree:yew', chunkId: '12339', components: [inside], multiplicity: 2 },
      { id: 'synthetic:oak', objectId: 990102, classKey: 'tree:oak', chunkId: '12339', components: [outside], multiplicity: 3 },
    ],
  };
  const archaeologyCatalogue = {
    coverage, provenance: { kind: 'synthetic', fixture: 'archaeology' }, summary: { kind: 'synthetic' },
    classes: [
      { key: 'archaeology:resource:990201', name: archaeologyNames[0], kind: 'excavation-hotspot', members: false, level: 1 },
      { key: 'archaeology:resource:990202', name: archaeologyNames[1], kind: 'material-cache', members: false, level: 1 },
    ],
    mappings: archaeologyNames.map((name, index) => ({ name, classKeys: [`archaeology:resource:${990201 + index}`] })),
    placements: [
      { id: 'synthetic:hotspot', objectId: 990201, classKey: 'archaeology:resource:990201', chunkId: '12339', components: [inside], multiplicity: 2 },
      { id: 'synthetic:material', objectId: 990202, classKey: 'archaeology:resource:990202', chunkId: '12339', components: [outside], multiplicity: 3 },
    ],
  };
  const state = createGroupState([{ id: 'synthetic', name: 'Synthetic', unlocked: bases }]);
  state.rules['content.f2p'] = false;
  state.members[0].sectionOverrides = Object.fromEntries([...bases.map(base => `${base}-0`), '11317-1', '11572-1'].map(id => [id, true]));
  return { definitions, state, options: { cacheWalking: true, cacheResources, resourceCatalogue, resourceSelectors,
    archaeologyCatalogue, metadataCorrections: false, lodestones: [] } };
}
