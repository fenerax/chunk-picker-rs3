export { isObservedProgressSource } from '../core/game-progress.mjs';
import { createPlatformApiClient } from './platform-api.mjs';
export { createOfficialApiSource } from './official-api.mjs';
import { createHiscoresSource } from './hiscores.mjs';
import { canonicalTitle } from './quest-mapping.mjs';
import { previewProgressSnapshot } from './progress-preview.mjs';
import { PLUGIN_PROGRESS_FRESH_MS, PROGRESS_UNAVAILABLE_MESSAGE } from './progress-source-policy.mjs';

export { PROGRESS_UNAVAILABLE_MESSAGE } from './progress-source-policy.mjs';

/** Overlay accepted plugin observations, including persisted personal progress.
 * Each row keeps its original provenance; web data fills only missing fields. */
export function mergePluginProgress(member, web, live) {
  const skills = new Map(), quests = new Map();
  for (const [skill, value] of Object.entries(member.skillProgress ?? {})) if (value.source === 'game-plugin' && value.memberId === member.id) {
    const { level, xp, ...provenance } = value;
    skills.set(skill, { skill, level, xp, provenance });
  }
  for (const [taskId, value] of Object.entries(member.questProgress ?? {})) if (value.source === 'game-plugin' && value.memberId === member.id && member.completedTasks?.includes(taskId)) {
    const { title, ...provenance } = value;
    quests.set(canonicalTitle(title), { title, status: 'COMPLETED', provenance });
  }
  const liveProvenance = row => row.provenance ?? { source: 'game-plugin', fetchedAt: live.fetchedAt, memberId: member.id };
  for (const row of live?.skills ?? []) {
    const provenance = liveProvenance(row);
    if (!skills.has(row.skill) || Date.parse(provenance.fetchedAt) >= Date.parse(skills.get(row.skill).provenance.fetchedAt)) {
      skills.set(row.skill, { ...row, provenance });
    }
  }
  for (const row of live?.quests ?? []) {
    const key = canonicalTitle(row.title), provenance = liveProvenance(row);
    if (!quests.has(key) || Date.parse(provenance.fetchedAt) >= Date.parse(quests.get(key).provenance.fetchedAt)) quests.set(key, { ...row, provenance });
  }
  if (!skills.size && !quests.size && !live) return web;
  const hasWeb = web && web.available !== false;
  const skillRows = new Map((hasWeb ? web.skills : []).map(row => [row.skill, row]));
  const questRows = new Map((hasWeb ? web.quests : []).map(row => [canonicalTitle(row.title), row]));
  for (const [key, row] of skills) skillRows.set(key, row);
  for (const [key, row] of quests) questRows.set(key, row);
  return { ...(hasWeb ? web : { source: 'game-plugin', sourceLabel: 'Game plugin',
    fetchedAt: live?.fetchedAt ?? [...skills.values(), ...quests.values()].map(row => row.provenance.fetchedAt).sort().at(-1), cached: true }),
    ...(hasWeb && web.source !== 'game-plugin' && !web.sourceLabel.endsWith(' + game plugin') ? { sourceLabel: `${web.sourceLabel} + game plugin` } : {}),
    ...(web?.message ? { message: web.message } : {}),
    skills: [...skillRows.values()], quests: [...questRows.values()],
    ...(hasWeb && web.unmatchedSkills ? { unmatchedSkills: web.unmatchedSkills.filter(row => !skills.has(row.skill)) } : {}) };
}

/** Adapter contract: snapshot(member) returns normalized skills (XP, not
 * tenths), quest titles/statuses and fetchedAt, or available:false + message.
 * Providers never write state. Only reviewed commands can save observations. */
export function createProgressSources({ runeMetrics = {}, platformApi = runeMetrics, pluginSnapshot = () => null,
  webSource = 'platform-api', officialApi, hiscores,
  clock = platformApi.clock ?? Date.now } = {}) {
  if (!['runemetrics', 'official-api', 'platform-api'].includes(webSource)) throw new TypeError('Unknown web progress source.');
  // The legacy source/config names remain accepted, but never contact RuneMetrics.
  const platform = createPlatformApiClient({ ...platformApi, clock });
  const fallback = hiscores ?? createHiscoresSource({ clock });
  return {
    async snapshot(member) {
      const plugin = () => mergePluginProgress(member, null, pluginSnapshot(member));
      const overlay = web => mergePluginProgress(member, web, pluginSnapshot(member));
      const unavailable = { available: false, source: 'platform-api', sourceLabel: 'Platform API',
        message: PROGRESS_UNAVAILABLE_MESSAGE };
      if (!member.runescapeName) return plugin() ?? {
        ...unavailable,
        message: 'Connect the game plugin or save this player’s RuneScape name to sync progress.' };
      try {
        const web = await (webSource === 'official-api' ? officialApi ?? platform : platform).snapshot(member);
        if (web.available !== false) return overlay(web);
      } catch { /* Preserve plugin/saved progress when the web service is unavailable. */ }
      // Hiscores is levels-only and is used only without any plugin evidence.
      if (plugin()) return overlay(unavailable);
      try {
        const web = await fallback.snapshot(member);
        if (web.available === false) throw new Error('Hiscores unavailable');
        // Preview and durable Apply guard every web provider against the latest
        // saved state, which may differ from the member used for this fetch.
        return overlay(web);
      } catch {
        return overlay(unavailable);
      }
    },
    close() { platform.close(); officialApi?.close?.(); fallback.close?.(); },
  };
}

export const previewProgress = previewProgressSnapshot;

/** Accepted live reports only. Per-field times prevent position pings or quest
 * updates from making old levels fresh. Applying/dismissing a review doesn't
 * discard source observations. Nothing is persisted. */
export function createPluginProgressSource({ clock = Date.now, freshMs = PLUGIN_PROGRESS_FRESH_MS } = {}) {
  const members = new Map();
  return {
    receive(memberId, report) {
      if (report.world?.beta !== false) { members.delete(memberId); return; }
      if (report.skills === undefined && report.quests === undefined) return;
      const now = clock(), sent = Date.parse(report.sentAt);
      if (!Number.isFinite(sent) || sent > now + 60_000 || now - sent >= freshMs) return;
      const record = members.get(memberId) ?? { skills: new Map() };
      const at = Math.min(now, sent);
      for (const row of report.skills ?? []) if (at >= (record.skills.get(row.skill)?.at ?? -Infinity)) record.skills.set(row.skill, { row, at });
      if (report.quests !== undefined && at >= (record.quests?.at ?? -Infinity)) record.quests = { rows: report.quests, at };
      members.set(memberId, record);
    },
    snapshot(member) {
      const record = members.get(member.id), now = clock();
      if (!record) return null;
      const skills = [...record.skills.values()].filter(value => now - value.at < freshMs);
      const quests = record.quests && now - record.quests.at < freshMs ? record.quests : null;
      if (!skills.length && !quests) { members.delete(member.id); return null; }
      const at = Math.min(...skills.map(value => value.at), ...(quests ? [quests.at] : []));
      return { source: 'game-plugin', sourceLabel: 'Game plugin', fetchedAt: new Date(at).toISOString(), cached: true,
        skills: skills.map(value => ({ ...value.row, provenance: { source: 'game-plugin', fetchedAt: new Date(value.at).toISOString(), memberId: member.id } })), quests: ['finished', 'started'].flatMap(kind => (quests?.rows[kind] ?? [])
          .map(title => ({ title: title.replaceAll('_', ' '), status: kind === 'finished' ? 'COMPLETED' : 'STARTED',
            provenance: { source: 'game-plugin', fetchedAt: new Date(quests.at).toISOString(), memberId: member.id } }))) };
    },
    clear() { members.clear(); },
  };
}
