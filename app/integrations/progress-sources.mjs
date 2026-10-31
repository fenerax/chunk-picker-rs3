import { createOfficialApiSource, RUNE_METRICS_CLOSED_MESSAGE } from './official-api.mjs';
export { createOfficialApiSource, RUNE_METRICS_CLOSED_MESSAGE } from './official-api.mjs';
import { createRuneMetricsClient, normalizeRuneMetricsSnapshot } from './runemetrics.mjs';
import { previewProgressSnapshot } from './progress-preview.mjs';
import { createHiscoresSource } from './hiscores.mjs';
import { progressBelongsToMember } from '../core/game-progress.mjs';
import { RUNE_METRICS_SUNSET_AT, PLUGIN_PROGRESS_FRESH_MS } from './progress-source-policy.mjs';

/** Sources expose snapshot(member): normalized skills (actual XP), quests and
 * fetchedAt, or available:false. Only a reviewed proposal can write state. */
export function createProgressSources({ runeMetrics = {}, pluginSnapshot = () => null,
  runeMetricsEnabled = () => process.env.RS3_RUNEMETRICS_ENABLED !== '0',
  hiscores = createHiscoresSource(), webSource = 'runemetrics',
  officialApi = createOfficialApiSource(), clock = runeMetrics.clock ?? Date.now } = {}) {
  if (!['runemetrics', 'official-api'].includes(webSource)) throw new TypeError('Unknown web progress source.');
  const legacy = createRuneMetricsClient({ ...runeMetrics, clock });
  let retired = false;
  const enabled = () => typeof runeMetricsEnabled === 'function' ? runeMetricsEnabled() : runeMetricsEnabled;
  const savedPlugin = member => [...Object.values(member.skillProgress ?? {}), ...Object.values(member.questProgress ?? {})]
    .some(value => value.source === 'game-plugin' && progressBelongsToMember(value, member));
  return {
    async snapshot(member) {
      let web, failure, closed = false;
      if (webSource === 'official-api' || retired || !enabled() || clock() >= RUNE_METRICS_SUNSET_AT) {
        closed = true;
        web = await officialApi.snapshot(member);
      } else if (member.runescapeName) {
        try { web = normalizeRuneMetricsSnapshot(await legacy.snapshot(member)); }
        catch (error) {
          // A JSON unknown-player response still has its old meaning. An HTTP
          // endpoint 404, Gone or an unreachable endpoint can signal closure.
          if (!['SOURCE_RETIRED', 'ENDPOINT_CLOSED', 'NETWORK_FAILURE', 'TIMEOUT'].includes(error.code)) {
            const plugin = pluginSnapshot(member);
            if (plugin) return plugin;
            failure = error;
            web = { available: false };
          }
          if (!failure) {
            retired ||= error.code === 'SOURCE_RETIRED' || error.code === 'ENDPOINT_CLOSED';
            closed = true;
            web = await officialApi.snapshot(member);
          }
        }
      } else {
        web = { available: false, source: 'runemetrics', sourceLabel: 'RuneMetrics',
          message: 'Connect the game plugin or save this player’s RuneScape name to sync progress.' };
      }
      let plugin = pluginSnapshot(member);
      if ((closed || failure) && web.available === false && !plugin && !savedPlugin(member) && member.runescapeName) {
        // Fallback failures are informational: never turn absent data into zeros.
        try { web = await hiscores.snapshot(member); } catch { /* keep the unavailable result */ }
        plugin = pluginSnapshot(member);
      }
      if (failure && web.available === false && !plugin) throw failure;
      const message = closed && (web.source !== 'official-api' || web.available === false) ? RUNE_METRICS_CLOSED_MESSAGE : undefined;
      if (web.available === false) return plugin ? { ...plugin, ...(message ? { message } : {}) } : { ...web, ...(message ? { message } : {}) };
      return { ...web, ...(plugin ? { plugin } : {}), ...(message ? { message } : {}) };
    },
    close() { legacy.close(); officialApi.close?.(); hiscores.close?.(); },
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
        skills: skills.map(value => ({ ...value.row })), quests: ['finished', 'started'].flatMap(kind => (quests?.rows[kind] ?? [])
          .map(title => ({ title: title.replaceAll('_', ' '), status: kind === 'finished' ? 'COMPLETED' : 'STARTED' }))) };
    },
    clear() { members.clear(); },
  };
}
