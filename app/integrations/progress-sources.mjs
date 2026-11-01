import { progressBelongsToMember } from '../core/game-progress.mjs';
import { createRuneMetricsSource } from './runemetrics.mjs';
import { createOfficialApiSource } from './official-api.mjs';
export { createOfficialApiSource } from './official-api.mjs';
import { createHiscoresSource } from './hiscores.mjs';
import { canonicalTitle } from './quest-mapping.mjs';
import { previewProgressSnapshot } from './progress-preview.mjs';
import { PLUGIN_PROGRESS_FRESH_MS, RUNE_METRICS_CLOSED_MESSAGE } from './progress-source-policy.mjs';

export { RUNE_METRICS_CLOSED_MESSAGE } from './progress-source-policy.mjs';

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
export function createProgressSources({ runeMetrics = {}, pluginSnapshot = () => null,
  webSource = 'runemetrics', officialApi = createOfficialApiSource(), hiscores,
  runeMetricsEnabled = () => process.env.RS3_RUNEMETRICS_ENABLED !== '0',
  clock = runeMetrics.clock ?? Date.now } = {}) {
  if (!['runemetrics', 'official-api'].includes(webSource)) throw new TypeError('Unknown web progress source.');
  const legacy = createRuneMetricsSource({ ...runeMetrics, clock });
  const fallback = hiscores ?? createHiscoresSource({ clock });
  let retired = false;
  const enabled = () => typeof runeMetricsEnabled === 'function' ? runeMetricsEnabled() : runeMetricsEnabled;
  return {
    async snapshot(member) {
      const plugin = () => mergePluginProgress(member, null, pluginSnapshot(member));
      const overlay = web => mergePluginProgress(member, web, pluginSnapshot(member));
      let failure, closed = retired || !enabled();
      const unavailable = { available: false, source: 'runemetrics', sourceLabel: 'RuneMetrics',
        message: RUNE_METRICS_CLOSED_MESSAGE };
      if (!member.runescapeName) return closed ? overlay(unavailable) : plugin() ?? {
        available: false, source: 'runemetrics', sourceLabel: 'RuneMetrics',
        message: 'Connect the game plugin or save this player’s RuneScape name to sync progress.' };
      if (webSource === 'official-api') return overlay(await officialApi.snapshot(member));
      if (!closed) {
        try {
          const web = await legacy.snapshot(member);
          if (enabled()) return overlay(web); // Recheck a switch changed during a fetch.
          closed = true;
        } catch (error) {
          failure = error;
          closed = ['SOURCE_RETIRED', 'NETWORK_FAILURE'].includes(error.code);
          if (error.code === 'SOURCE_RETIRED') retired = true;
        }
      }
      if (closed) {
        try {
          const replacement = await officialApi.snapshot(member);
          if (replacement.available !== false) return overlay(replacement);
        } catch { /* Keep plugin facts or try levels-only fallback below. */ }
      }
      // Hiscores is levels-only and is used only without any plugin evidence.
      if (plugin()) return overlay(closed ? unavailable : null);
      try {
        const web = await fallback.snapshot(member);
        if (web.available === false) throw new Error('Hiscores unavailable');
        // A stale fallback must never lower a saved level or XP observation.
        web.skills = web.skills.filter(row => {
          const saved = member.skillProgress?.[row.skill];
          return !progressBelongsToMember(saved, member) || row.level >= saved.level && row.xp >= saved.xp;
        });
        return overlay({ ...web, ...(closed ? { message: RUNE_METRICS_CLOSED_MESSAGE } : {}) });
      } catch {
        if (plugin()) return overlay(closed ? unavailable : null);
        if (closed) return unavailable;
        throw failure;
      }
    },
    close() { legacy.close(); officialApi.close?.(); fallback.close?.(); },
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
