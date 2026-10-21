// Invented daily totals for registered windows; no saved usage data is read.
export const galleryUsageTime = '2026-10-13T12:00:00.000Z';
const windows = [
  'settings', 'rules', 'history', 'backup', 'teleports', 'search', 'overlays',
  'feedback', 'about', 'news', 'roadmap', 'invites', 'original-sync', 'profile',
  'activity', 'bis', 'runemetrics:standalone', 'journal', 'members',
  'sandbox:rules', 'area', 'xp', 'roll:confirm', 'roll:new-tasks', 'roll:forfeit',
  'roll:stats', 'finish', 'partner', 'tasks:custom', 'tasks:detail',
  'tasks:item-detail', 'tasks:completed', 'stickers:full', 'dialog:starting-marker',
  'dialog:download-map', 'usage',
];

export function createGalleryUsageFixture(empty = false) {
  const counts = empty ? [] : ['player1', 'player2', 'unlinked', 'viewer'].flatMap((actor, person) =>
    windows.slice(0, person < 2 ? windows.length : 8).flatMap((id, index) => [
      { id, actor, device: 'desktop', day: '2026-10-13', count: (windows.length - index) * (person + 1) + 3 },
      { id, actor, device: 'phone', day: '2026-10-10', count: (index % 7 + 1) * (person + 2) },
      { id, actor, device: 'desktop', day: '2026-09-28', count: index % 5 + 1 },
    ]));
  return { schemaVersion: 1, counts };
}
