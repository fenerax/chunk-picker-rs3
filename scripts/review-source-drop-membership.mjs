// Derive only explicit Wiki row/table membership; no inference from item flags.
import { readFileSync, writeFileSync } from 'node:fs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
const dir = '.local/game-data/source-membership-2026-10-08-v1';
const catalogue = JSON.parse(readFileSync('app/data/source-membership.2026-10-08.v1.json'));
const definitions = JSON.parse(readFileSync('rs3-chunkpicker-chunkinfo-export.json'));
const pages = new Map();
for (let i = 0; i < 198; i++) for (const page of Object.values(JSON.parse(readFileSync(`${dir}/batch-${String(i).padStart(3, '0')}.json`)).query.pages)) pages.set(page.title, page);
for (const page of Object.values(JSON.parse(readFileSync(`${dir}/targeted-drops-methods.json`)).query.pages)) pages.set(page.title, page);
for (const page of Object.values(JSON.parse(readFileSync(`${dir}/demon-alias-review.json`)).query.pages)) pages.set(page.title, page);
for (const file of ['incidental-output-review.json', 'incidental-output-followup.json']) for (const page of Object.values(JSON.parse(readFileSync(`${dir}/${file}`)).query.pages)) pages.set(page.title, page);
function templates(text) {
  const result = [];
  for (let start = 0; start < text.length - 1; start++) if (text.slice(start, start + 2) === '{{') {
    let depth = 1, end = start + 2, body = '';
    for (; end < text.length && depth; end++) {
      if (text.slice(end, end + 2) === '{{') { depth++; end++; }
      else if (text.slice(end, end + 2) === '}}') { depth--; end++; }
      else if (depth === 1) body += text[end];
    }
    const [name, ...fields] = body.split('|');
    result.push({ start, end, name: name.trim(), fields: Object.fromEntries(fields.map(field => { const at = field.indexOf('='); return at < 0 ? [field.trim(), null] : [field.slice(0, at).trim(), field.slice(at + 1).trim()]; })) });
  }
  return result;
}
const rows = [];
const evidence = page => ({ title: page.title, revisionId: page.revisions[0].revid, url: `https://runescape.wiki/w/Special:PermanentLink/${page.revisions[0].revid}` });
// This retained shop label names Sir Renitee's unique painting/map/crest
// service, documented on the NPC page rather than a separate Shop page.
const renitee = pages.get('Sir Renitee'), reniteeText = renitee.revisions[0].slots.main['*'];
const reniteeBox = templates(reniteeText).find(row => row.name === 'Infobox NPC');
const reniteeAlias = "Sir Renitee's Construction Supplies";
if (reniteeBox?.fields.name !== 'Sir Renitee' || reniteeBox.fields.members !== 'Yes'
  || !reniteeText.includes('He sells various wall decoration materials') || !reniteeText.includes("tell player's heritage to paint as a crest")) throw new Error('Sir Renitee shop identity evidence drift');
if (!definitions.shopItems[reniteeAlias] || !Object.hasOwn(definitions.shopItems[reniteeAlias], 'Small map')
  || !Object.hasOwn(definitions.shopItems[reniteeAlias], 'Arrav heraldry')) throw new Error('Sir Renitee retained shop alias drift');
rows.push({ kind: 'Shop', source: reniteeAlias, members: true, status: 'verified-row', basis: 'Reviewed retained unique supplier alias; pinned member NPC explicitly sells painting/map materials and provides heraldic crests',
  aliasReview: { canonicalSource: 'Sir Renitee', retainedShopLabel: reniteeAlias, retainedStock: definitions.shopItems[reniteeAlias] }, wiki: evidence(renitee) });
// The Wiki title differs in case; its infobox name and explicit Wilderness
// variant certify both retained labels without applying an area inference.
const demonPage = pages.get('Demon boss'), demon = templates(demonPage.revisions[0].slots.main['*']).find(row => row.name === 'Infobox Monster');
if (demon.fields.name !== 'Demon Boss' || demon.fields.version2 !== 'Wilderness' || demon.fields.members !== 'Yes') throw new Error('Demon alias evidence drift');
for (const label of [demon.fields.name, `${demon.fields.name} (${demon.fields.version2})`]) rows.push({ kind: 'Monster', source: label, members: true, status: 'verified-row', basis: 'Exact infobox name or infobox name + explicit Wilderness variant', wiki: evidence(demonPage) });
const slayer = pages.get('Slayer'), slayerText = slayer.revisions[0].slots.main['*'];
const freeMasterProse = /Non-members can get tasks from (.*?) and train Slayer up to level 5\./.exec(slayerText)?.[1];
if (!freeMasterProse) throw new Error('Free Slayer master evidence drift');
const freeMasters = new Set([...freeMasterProse.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(match => match[1]));
for (const [label, record] of Object.entries(definitions.challenges.Slayer)) if (/^Receive a slayer assignment from /.test(label)) {
  const master = record.NPCs?.[0]?.split('#')[0];
  if (!master || freeMasters.has(master) || !slayerText.includes(`[[${master}`)) continue;
  rows.push({ kind: 'Task', category: 'Slayer', source: label, members: true, status: 'verified-row', basis: 'Pinned Slayer free-master list excludes this declared advanced master; Jacquelyn page says advanced masters are members-only', master, wiki: evidence(slayer), corroboration: evidence(pages.get('Jacquelyn')) });
}
for (const source of catalogue.records.filter(row => ['Shop', 'Monster'].includes(row.kind) && row.wiki && row.status !== 'identity-unresolved')) {
  const page = pages.get(source.wiki.title); if (!page?.revisions) continue;
  const raw = page.revisions[0].slots.main['*'];
  let scope = null; const found = new Map();
  for (const template of templates(raw)) {
    if (template.name === 'DropsTableHead') scope = template.fields.version === 'Members' ? true : template.fields.version === 'F2P' ? false : null;
    if (['DropsTableBottom', 'DropsTableEnd'].includes(template.name)) scope = null;
    const kind = template.name === 'StoreLine' && source.kind === 'Shop' ? 'ShopItem' : template.name === 'DropsLine' && source.kind === 'Monster' ? 'DropItem' : null;
    if (!kind || !template.fields.name) continue;
    const marked = /^(yes|true)$/i.test(template.fields.members ?? '') || scope === true;
    const name = template.fields.name, previous = found.get(name);
    // A second unmarked/free variant defeats a globally blocked source row.
    found.set(name, { kind, source: name, category: source.source, members: previous ? previous.members && marked : marked,
      status: 'verified-row', basis: marked ? template.fields.members ? 'row.members' : 'table.version=Members' : 'unmarked-or-free-row', wiki: evidence(page) });
  }
  rows.push(...[...found.values()].filter(row => row.members));
}
for (const [title, table] of [['Rare drop table', 'RareDropTable+'], ['Gem drop table', 'GemDropTable+']]) {
  const page = pages.get(title), found = new Map();
  for (const template of templates(page.revisions[0].slots.main['*'])) if (template.name === 'DropsLine' && template.fields.name) {
    const marked = /^(yes|true)$/i.test(template.fields.members ?? ''), name = template.fields.name;
    found.set(name, { kind: 'DropItem', source: name, category: table, members: (found.get(name)?.members ?? true) && marked,
      status: 'verified-row', basis: 'row.members', wiki: evidence(page) });
  }
  rows.push(...[...found.values()].filter(row => row.members));
}
// The retained Gem table flattens its members-only Rare table roll into rows.
// The pinned Gem page explicitly excludes this branch for F2P; preserve every
// direct gem-table row, including its nonmember variant, and cut only the
// flattened downstream entries which the Wiki direct table does not contain.
const gemPage = pages.get('Gem drop table'), gemText = gemPage.revisions[0].slots.main['*'];
if (!gemText.includes('[[Free-to-play]] players cannot access the rare drop table via the gem drop table')) throw new Error('Gem-to-Rare membership evidence changed');
const directGems = new Set(templates(gemText).filter(row => row.name === 'DropsLine').map(row => row.fields.name));
for (const item of Object.keys(definitions.codeItems.dropTables['GemDropTable+'])) if (!directGems.has(item) && !rows.some(row => row.kind === 'DropItem' && row.category === 'GemDropTable+' && row.source === item)) rows.push({ kind: 'DropItem', category: 'GemDropTable+', source: item, members: true, status: 'verified-row', basis: 'members-only Gem-to-Rare branch; absent from direct Gem table', wiki: evidence(gemPage) });
// F2P recipe policy is intrinsic to the precise ingredient variant, not Shaft.
const shaft = pages.get('Shaft');
for (const template of templates(shaft.revisions[0].slots.main['*'])) if (template.name === 'Infobox Recipe' && template.fields.output1 === 'Shaft') {
  const ingredient = template.fields.mat1, members = /^(yes|true)$/i.test(template.fields.members ?? '');
  if (!members || !ingredient) continue;
  for (const [label, record] of Object.entries(definitions.challenges.Fletching)) if (record.Output === 'Shaft' && (record.Items ?? []).some(item => item.replace(/\*+$/, '') === ingredient)) rows.push({ kind: 'Task', category: 'Fletching', source: label, members: true, status: 'verified-row', basis: 'Infobox Recipe.members with exact material/output', ingredient, wiki: evidence(shaft) });
}
const provenance = { reference: { path: 'rs3-chunkpicker-chunkinfo-export.json', sha256: sha256RepositoryText(readFileSync('rs3-chunkpicker-chunkinfo-export.json')) },
  generators: ['scripts/review-source-drop-membership.mjs', 'scripts/lib/provenance-hash.mjs'].map(path => ({ path, sha256: sha256RepositoryText(readFileSync(path)) })),
  sourceCatalogue: { path: 'app/data/source-membership.2026-10-08.v1.json', sha256: sha256RepositoryText(readFileSync('app/data/source-membership.2026-10-08.v1.json')) },
  snapshotManifest: { path: `${dir}/manifest.json`, sha256: sha256(readFileSync(`${dir}/manifest.json`)) },
  extraSnapshots: ['targeted-drops-methods.json', 'demon-alias-review.json', 'incidental-output-review.json', 'incidental-output-followup.json'].map(file => ({ path: `${dir}/${file}`, sha256: sha256(readFileSync(`${dir}/${file}`)) })) };
const counts = { rows: rows.length, byKind: Object.fromEntries([...new Set(rows.map(row => row.kind))].map(kind => [kind, rows.filter(row => row.kind === kind).length])) };
writeFileSync('app/data/source-row-membership.2026-10-08.v1.json', JSON.stringify({ schemaVersion: 1, verifiedOn: '2026-10-08', provenance, policy: 'Only explicit members=yes stock/drop rows, explicit Members drop table sections with no free row for the same item, exact member-only Shaft recipe variants, pinned advanced Slayer assignment restrictions, two reviewed exact Demon Boss aliases, and the reviewed Sir Renitee unique supplier shop alias. Restriction is local to shop, monster, nested drop-table source or named method. Item membership is independent.', counts, records: rows }, null, 2) + '\n');
const requirementsPath = 'app/data/source-method-requirements.2026-10-08.v1.json', requirements = JSON.parse(readFileSync(requirementsPath));
const ground = pages.get("Gunnar's Ground").revisions[0].slots.main['*'];
if (!ground.includes('[[Free-to-play]] players can engrave the jewellery') || !ground.includes('[[onyx amulet]]')) throw new Error('F2P engraving evidence drift');
requirements.provenance = provenance;
writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2) + '\n');
const incidental = [];
for (const [category, label, titles, basis] of [
  ['Firemaking', 'Light a fire using ~|acadia logs|~', ['Acadia logs'], 'Free Acadia logs have Light option and ordinary level-47 Firemaking XP; the only authored item outputs are expressly occasional bee/amber loot.'],
  ['Woodcutting', 'Cut ~|trees|~ around Wendlewick', ['Oaken key', 'Wendlewick'], 'The key is expressly an additional find from chopping any trees; ordinary cutting in the free settlement is independently subject to its resource/access checks.'],
]) {
  const record = definitions.challenges[category][label];
  if (!record) throw new Error(`Missing incidental output method: ${category} ${label}`);
  const fields = ['Items', 'Level', 'Output', 'Output Object', 'Chunks'];
  incidental.push({ category, source: label, before: Object.fromEntries(fields.map(field => [field, { present: Object.hasOwn(record, field), value: record[field] ?? null }])), basis, wiki: titles.map(title => evidence(pages.get(title))) });
}
writeFileSync('app/data/source-incidental-outputs.2026-10-08.v1.json', JSON.stringify({ schemaVersion: 1, verifiedOn: '2026-10-08', provenance, policy: 'F2P-only guarded distinction between the underlying method and incidental item loot. Suppress only the all-member output ban, preserve every mandatory input/source/location/method restriction, and continue filtering the member loot from item production. No all-mode metadata change.', records: incidental }, null, 2) + '\n');
console.log(counts);
