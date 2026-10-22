// The scenario catalogue is shared by request validation and execution. A future
// score.mjs adapter can consume this plan without introducing another default list.
export const SAVE_SHA256 = '54b3484ca0f0ea5d7c7b791225389f438e3e27b8e25fd0bfc6ca6d94866b4da8';
export const SCENARIOS = Object.freeze({
  cold: { seconds: 25, description: 'fresh server/browser and empty HTTP cache' },
  reload: { seconds: 4, description: 'reload with HTTP and server caches' },
  unlock: { seconds: 10, description: 'panel preparation, click through refreshed task paint' },
  'cold-30mbps': { seconds: 40, description: 'fresh server/browser, 30 Mbps and 40 ms latency' },
  panels: { seconds: 8, description: 'Chunk Info and Possible Tasks content plus two frames' },
  search: { seconds: 3, description: 'query through populated search results plus two frames' },
  'switch-player2': { seconds: 5, description: 'switch to second member' },
  'switch-player1': { seconds: 5, description: 'switch back to first member' },
  // Opt-in only. Each synthetic save/clear can recalculate like an unlock; the
  // personal filter's first non-group view loads both inspection projections.
  'note-save': { seconds: 20, description: 'synthetic chunk note save and clear, click through command acknowledgement and current task paint' },
  'personal-filter': { seconds: 25, description: 'Group duo personal filter changes through painted rows plus two frames; null with Group off' },
});
export const DEFAULT_SCENARIOS = Object.freeze(['cold', 'reload', 'unlock', 'cold-30mbps', 'panels', 'search']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error('Unknown benchmark request field.');
};
const choice = (value, choices, key) => { if (!choices.includes(value)) throw Error(`Invalid ${key}.`); return value; };
const integer = (value, min, max, key) => { if (!Number.isInteger(value) || value < min || value > max) throw Error(`Invalid ${key}.`); return value; };

export function normalizeRequest(request = {}, { requireRevisions = false } = {}) {
  keys(request, ['base', 'candidate', 'scenarios', 'runs', 'options']);
  for (const key of ['base', 'candidate']) {
    if ((requireRevisions || request[key] !== undefined) && !/^[a-f0-9]{40}$/.test(request[key] ?? '')) throw Error(`Invalid ${key} commit.`);
  }
  const scenarios = request.scenarios ?? [...DEFAULT_SCENARIOS];
  if (!Array.isArray(scenarios) || !scenarios.length || new Set(scenarios).size !== scenarios.length || scenarios.some(name => !Object.hasOwn(SCENARIOS, name))) throw Error('Invalid scenarios.');
  const options = request.options ?? {};
  keys(options, ['groupViews', 'unlockMember', 'unlockPick', 'unlockPreview', 'unlockDwellMs', 'settlement', 'timeoutMs', 'screenshots']);
  const groupViews = options.groupViews ?? ['off', 'on'];
  if (!Array.isArray(groupViews) || !groupViews.length || new Set(groupViews).size !== groupViews.length || groupViews.some(view => !['off', 'on'].includes(view))) throw Error('Invalid groupViews.');
  const normalized = { groupViews,
    unlockMember: choice(options.unlockMember ?? 'player1', ['player1', 'player2'], 'unlockMember'),
    unlockPick: choice(options.unlockPick ?? (options.unlockDwellMs > 0 || options.unlockPreview === 'on' ? 'any' : 'unprepared'), ['any', 'prepared', 'unprepared'], 'unlockPick'),
    unlockPreview: choice(options.unlockPreview ?? 'off', ['off', 'on'], 'unlockPreview'),
    unlockDwellMs: integer(options.unlockDwellMs ?? 0, 0, 60000, 'unlockDwellMs'),
    settlement: choice(options.settlement ?? 'tasks', ['tasks', 'idle'], 'settlement'),
    timeoutMs: integer(options.timeoutMs ?? 120000, 1000, 180000, 'timeoutMs'),
    screenshots: options.screenshots ?? false };
  if (typeof normalized.screenshots !== 'boolean') throw Error('Invalid screenshots.');
  if (normalized.unlockPick === 'unprepared' && normalized.unlockPreview !== 'off') throw Error('Unprepared unlock requires Preview off.');
  if (normalized.unlockDwellMs && (normalized.unlockPick !== 'any' || normalized.unlockPreview !== 'off')) throw Error('Dwell requires any pick and Preview off.');
  return { ...(request.base ? { base: request.base, candidate: request.candidate } : {}), scenarios: [...scenarios], runs: integer(request.runs ?? 3, 1, 10, 'runs'), options: normalized };
}

export function measurementPlan(request) {
  const value = normalizeRequest(request);
  const plan = [];
  for (let run = 1; run <= value.runs; run++) for (const groupView of value.options.groupViews) {
    for (const arm of ['A', 'B']) plan.push({ run, arm, groupView, scenarios: value.scenarios });
  }
  return plan;
}

export function estimatedSeconds(request) {
  const value = normalizeRequest(request);
  const normal = value.scenarios.some(name => name !== 'cold-30mbps');
  const seconds = value.scenarios.reduce((sum, name) => sum + SCENARIOS[name].seconds, 0)
    + (normal && !value.scenarios.includes('cold') ? SCENARIOS.cold.seconds : 0);
  // Includes two independent imports and approximate provisioning overhead.
  return 180 + 2 * value.runs * value.options.groupViews.length * seconds;
}
