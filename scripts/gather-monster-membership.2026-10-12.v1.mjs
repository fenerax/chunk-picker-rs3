// Focused, resumable public Wiki requests; no client, save, spawn or drop reads.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const dir = '.local/game-data/monster-membership-2026-10-12-v1';
mkdirSync(dir, { recursive: true });
const source = JSON.parse(readFileSync('app/data/source-membership.2026-10-08.v1.json'));
const rows = source.records.filter(row => row.kind === 'Monster' && row.members === null);
const aliases = {
  'Demon Boss': 'Demon boss', 'Demon Boss (Wilderness)': 'Demon boss',
  'Chaos dwarf (Wilderness)': 'Chaos dwarf', 'Guard (Desert Minding Camp)': 'Guard (Desert Mining Camp)',
  'Geater reborn warrior': 'Greater reborn warrior', 'Chaos demon savage': 'Chaos Demon Savage',
  'Mefis, the jailer': 'Mefis the Jailer', 'Crassion warrior (Uncharted Isles)': 'Crassian warrior (Uncharted Isles)',
  'Asyn Shadow': 'Asyn shade', 'Undead witch': 'Undead Witch',
  'Monsters in Shattered Wrolds': 'Shattered Worlds', 'Monsters in Daemonheim': 'Dungeoneering',
  'Monsters in New Varrock': 'Dimension of Disaster', 'Zombie (Dimension of Disaster)': 'Zombie (New Varrock)',
};
const requests = rows.map(row => ({ source: row.source, title: aliases[row.source] ?? row.source.split('#')[0].replace(/ \((Hard|Story) Mode\)$/, '') }));
const extras = ['Troll (monster)', 'Warrior (monster)', 'Shadow (monster)', 'Lava monster (monster)', 'Elf warrior', 'Skeleton mage (Piscatoris Fishing Colony)', 'Lumbridge guard', 'Soldier (Burthorpe)', 'Penguin (monster)', 'Archer (monster)', 'Giant skeleton (monster)', 'Guard (monster)', 'Mummy (monster)', 'Necromancer (monster)', 'Bandit (monster)', 'Zamorak mage (monster)', 'Kerapac, the bound', 'Twin Furies', 'Vindicta', 'Helwyr', 'The Barrows: Rise of the Six', 'Vorkath', 'Zemouregal', 'Rock (Troll)', 'Twig (Troll)', 'The Kendal (monster)', 'Chinchompa (Hunter)', 'Crystal skillchompa (Hunter)', 'Azure skillchompa (Hunter)', 'Cobalt skillchompa (Hunter)', 'Crimson skillchompa (Hunter)', 'Viridian skillchompa (Hunter)'];
const titles = [...new Set([...requests.map(row => row.title), ...extras])].sort();
writeFileSync(`${dir}/requests.json`, JSON.stringify({ requests, titles }, null, 2) + '\n');
for (let i = 0; i < Math.ceil(titles.length / 40); i++) {
  const path = `${dir}/batch-${String(i).padStart(3, '0')}.json`;
  if (existsSync(path)) continue;
  const url = new URL('https://runescape.wiki/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', redirects: '1', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: titles.slice(i * 40, (i + 1) * 40).join('|') })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerMonsterMembership/1.0 (bounded personal evidence review)' }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = await response.text(), data = JSON.parse(bytes);
  if (data.error) throw new Error(JSON.stringify(data.error));
  writeFileSync(path, bytes + '\n');
  console.log(`Fetched ${i + 1}/${Math.ceil(titles.length / 40)}`);
}
