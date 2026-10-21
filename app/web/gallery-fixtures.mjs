import { datasetJSON } from '../dataset-runtime.mjs';
const fixtureData = await datasetJSON('app/web/gallery-fixture-data.json');
import { hydrateDisplayWorld } from '../display-world.mjs';
import { createRuleRegistryFromDefinitions } from '../core/rule-registry.mjs';
import { createGalleryUsageFixture } from './gallery-usage-fixture.mjs';

export function createGalleryFixtures(deny, { usageEmpty = false } = {}) {
  const data = structuredClone(fixtureData), state = data.state;
  const resultFor = id => data.results.find(result => result.memberId === id) ?? data.results[0];
  const range = { minLevel: 1, maxLevel: 15, methodCount: 2, reachableLevel: 15, entrySpans: [], bootstrapGap: null, repeatability: 'engine-primary', methods: [{ level: 1, label: 'Cut trees', blockers: [] }, { level: 15, label: 'Cut oak trees', blockers: [] }] };
  const metrics = { unlockedChunks: 1, completedTasks: 1, questPoints: 1, totalLevel: 85, combatLevel: 3 };
  const current = { members: state.members.map(member => ({ memberId: member.id, name: member.name, metrics })), duo: { metrics: { ...metrics, unlockedChunks: 2 } } };
  const responses = {
    '/api/session': { admin: true, readOnly: false, capabilities: { canWrite: true }, kind: 'master', label: 'Gallery' },
    '/api/usage': createGalleryUsageFixture(usageEmpty),
    '/api/overlays': { links: [], widgets: ['tasks', 'map', 'summary'] },
    '/api/invites': { invites: [] },
    '/api/feedback': { items: [] }, '/api/feedback/own': { items: [] },
    '/api/feedback/summary': { unread: 0, open: 0 },
    '/api/changelog': { entries: [{ id: 'gallery', date: '2026-10-13', title: 'Example picker update', items: ['A sample update for visual review.', 'No saved data is used here.'] }] },
    '/api/roadmap': { groups: [], items: [] },
    '/api/migration': { converted: 6, unmatched: ['Example source with no matching task'] },
    '/api/members-start': { data: data.membersBanks },
    '/api/game-plugin': { keys: [], positions: [], active: false }, '/api/game-plugin/review': { preview: null },
    '/api/backup-status': { available: false, status: 'missing' },
    '/api/original-sync/status': { available: false },
    '/api/original-sync/preview': { currentRevision: 7, capturedAt: '2026-10-13T12:00:00.000Z', expiresAt: '2026-10-13T12:30:00.000Z', previewId: 'gallery-preview', warnings: ['Built-in sample; no original-picker request was sent.'],
      members: state.members.map(member => ({ id: member.id, name: member.name, sourceMapId: member.id === 'player1' ? 'qxa' : 'qxb', lastSynced: null,
        chunks: { unlock: ['12343'], lock: [], keepLocal: [] }, selections: { add: [], remove: [], before: [], after: [], orderChanged: false }, blacklist: { add: [], remove: [] }, pendingRoll: { before: [], after: [], changed: false }, rules: [], tasks: { complete: [], backlogAdd: [] } })) },
    '/api/training-catalogue': { skills: [{ skill: 'Woodcutting', f2pCap: 99, methods: [] }, { skill: 'Mining', f2pCap: 99, methods: [] }] },
    '/api/helper-drops': { memberId: 'player1', stateRevision: 7, f2p: true, drops: [{ monster: 'Goblin', item: 'Bones', denominator: 1, rate: 'Always' }] },
    '/api/pool-ranking': { stateRevision: 7, memberId: 'player1', rows: [{ id: '12342', status: 'checked', count: 3, bySkill: { Woodcutting: { count: 3 } }, examples: [] }, { id: '12343', status: 'pending' }], checked: 1, total: 2 },
    '/api/helper-progress': { stateRevision: 7, generatedAt: '2026-10-13T12:00:00.000Z', current, history: { points: [] }, daily: { points: [] }, limitations: ['Synthetic gallery progress.'] },
    '/api/area-check': { memberId: 'player1', stateRevision: 7, members: false, chunkIds: ['12341'], rows: [{ skill: 'Woodcutting', alone: range, combined: range }], limitations: ['Synthetic fixture; no gameplay calculation.'] },
    '/api/roll-stats': data.rollStats,
    '/api/history': { stateRevision: 7, history: state.history, hasMore: false, nextBefore: null },
    '/api/backup/list': { backups: [] }, '/api/backups': { backups: [] },
    '/api/map/interiors': { maps: [], available: false },
    '/api/interior-maps': { areas: [], maps: [], available: false },
  };
  let pending = 0;
  const errors = [];
  async function api(route, body) {
    const url = new URL(route, 'http://gallery.invalid'), id = url.searchParams.get('memberId') ?? 'player1';
    if (body !== undefined && url.pathname !== '/api/original-sync/preview') return deny();
    pending++;
    try {
      if (url.pathname === '/api/tasks') return structuredClone(resultFor(id));
      if (url.pathname === '/api/xp-choices') return { memberId: id, stateRevision: 7, f2p: true, rows: [{ id: 'gallery-lamp', label: 'Example XP lamp', source: 'unset', availableInMode: true, slots: [{ index: 0, amount: 500, skills: ['Mining', 'Woodcutting', 'Smithing'], selection: null }] }] };
      if (url.pathname === '/api/teleports') return { memberId: id, stateRevision: 7, automatic: false, rows: [] };
      if (url.pathname.startsWith('/api/history/')) return { stateRevision: 7, event: state.history[0] };
      if (!Object.hasOwn(responses, url.pathname)) { errors.push(`Missing fixture: ${url.pathname}`); throw new Error(errors.at(-1)); }
      return structuredClone(responses[url.pathname]);
    } finally { pending--; }
  }
  return { state, definitions: data.definitions, registry: createRuleRegistryFromDefinitions(data.rules), world: hydrateDisplayWorld(data.world), result: resultFor('player1'), resultFor, api, errors, pending: () => pending };
}
