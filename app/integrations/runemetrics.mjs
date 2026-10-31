import { validateRuneScapeName, observedSkills } from '../core/game-progress.mjs';
import { canonicalTitle } from './quest-mapping.mjs';
import { previewProgressSnapshot } from './progress-preview.mjs';
import { RUNE_METRICS_SUNSET_AT } from './progress-source-policy.mjs';

export const RUNE_METRICS_SKILLS = observedSkills;
export const RUNE_METRICS_CACHE_MS = 3 * 60 * 1000;
export const RUNE_METRICS_TIMEOUT_MS = 10 * 1000;
export const RUNE_METRICS_USER_AGENT = 'RS3ChunkPicker/0.1 (private duo; on-demand personal progress sync)';

export { createQuestMapping, normalizeQuestTitle, QUEST_TITLE_ALIASES, UNMAPPED_QUEST_REASONS } from './quest-mapping.mjs';

export function normalizeRuneMetricsSnapshot(snapshot) {
  const seen = new Set(snapshot.profile.skillvalues.map(row => row.id));
  return { source: 'runemetrics', sourceLabel: 'RuneMetrics', fetchedAt: snapshot.fetchedAt, cached: snapshot.cached,
    skills: snapshot.profile.skillvalues.map(row => ({ ...row, skill: Number.isSafeInteger(row.id) ? RUNE_METRICS_SKILLS[row.id] : undefined, xp: Number.isSafeInteger(row.xp) && row.xp >= 0 && row.xp <= 2_000_000_000 ? row.xp / 10 : NaN })),
    quests: snapshot.quests.quests,
    unmatchedSkills: RUNE_METRICS_SKILLS.flatMap((skill, id) => seen.has(id) ? [] : [{ id, skill, reason: 'Skill was not returned; saved progress will be kept.' }]) };
}
export function previewRuneMetrics(state, memberId, snapshot, questMapping) {
  return previewProgressSnapshot(state, memberId, normalizeRuneMetricsSnapshot(snapshot), questMapping);
}

function runeMetricsError(code, message, status) { return Object.assign(new Error(message), { code, status }); }
function checkQuestRow(row) {
  if (typeof row.title !== 'string' || !row.title.trim() || !['COMPLETED', 'STARTED', 'NOT_STARTED'].includes(row.status)) {
    throw runeMetricsError('BAD_RESPONSE', 'RuneMetrics returned a quest without a valid title or completion status.', 502);
  }
}
function checkApiError(value, name) {
  if (!value?.error) return;
  const code = String(value.error).toUpperCase();
  if (['PROFILE_PRIVATE', 'PRIVATE_PROFILE', 'PRIVATE'].includes(code)) throw runeMetricsError('PROFILE_PRIVATE', `RuneMetrics profile for ${name} is private. Make the profile public in RuneScape, then try again.`, 422);
  if (['NO_PROFILE', 'NOT_FOUND', 'INVALID_USER', 'USER_NOT_FOUND'].includes(code)) throw runeMetricsError('UNKNOWN_NAME', `RuneMetrics could not find ${name}. Check this player's RuneScape name.`, 404);
  if (['RATE_LIMIT', 'RATE_LIMITED', 'TOO_MANY_REQUESTS'].includes(code)) throw runeMetricsError('RATE_LIMITED', 'RuneMetrics is limiting requests. Wait a few minutes before trying again.', 429);
  throw runeMetricsError('UPSTREAM_ERROR', `RuneMetrics could not return ${name}'s progress (${code.slice(0, 80)}). Try again later.`, 502);
}

/** Async on-demand fetches. A successful paired snapshot is cached per binding;
 * concurrent requests share work. No timer fetches or disk cache are created. */
export function createRuneMetricsClient({ fetchImpl = globalThis.fetch, clock = Date.now,
  cacheMs = RUNE_METRICS_CACHE_MS, timeoutMs = RUNE_METRICS_TIMEOUT_MS } = {}) {
  const cache = new Map(), pending = new Map(), controllers = new Set();
  let retired = false;
  async function endpoint(url, name, signal) {
    const response = await fetchImpl(url, { headers: { 'User-Agent': RUNE_METRICS_USER_AGENT, Accept: 'application/json' }, signal, redirect: 'error' });
    // Missing or gone endpoints signal closure; JSON NO_PROFILE remains an account error.
    if ([404, 410].includes(response.status)) { retired = true; throw runeMetricsError('SOURCE_RETIRED', 'Levels sync from the game plugin now.', 410); }
    if (response.status === 429) throw runeMetricsError('RATE_LIMITED', 'RuneMetrics is limiting requests. Wait a few minutes before trying again.', 429);
    if ([401, 403].includes(response.status)) throw runeMetricsError('PROFILE_PRIVATE', `RuneMetrics denied access to ${name}'s profile. Check profile privacy, then try again.`, 422);
    if (!response.ok) throw runeMetricsError('UPSTREAM_ERROR', `RuneMetrics is unavailable (HTTP ${response.status}). Try again later.`, 502);
    let value;
    try {
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error('Response too large');
      value = JSON.parse(text);
    } catch { throw runeMetricsError('BAD_RESPONSE', 'RuneMetrics returned an unreadable response. Try again later.', 502); }
    checkApiError(value, name);
    return value;
  }
  return {
    async snapshot(member) {
      if (retired || clock() >= RUNE_METRICS_SUNSET_AT) throw runeMetricsError('SOURCE_RETIRED', 'Levels sync from the game plugin now.', 410);
      const name = validateRuneScapeName(member.runescapeName);
      const key = JSON.stringify([member.id, name.toLowerCase()]), cached = cache.get(key);
      if (cached && clock() - cached.savedAt < cacheMs) return { ...structuredClone(cached.snapshot), cached: true };
      if (pending.has(key)) return { ...structuredClone(await pending.get(key)), cached: true };
      const controller = new AbortController(); controllers.add(controller);
      let timeout;
      const operation = (async () => {
        const profileUrl = new URL('https://apps.runescape.com/runemetrics/profile/profile');
        profileUrl.searchParams.set('user', name); profileUrl.searchParams.set('activities', '0');
        const questsUrl = new URL('https://apps.runescape.com/runemetrics/quests'); questsUrl.searchParams.set('user', name);
        const [profile, quests] = await Promise.all([endpoint(profileUrl, name, controller.signal), endpoint(questsUrl, name, controller.signal)]);
        if (retired || clock() >= RUNE_METRICS_SUNSET_AT) throw runeMetricsError('SOURCE_RETIRED', 'Levels sync from the game plugin now.', 410);
        if (!Array.isArray(profile?.skillvalues) || !Array.isArray(quests?.quests) || profile.skillvalues.some(row => !row || typeof row !== 'object') || quests.quests.some(row => !row || typeof row !== 'object')) {
          throw runeMetricsError('BAD_RESPONSE', 'RuneMetrics returned an unexpected profile or quest response.', 502);
        }
        quests.quests.forEach(checkQuestRow);
        const skillIds = new Set(), questTitles = new Set();
        for (const row of profile.skillvalues) if (Number.isSafeInteger(row.id) && RUNE_METRICS_SKILLS[row.id]) {
          if (skillIds.has(row.id)) throw runeMetricsError('BAD_RESPONSE', 'RuneMetrics returned duplicate skill IDs.', 502);
          skillIds.add(row.id);
        }
        for (const row of quests.quests) {
          const title = canonicalTitle(row.title);
          if (questTitles.has(title)) throw runeMetricsError('BAD_RESPONSE', `RuneMetrics returned duplicate quest titles: ${row.title}.`, 502);
          questTitles.add(title);
        }
        if (typeof profile.name !== 'string' || profile.name.toLowerCase().replace(/_/g, ' ') !== name.toLowerCase().replace(/_/g, ' ')) {
          throw runeMetricsError('ACCOUNT_MISMATCH', 'RuneMetrics returned a different account. Check the saved RuneScape name before syncing.', 422);
        }
        return { profile: { name: profile.name, skillvalues: profile.skillvalues.map(({id,level,xp}) => ({id,level,xp})) },
          quests: { quests: quests.quests.map(({title,status}) => ({title,status})) }, fetchedAt: new Date(clock()).toISOString(), cached: false };
      })();
      const deadline = new Promise((resolve, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(runeMetricsError('TIMEOUT', 'RuneMetrics took too long to respond. Try again later.', 504)); }, timeoutMs);
      });
      const request = Promise.race([operation, deadline]); pending.set(key, request);
      try {
        const snapshot = await request;
        cache.set(key, { savedAt: clock(), snapshot });
        while (cache.size > 20) cache.delete(cache.keys().next().value);
        return structuredClone(snapshot);
      } catch (error) {
        if (error.status) throw error;
        throw runeMetricsError('NETWORK_FAILURE', 'Could not reach RuneMetrics. Check the server connection and try again later.', 502);
      } finally { clearTimeout(timeout); controller.abort(); controllers.delete(controller); pending.delete(key); }
    },
    close() { for (const controller of controllers) controller.abort(); cache.clear(); },
  };
}

/** Provider adapter: the raw client remains available for legacy fixture tests. */
export function createRuneMetricsSource(options) {
  const client = createRuneMetricsClient(options);
  return { async snapshot(member) { return normalizeRuneMetricsSnapshot(await client.snapshot(member)); },
    close() { client.close(); } };
}
