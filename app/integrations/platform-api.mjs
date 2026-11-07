import { validateRuneScapeName, sameRuneScapeName, observedSkills } from '../core/game-progress.mjs';
import { canonicalTitle } from './quest-mapping.mjs';
import { readProgressResponse } from './bounded-response.mjs';

const PLATFORM_API_SKILLS = observedSkills;
const PLATFORM_API_CACHE_MS = 3 * 60 * 1000;
const PLATFORM_API_TIMEOUT_MS = 10 * 1000;
const PLATFORM_API_USER_AGENT = 'RS3ChunkPicker/0.1 (on-demand personal progress sync)';
export const PLATFORM_API_SOURCE = 'platform-api';
const HISCORES_SKILL_NAMES = Object.freeze({ Hitpoints: 'Constitution', Runecraft: 'Runecrafting' });

function platformApiError(code, message, status) { return Object.assign(new Error(message), { code, status }); }
function checkQuestRow(row) {
  if (typeof row.title !== 'string' || !row.title.trim() || !['COMPLETED', 'STARTED', 'NOT_STARTED'].includes(row.status)) {
    throw platformApiError('BAD_RESPONSE', 'Platform API returned a quest without a valid title or completion status.', 502);
  }
}
function checkApiError(value, name) {
  if (!value?.error) return;
  const code = String(value.error).toUpperCase();
  if (['PROFILE_PRIVATE', 'PRIVATE_PROFILE', 'PRIVATE'].includes(code)) throw platformApiError('PROFILE_PRIVATE', `Platform API denied access to ${name}'s progress. Check the account's visibility.`, 422);
  if (['PLAYER_NOT_FOUND', 'NO_PROFILE', 'NOT_FOUND', 'INVALID_USER', 'USER_NOT_FOUND'].includes(code)) throw platformApiError('UNKNOWN_NAME', `Platform API could not find ${name}, or the account is hidden. Check this player's RuneScape name and visibility.`, 404);
  if (code === 'PLAYER_NOT_MEMBER') throw platformApiError('MEMBERS_REQUIRED', 'This Platform API endpoint requires an active membership.', 422);
  if (['RATE_LIMIT', 'RATE_LIMITED', 'TOO_MANY_REQUESTS'].includes(code)) throw platformApiError('RATE_LIMITED', 'Platform API is limiting requests. Wait a few minutes before trying again.', 429);
  throw platformApiError('UPSTREAM_ERROR', `Platform API could not return ${name}'s progress (${code.slice(0, 80)}). Try again later.`, 502);
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function normalizePlatformSnapshot(profile, quests, name) {
  if (!object(profile) || !Array.isArray(profile.skills) || !object(quests) || !object(quests.quests)
    || profile.skills.some(row => !object(row))) {
    throw platformApiError('BAD_RESPONSE', 'Platform API returned an unexpected Hiscores or quest response.', 502);
  }
  // Hiscores echoes the query; Player Quests independently returns the canonical name.
  if (!sameRuneScapeName(profile.name, name) || !sameRuneScapeName(quests.name, name)) {
    throw platformApiError('ACCOUNT_MISMATCH', 'Platform API returned a different account. Check the saved RuneScape name before syncing.', 422);
  }
  if (!Number.isSafeInteger(quests.qp) || !Number.isSafeInteger(quests.qp_max) || quests.qp < 0 || quests.qp_max < quests.qp) {
    throw platformApiError('BAD_RESPONSE', 'Platform API returned invalid quest-point totals.', 502);
  }
  const seen = new Set(), skills = [];
  for (const row of profile.skills) {
    if (seen.has(row.id)) throw platformApiError('BAD_RESPONSE', 'Platform API returned duplicate skill IDs.', 502);
    seen.add(row.id);
    if (row.id === 0 && row.name === 'Overall') continue;
    const skill = Number.isSafeInteger(row.id) && row.id > 0 ? PLATFORM_API_SKILLS[row.id - 1] : undefined;
    if (skill && (HISCORES_SKILL_NAMES[row.name] ?? row.name) !== skill) throw platformApiError('BAD_RESPONSE', 'Platform API skill names and IDs disagree. No progress was saved.', 502);
    // rank -1 can still have valid level/XP. Historical level/XP -1 remains
    // unknown and is reported by the preview rather than becoming a zero.
    skills.push({ id: row.id, name: row.name, skill, level: row.level, xp: row.xp });
  }
  const titles = new Set(), questRows = [];
  for (const [id, row] of Object.entries(quests.quests)) {
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || !object(row)) throw platformApiError('BAD_RESPONSE', 'Platform API returned an invalid quest record.', 502);
    checkQuestRow(row);
    const title = canonicalTitle(row.title);
    if (titles.has(title)) throw platformApiError('BAD_RESPONSE', `Platform API returned duplicate quest titles: ${row.title}.`, 502);
    titles.add(title);
    questRows.push({ id: Number(id), title: row.title, status: row.status });
  }
  return { source: PLATFORM_API_SOURCE, sourceLabel: 'Platform API', skills, quests: questRows,
    unmatchedSkills: PLATFORM_API_SKILLS.flatMap((skill, id) => seen.has(id + 1) ? [] : [{ id: id + 1, skill, reason: 'Skill was not returned; saved progress will be kept.' }]), questPoints: { current: quests.qp, max: quests.qp_max } };
}

export function createPlatformApiClient({ fetchImpl = globalThis.fetch, clock = Date.now,
  cacheMs = PLATFORM_API_CACHE_MS, timeoutMs = PLATFORM_API_TIMEOUT_MS, timers = { setTimeout, clearTimeout } } = {}) {
  const cache = new Map(), pending = new Map(), controllers = new Set();
  async function endpoint(url, name, signal) {
    const response = await fetchImpl(url, { headers: { 'User-Agent': PLATFORM_API_USER_AGENT, Accept: 'application/json' }, signal, redirect: 'error' });
    if (response.status === 429) throw platformApiError('RATE_LIMITED', 'Platform API is limiting requests. Wait a few minutes before trying again.', 429);
    if ([401, 403].includes(response.status)) throw platformApiError('PROFILE_PRIVATE', `Platform API denied access to ${name}'s progress. Check account visibility, then try again.`, 422);
    let value;
    try {
      value = JSON.parse(await readProgressResponse(response));
    } catch {
      if (response.status === 404) throw platformApiError('UNKNOWN_NAME', `Platform API could not find ${name}, or the account is hidden. Check the RuneScape name and visibility.`, 404);
      if (!response.ok) throw platformApiError('UPSTREAM_ERROR', `Platform API is unavailable (HTTP ${response.status}). Try again later.`, 502);
      throw platformApiError('BAD_RESPONSE', 'Platform API returned an unreadable response. Try again later.', 502);
    }
    checkApiError(value, name);
    if (response.status === 404) throw platformApiError('UNKNOWN_NAME', `Platform API could not find ${name}, or the account is hidden. Check the RuneScape name and visibility.`, 404);
    if (!response.ok) throw platformApiError('UPSTREAM_ERROR', `Platform API is unavailable (HTTP ${response.status}). Try again later.`, 502);
    return value;
  }
  return {
    async snapshot(member) {
      const name = validateRuneScapeName(member.runescapeName);
      const key = JSON.stringify([member.id, name.toLowerCase()]), cached = cache.get(key);
      if (cached && clock() - cached.savedAt < cacheMs) return { ...structuredClone(cached.snapshot), cached: true };
      if (pending.has(key)) return { ...structuredClone(await pending.get(key)), cached: true };
      const controller = new AbortController(); controllers.add(controller);
      let timeout;
      const operation = (async () => {
        // Main RS3 Hiscores includes Group Ironmen; hiscore_ironman does not.
        const profileUrl = new URL('https://secure.runescape.com/m=hiscore/index_lite.json');
        profileUrl.searchParams.set('player', name);
        const questsUrl = new URL(`https://secure.runescape.com/m=adventurers-log/api/v1/playerQuests/${encodeURIComponent(name)}`);
        const [profile, quests] = await Promise.all([endpoint(profileUrl, name, controller.signal), endpoint(questsUrl, name, controller.signal)]);
        return { ...normalizePlatformSnapshot(profile, quests, name), fetchedAt: new Date(clock()).toISOString(), cached: false };
      })();
      const deadline = new Promise((resolve, reject) => {
        timeout = timers.setTimeout(() => { controller.abort(); reject(platformApiError('TIMEOUT', 'Platform API took too long to respond. Try again later.', 504)); }, timeoutMs);
      });
      const request = Promise.race([operation, deadline]); pending.set(key, request);
      try {
        const snapshot = await request;
        cache.set(key, { savedAt: clock(), snapshot });
        while (cache.size > 20) cache.delete(cache.keys().next().value);
        return structuredClone(snapshot);
      } catch (error) {
        if (error.status) throw error;
        throw platformApiError('NETWORK_FAILURE', 'Could not reach Platform API. Check the server connection and try again later.', 502);
      } finally { timers.clearTimeout(timeout); controller.abort(); controllers.delete(controller); pending.delete(key); }
    },
    close() { for (const controller of controllers) controller.abort(); cache.clear(); },
  };
}
