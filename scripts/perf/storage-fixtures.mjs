// Small, public-only schema companions shared by startup measurements/tests.
export const startupCatalogue = [{ id: 'rs3:task:startup-fixture', category: 'Synthetic', label: 'Synthetic objective', rawLabel: 'Synthetic objective', aliases: ['t_synthetic'] }];
export const startupDefinitions = { challenges: { Synthetic: { 'Synthetic objective': {} } } };
export const startupTaskMap = { 'Synthetic objective': 't_synthetic' };
export function startupSchemaFixtures(createGroupState, migrateGameplay) {
  const raw = createGroupState([
    { id: 'synthetic-a', name: 'Synthetic A', sourceMapId: 'map-a', unlocked: ['12341'] },
    { id: 'synthetic-b', name: 'Synthetic B', sourceMapId: 'map-b', unlocked: ['12342'] },
  ]);
  raw.legacy = { maps: Object.fromEntries(raw.members.map(member => [member.sourceMapId, {
    rules: {}, chunkNotes: `Synthetic journal for ${member.id}`, chunks: { stickeredNotes: { '12341': `Synthetic note for ${member.id}` } },
    chunkinfo: { completedChallenges: { Synthetic: { t_synthetic: member.id === 'synthetic-a' } }, manualAreas: { 'Synthetic area': false } },
  }])) };
  const version1 = structuredClone(raw);
  version1.legacy.gameplayMigration = { schemaVersion: 1, unresolved: [], taskStatusProvenance: [] };
  const current = migrateGameplay(raw, { definitions: startupDefinitions, taskMap: startupTaskMap, catalogue: startupCatalogue }).state;
  const version2 = structuredClone(current);
  delete version2.legacy.gameplayMigration.progressAliasesVersion;
  delete version2.legacy.gameplayMigration.journalMigratedMembers;
  delete version2.members[0].journal;
  const singletonStickers = structuredClone(current);
  singletonStickers.members[0].stickers = { '12341': { type: 'star', color: '#123abc', text: 'Synthetic marker' }, '12342': null };
  return [{ name: 'unmigrated', state: raw }, { name: 'gameplay-v1', state: version1 },
    { name: 'gameplay-v2-before-alias-and-journal', state: version2 }, { name: 'current-v2', state: current }, { name: 'current-v2-singleton-stickers', state: singletonStickers }];
}
