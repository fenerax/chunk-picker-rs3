// Shared public gameplay allowlist. Never read the map root (it can hold PINs).
export const PUBLIC_FIREBASE_URL = 'https://chunkpickerrs3.firebaseio.com';
export const PUBLIC_GAMEPLAY_FIELDS = Object.freeze([
  'rules', 'chunkOrder', 'settings', 'chunkinfo', 'chunks', 'activeSubTabs',
  'topbarSelection', 'manualPrimary', 'recentFancyRollTime', 'recent', 'recentTime',
  'randomLoot', 'chunkNotes', 'userTasks', 'friends', 'friendsAlt',
]);
