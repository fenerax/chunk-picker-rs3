// Exact revisions selected by the bounded follow-up identity review. The two
// artifacts can be rebuilt without search, redirects or an existing cache.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
const dir = '.local/game-data/monster-membership-2026-10-12-v1';
mkdirSync(dir, { recursive: true });
const requests = [
  { file: 'extra-helper.json', revisions: [36767334, 37127220, 37183144, 37075376, 37126552, 37156903, 37156901, 37122203, 37176335, 37143421, 37156877, 37156879, 37156880, 37156881, 37156882, 36110053, 36174821, 37203070, 37157463] },
  { file: 'extra-helper-final.json', revisions: [37143575, 37150558, 37093485, 37144449, 37122078, 37122083] },
];
for (const request of requests) {
  const path = `${dir}/${request.file}`;
  if (existsSync(path)) continue;
  const url = new URL('https://runescape.wiki/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', revids: request.revisions.join('|') })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerMonsterMembership/1.0 (pinned family identity review)' }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = await response.text(), data = JSON.parse(bytes);
  if (data.error) throw new Error(JSON.stringify(data.error));
  writeFileSync(path, bytes + '\n');
  console.log(`Fetched ${request.file}`);
}
