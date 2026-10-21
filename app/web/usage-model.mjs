import { usageEvents } from './usage-catalogue.mjs';

export function usageSummary(counts, { actor, days = 7, device = 'all', now = new Date() } = {}) {
  const today = Date.parse(now.toISOString().slice(0, 10));
  const start = new Date(today - (days - 1) * 86400000).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  const totals = new Map(usageEvents.map(event => [event.id, { ...event, phone: 0, desktop: 0, total: 0 }]));
  for (const row of counts) {
    const event = totals.get(row.id);
    if (!event || row.actor !== actor || row.day < start || row.day > end || !['phone', 'desktop'].includes(row.device)) continue;
    event[row.device] += row.count;
    if (device === 'all' || device === row.device) event.total += row.count;
  }
  const events = [...totals.values()];
  return { start, end, total: events.reduce((sum, event) => sum + event.total, 0),
    top: events.filter(event => event.total > 0).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)).slice(0, 30),
    unused: events.filter(event => !event.total).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
