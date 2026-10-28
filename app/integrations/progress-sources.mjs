import { createRuneMetricsClient, normalizeRuneMetricsSnapshot } from './runemetrics.mjs';
import { previewProgressSnapshot } from './progress-preview.mjs';
import { RUNE_METRICS_SUNSET_AT, PLUGIN_PROGRESS_FRESH_MS } from './progress-source-policy.mjs';

export function createOfficialApiSource() {
  return { async snapshot() { return { available: false, source: 'official-api', sourceLabel: 'RuneScape API',
    message: 'The new RuneScape API is not available yet. Levels sync from the game plugin now.' }; } };
}

/** Sources expose snapshot(member): normalized skills (XP, not tenths), quest
 * titles/statuses and fetchedAt, or { available:false, source, message }.
 * No source writes state. The server binds the preview to its save revision. */
export function createProgressSources({ runeMetrics = {}, pluginSnapshot = () => null,
  webSource = 'runemetrics', officialApi = createOfficialApiSource(), clock = runeMetrics.clock ?? Date.now } = {}) {
  if (!['runemetrics', 'official-api'].includes(webSource)) throw new TypeError('Unknown web progress source.');
  const legacy = createRuneMetricsClient({ ...runeMetrics, clock });
  let retired = false;
  return {
    async snapshot(member) {
      const plugin = pluginSnapshot(member);
      if (plugin) return plugin;
      if (webSource === 'official-api' || retired || clock() >= RUNE_METRICS_SUNSET_AT) return officialApi.snapshot(member);
      if (!member.runescapeName) return { available: false, source: 'runemetrics', sourceLabel: 'RuneMetrics',
        message: 'Connect the game plugin or save this player’s RuneScape name to sync progress.' };
      try {
        const snapshot = normalizeRuneMetricsSnapshot(await legacy.snapshot(member));
        return pluginSnapshot(member) ?? snapshot;
      }
      catch (error) {
        const latestPlugin = pluginSnapshot(member);
        if (latestPlugin) return latestPlugin;
        if (error.code !== 'SOURCE_RETIRED') throw error;
        retired = true;
        return officialApi.snapshot(member);
      }
    },
    close() { legacy.close(); officialApi.close?.(); },
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
