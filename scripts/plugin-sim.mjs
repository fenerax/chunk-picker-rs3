import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8953');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Pass a base HTTP(S) origin.');
const key = process.env.RS3_PLUGIN_KEY;
if (!/^gpk_[A-Za-z0-9_-]{43}$/.test(key ?? '')) throw new Error('Set RS3_PLUGIN_KEY to a game plugin key.');
const world = { id: 1, beta: true };
let seq = Date.now();
// Optional RS3_PLUGIN_PATH is comma-separated chunk IDs, useful for a second player.
const chunks = (process.env.RS3_PLUGIN_PATH ?? '12850,12851,13107,12850').split(',');
for (const [index, chunk] of chunks.entries()) {
  if (!/^\d+$/.test(chunk)) throw new Error('RS3_PLUGIN_PATH must contain decimal chunk IDs.');
  const id = Number(chunk), x = Math.floor(id / 256), z = id % 256;
  if (x > 199 || z > 199) throw new Error('Path coordinates must be from 0 to 199.');
  const report = { v: 1, seq: seq++, sentAt: new Date().toISOString(), world, position: { x, z, floor: 0 },
    ...(index === chunks.length - 1 ? { skills: { ATTACK: { level: 12, xp: 1584 }, MINING: { level: 15, xp: 2411 }, RUNECRAFT: { level: 3, xp: 174 } },
      quests: { finished: ['COOK_S_ASSISTANT', 'An unmatched test quest'], started: ['THE_BLOOD_PACT'] } } : {}) };
  const response = await fetch(new URL('/api/plugin/v1/report', base), { method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Plugin report failed (${response.status}): ${result.message}`);
  console.log(JSON.stringify(result));
  if (index < chunks.length - 1) await delay(1100);
}
