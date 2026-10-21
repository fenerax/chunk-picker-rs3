import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
const dir = '.local/game-data/monster-membership-2026-10-12-v1';
mkdirSync(dir, { recursive: true });
const titles = ['Shadow (Temple of Light)', 'Twig (monster)', 'Rock (monster)', 'Lumbridge guard (attackable)', 'Soldier (Yanille)', 'Thora (Miscellania Castle)', 'Thora (Miscellania Dungeon)', 'Thora the Barkeep', 'Bull (monster)', 'Bull (Havenhythe)', 'Customs officer (monster)', 'Skeleton Mage (Piscatoris)', 'Skeleton mage (Piscatoris)', 'Troll (Barendir)', 'Troll (historical)', 'Elf warrior', 'False User (One of a Kind)', 'Nymora, the Vengeful', 'Avaryss, the Unceasing', 'The Barrows Brothers', 'Ahrim the Blighted', 'Lava monster (TokTz-Ket-Dill)', 'Fire monster', 'Monk of Zamorak', 'Villager (Tai Bwo Wannai)', 'Tarik', 'Veliaf Hurtz', 'Battle of Forinthry', 'Shattered Worlds', 'Dungeoneering', 'Undead Witch', 'Crawling hand', 'Jungle spider', 'Cow', 'Dwarf', 'Rat', 'Crab', 'Moss giant', 'Spinolyp', 'Template:Infobox Monster'];
titles.push('Dharok the Wretched', 'Guthan the Infested', 'Karil the Tainted', 'Torag the Corrupted', 'Verac the Defiled', 'Elf warrior (Arandar)', 'Villager (monster)', 'Archer (Ardougne)', 'Penguin (monster)', 'Module:Infobox Monster', 'Dimension of Disaster');
for (let i = 0; i < Math.ceil(titles.length / 40); i++) {
  const path = `${dir}/extra-${String(i).padStart(3, '0')}.json`;
  if (existsSync(path)) continue;
  const url = new URL('https://runescape.wiki/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', redirects: '1', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: titles.slice(i * 40, (i + 1) * 40).join('|') })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerMonsterMembership/1.0 (bounded personal evidence review)' }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = await response.text(), data = JSON.parse(bytes);
  if (data.error) throw new Error(JSON.stringify(data.error));
  writeFileSync(path, bytes + '\n');
  console.log(`Fetched identity batch ${i + 1}`);
}
const searches = ['Skeleton Mage (Piscatoris Fishing Colony)', 'Penguin', 'Elf warrior', 'Villager', 'Troll'];
for (let i = 0; i < searches.length; i++) {
  const path = `${dir}/search-${String(i).padStart(3, '0')}.json`;
  if (existsSync(path)) continue;
  const url = new URL('https://runescape.wiki/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', list: 'search', srnamespace: '0', srlimit: '5', srsearch: searches[i] })) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = await response.text(), data = JSON.parse(bytes);
  if (data.error) throw new Error(JSON.stringify(data.error));
  writeFileSync(path, bytes + '\n');
}
