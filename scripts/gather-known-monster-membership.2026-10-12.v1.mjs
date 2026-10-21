// Re-read only the precise revisions already used by the 895 known policies.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const dir = '.local/game-data/monster-membership-2026-10-12-v1';
mkdirSync(dir, { recursive: true });
const original = JSON.parse(readFileSync('app/data/source-membership.2026-10-08.v1.json'));
const revisions = [...new Set(original.records.filter(row => row.kind === 'Monster' && row.members !== null).map(row => row.wiki.revisionId))].sort((a, b) => a - b);
writeFileSync(`${dir}/known-revisions.json`, JSON.stringify(revisions, null, 2) + '\n');
for (let i = 0; i < Math.ceil(revisions.length / 40); i++) {
  const path = `${dir}/known-${String(i).padStart(3, '0')}.json`;
  if (existsSync(path)) continue;
  const url = new URL('https://runescape.wiki/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', revids: revisions.slice(i * 40, (i + 1) * 40).join('|') })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerMonsterMembership/1.0 (pinned revision audit)' }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = await response.text(), data = JSON.parse(bytes);
  if (data.error) throw new Error(JSON.stringify(data.error));
  writeFileSync(path, bytes + '\n');
  console.log(`Audited revision batch ${i + 1}/${Math.ceil(revisions.length / 40)}`);
}
