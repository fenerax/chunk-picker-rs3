#!/usr/bin/env node
// Bounded H4 review: retained definitions + the named public Wiki revisions.
// No private saves, browser sessions, caches or original worker are opened.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { createTaskEngine } from '../../app/tasks/engine.mjs';

const root = resolve(import.meta.dirname, '../..');
const flag = process.argv.indexOf('--output');
if (flag < 0 || !process.argv[flag + 1]) throw new Error('Pass --output with a new versioned JSON path.');
const output = resolve(root, process.argv[flag + 1]), local = relative(root, output);
if (isAbsolute(local) || local === '..' || local.startsWith('..\\') || local.startsWith('../') || existsSync(output)) throw new Error('Output must be a new file inside this worktree.');
const bytes = readFileSync(resolve(root, 'rs3-chunkpicker-chunkinfo-export.json'));
const definitions = JSON.parse(bytes);
const state = { rules: {}, taskRules: { F2P: true }, members: [{ id: 'audit', unlocked: [], completedTasks: [] }] };
const baseline = createTaskEngine(definitions, { retainedUnsupportedCorrections: false }).evaluate(state, 'audit');
const unsupported = baseline.tasks.filter(row => row.status === 'unsupported');
if (unsupported.length !== 34) throw new Error(`Review changed unsupported baseline: ${unsupported.length}`);
const specs = [
  ['Runecrafter robes', { f2p: true, ordinaryPieces: ['Runecrafter gloves', 'Runecrafter hat', 'Runecrafter robe', 'Runecrafter skirt'], guildEntryRunecrafting: 50 }, 'come in three colours'],
  ['Master runecrafter robes', { members: true, separateOutfit: true }, '|members = Yes'],
  ['Second-age mage set', { members: true }, '|members = Yes'],
  ['Chaotic guard', { members: true }, '|members = Yes'],
  ['Chaotic rapier frozen dye kit', { members: true }, '|members = Yes'],
  ['Chaotic rapier warped dye kit', { members: true }, '|members = Yes'],
  ['The Great Orb Project', { f2p: true, ironmenCanBuyCosmeticRobes: true }, 'Ironmen are only able to purchase the cosmetic robes'],
  ['Portent of item protection', { members: true, input: 'Prayer potion (4)' }, '|mat2 = Prayer potion (4)'],
  ['Oily bakami', { members: true, hunter: 90 }, '|members = Yes'],
  ['Staff of limitless air', { members: true }, '|members = Yes'],
  ['Ancient cloak', { members: true }, '|members = Yes'],
  ['Chaotic essence', { members: true, meleeWeaponsOnly: true }, 'any melee [[Chaotic equipment|chaotic weapon]]'],
  ['The Distracted (title)', { members: true }, '|members = Yes'],
  ['Demon Flash Mob', { members: true, retired: false }, 'are a members-only'],
  ['Varrock achievements', { completionMembers: true }, '|members = Yes'],
  ["But It Won't Warp You Anywhere", { renamedTo: "Security Isn't a Dirty Word" }, "#REDIRECT [[Security Isn't a Dirty Word]]"],
  ['Changing Rooms', { renamedTo: 'Make a House a Home' }, '#REDIRECT [[Make a House a Home]]'],
  ["Security Isn't a Dirty Word", { members: true, currentObjective: 'crevice shortcut' }, '[[Crevice (Edgeville Dungeon)|crevice]] shortcut'],
  ['Make a House a Home', { f2p: true, currentObjective: 'ask estate agent about housing' }, 'ask about [[player-owned house|player housing]]'],
  ['Scabaras Would Be Proud', { correctedName: 'Scabaras Would Be Proud' }, 'without stopping any Scarabs from spawning'],
  ['A Mini Shipment', { correctedName: 'A Mini Shipment' }, 'loot the [[trunk]]'],
  ['Flippers', { correctedName: 'Flippers' }, 'Flippers McGraw'],
  ['It Still Should Have Been Called Aetherium', { correctedName: 'It Still Should Have Been Called Aetherium' }, '[[masterwork 2h sword]]'],
  ['Imcando at a Tree', { correctedName: 'Imcando at a Tree' }, 'combine an [[Imcando hatchet]]'],
  ['Tirannwn achievements', { completionMembers: true }, '|members = Yes'],
  ['Construction Contracts', { members: true }, 'Construction Contracts'],
  ['Creature of Fenkenstrain', { correctedName: 'Creature of Fenkenstrain', members: true }, 'Fenkenstrain'],
  ["Greater Death's Swiftness", { members: true, unresolvedRetainedDependency: true }, '|members = Yes'],
  ['Music Maestro', { members: true, mysteryCompletionNotEquivalentToMusicUnlock: true }, 'tracks the number of [[music]] tracks'],
  ['Reaper Crew', { members: true, missingAllBossesReference: true }, 'defeat every listed boss'],
  ['Cave bug', { soulMembers: true, retainedVariantMappingUnreviewed: true }, 'level 7 [[Slayer]]'],
];
const url = new URL('https://runescape.wiki/api.php');
url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: specs.map(row => row[0]).join('|') });
const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerH4Audit/1.0 (bounded public metadata review)' }, signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
const pages = new Map((await response.json()).query.pages.map(page => [page.title, page]));
const wiki = specs.map(([title, facts, expected]) => {
  const revision = pages.get(title)?.revisions?.[0], content = revision?.slots.main.content;
  if (!content?.includes(expected)) throw new Error(`Review changed Wiki facts: ${title}`);
  return { title, revisionId: revision.revid, timestamp: revision.timestamp, contentSha256: sha256(content), url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, facts };
});
const corrections = [], rows = [];
const byId = new Map(unsupported.map(row => [row.id, row]));
function review(suffix, wikiTitle, reason, values = {}, aliases = []) {
  const row = byId.get(`rs3:task:${suffix}`);
  if (!row) throw new Error(`Missing baseline target ${suffix}`);
  // Ordinary cosmetic robes are the only F2P goal in this reviewed set.
  const membership = suffix === '0019c5' ? 'F2P' : 'members';
  if (membership === 'members' && row.record['Not F2P'] !== true) values = { ...values, 'Not F2P': true };
  const supported = ['Items', 'Tasks', 'Chunks'].some(field => Object.hasOwn(values, field)) || aliases.length > 0;
  const changes = Object.entries(values).map(([field, after]) => ({ field, beforePresent: Object.hasOwn(row.record, field), before: row.record[field] ?? null, after }));
  const raw = definitions.challenges[row.category][row.rawLabel];
  if (sha256(JSON.stringify(raw)) !== sha256(JSON.stringify(row.record))) throw new Error(`An existing overlay changed H4 target ${suffix}`);
  const retainedUnsupportedReasons = row.blockers.filter(value => value.kind === 'unsupported').map(value => value.detail);
  rows.push({ id: row.id, label: row.label, rawLabel: row.rawLabel, skill: row.category,
    skillRequirements: { ...row.record.Requirements, ...row.record.SkillsNeeded, ...row.record.Skills, ...(row.record.Level === undefined ? {} : { [row.category]: row.record.Level }) },
    membership, retainedNotF2P: row.record['Not F2P'] === true, retainedUnsupportedReasons,
    decision: supported ? 'support' : 'keep-hidden-members-only', reason, wikiTitle, beforeRecordSha256: sha256(JSON.stringify(raw)) });
  const reviewedRecord = { ...raw, ...values }, dependencies = [];
  for (const [field, group] of [['Items', 'itemsPlus'], ['Chunks', 'chunksPlus'], ['Objects', 'objectsPlus'], ['NPCs', 'npcsPlus'], ['Monsters', 'monstersPlus'], ['Monster', 'monstersPlus'], ['Shops', 'shopsPlus'], ['Mix', 'mixPlus'], ['Tasks', 'tasksPlus']]) {
    const tokens = field === 'Tasks' ? Object.keys(reviewedRecord.Tasks ?? {}) : reviewedRecord[field] === undefined ? [] : Array.isArray(reviewedRecord[field]) ? reviewedRecord[field] : [reviewedRecord[field]];
    for (const token of tokens) {
      const name = (field === 'Tasks' ? token : token.replaceAll('*', '')).replace(/x\d+$/, '');
      if (!name.endsWith('[+]') || aliases.some(alias => alias.group === group && alias.name === name)) continue;
      const value = definitions.codeItems[group]?.[name];
      if (value !== undefined && !dependencies.some(dependency => dependency.group === group && dependency.name === name)) dependencies.push({ group, name, sha256: sha256(JSON.stringify(value)) });
    }
  }
  if (changes.length || aliases.length) corrections.push({ id: row.id, category: row.category, label: row.rawLabel, beforeRecordSha256: sha256(JSON.stringify(raw)), rationale: reason, changes, aliases, dependencies });
}
function alias(group, name, sourceName, values = definitions.codeItems[group][sourceName]) {
  if (!Array.isArray(values) || !values.length) throw new Error(`Invalid reviewed alias ${name}`);
  return { group, name, sourceName, sourceSha256: sha256(JSON.stringify(definitions.codeItems[group][sourceName])), values };
}
function tasks(suffix, replacements) {
  const original = byId.get(`rs3:task:${suffix}`).record.Tasks;
  for (const [before, after] of Object.entries(replacements)) if (!Object.hasOwn(original, before) || !definitions.challenges[original[before]]?.[after]) throw new Error(`Unverified direct replacement: ${before}`);
  return Object.fromEntries(Object.entries(original).map(([label, category]) => [replacements[label] ?? label, category]));
}
review('000ba0', 'Second-age mage set', 'Correct the alias spelling to the existing exact SecondAgeMageArmour group; membership stays explicit.', { Items: ['SecondAgeMageArmour[+]'] });
review('000c84', 'Portent of item protection', 'Use the documented four-dose prayer potion input; lower doses do not prove this recipe.', { Items: ['Luminous energy*', 'Prayer potion (4)*'] });
review('000cf1', 'Chaotic guard', 'Correct the exact retained ChaoticNecroWeapon alias; membership stays explicit.', { Items: ['ChaoticNecroWeapon[+]'] });
review('000cf8', 'Chaotic rapier frozen dye kit', 'Repair the missing alias suffix using the exact retained frozen dye variants.', {}, [alias('itemsPlus', 'Frozen dye kit[+]', 'Frozen dye kit')]);
review('000cf9', 'Chaotic rapier warped dye kit', 'Repair the missing alias suffix using the exact retained warped dye variants.', {}, [alias('itemsPlus', 'Warped dye kit[+]', 'Warped dye kit')]);
for (const suffix of ['0013b6', '0013b7', '0013b8', '0013b9', '0013ba', '0013bb', '0013bc', '0013bd']) review(suffix, 'Oily bakami', 'Hunter 90 Arc kami is members-only. Retain unsupported: the Bakami rule category and rare roaming source admission have no exact implementation; no output or training proof is admitted.');
review('001669', 'Staff of limitless air', 'Repair the alias suffix using exact retained limitless staff variants and explicitly require members.', {}, [alias('itemsPlus', 'LimitlessStaff[+]', 'LimitlessStaff')]);
review('0017b9', 'Ancient cloak', 'Repair the alias suffix using exact retained god-cloak variants and explicitly require members.', {}, [alias('itemsPlus', 'VestmentCloak[+]', 'VestmentCloak')]);
review('001904', "Greater Death's Swiftness", 'Retain unsupported: its nonexistent Magic prerequisite is not replaced with a guessed prerequisite. The codex is Ranged; exact personal ability-unlock semantics remain unreviewed.');
const ordinaryRobes = Object.keys(definitions.shopItems['Runecrafting Guild Rewards']).filter(name => /^Runecrafter (gloves|hat|robe|skirt) \(/.test(name));
if (ordinaryRobes.length !== 12) throw new Error('Review changed ordinary cosmetic robe shop variants.');
review('0019c5', 'Runecrafter robes', 'Ordinary cosmetic runecrafter robes and Great Orb Project are F2P, including cosmetic purchases by Ironmen. Use all twelve exact retained cosmetic shop variants and exclude members-only Master robe pieces; retain RC50 as the acquisition goal gate.', { Items: ['OrdinaryRunecrafterRobe[+]'], 'Not F2P': false }, [alias('itemsPlus', 'OrdinaryRunecrafterRobe[+]', 'RunecrafterRobe[+]', ordinaryRobes)]);
review('001c0e', 'Chaotic essence', 'Only melee chaotic weapons can be extracted into chaotic essence; ranged, magic and necromancy variants do not prove the output.', { Items: ['ChaoticMeleeWeapon[+]*'] });
review('002eff', 'Varrock achievements', 'The complete Hard Varrock set is members-only. Wiki redirects explicitly map But It Won’t Warp You Anywhere to Security Isn’t a Dirty Word and Changing Rooms to Make a House a Home; use those exact existing current objective rows.', { Tasks: tasks('002eff', { "~|Varrock Achievements#Hard|~ But It Won't Warp You Anywhere": "~|Varrock Achievements#Hard|~ Security Isn't a Dirty Word", '~|Varrock Achievements#Hard|~ Changing Rooms': '~|Varrock Achievements#Hard|~ Make a House a Home' }) });
review('003150', 'Scabaras Would Be Proud', 'The exact retained target and current Wiki objective both name Scabaras, not Scarabas.', { Tasks: tasks('003150', { '~|Combat Mastery achievements#Elite|~ Scarabas Would Be Proud': '~|Combat Mastery achievements#Elite|~ Scabaras Would Be Proud' }) });
review('0032b1', 'A Mini Shipment', 'Correct Mini Shopment to the retained Mini Shipment objective (loot Aminishi trunk), and remove the accidental trailing space on Flippers.', { Tasks: tasks('0032b1', { '~|Completionist achievements#Master Quest Cape|~ A Mini Shopment': '~|Completionist achievements#Master Quest Cape|~ A Mini Shipment', '~|Completionist achievements#Master Quest Cape|~ Flippers ': '~|Completionist achievements#Master Quest Cape|~ Flippers' }) });
review('0032ec', 'Music Maestro', 'Retain unsupported: its nine mysteries references use the wrong achievement category. Full mystery completion is not equivalent to unlocking music, so a category redirect would silently retain unverified extra gates.');
review('003318', 'It Still Should Have Been Called Aetherium', 'Use the exact retained and current Wiki objective name for unlocking masterwork swords through primal +5 armour.', { Tasks: tasks('003318', { '~|Completionist achievements#Completionist Cape|~ It Should Still Have Been Called Aetherium': '~|Completionist achievements#Completionist Cape|~ It Still Should Have Been Called Aetherium' }) });
review('003356', 'Reaper Crew', 'Retain unsupported: All Bosses is a missing Nonskill aggregate. The current kill list and personal boss completion need a reviewed model; removing this gate would invent completion proof.');
for (const suffix of ['003441', '003442']) review(suffix, 'Construction Contracts', 'Use the existing exact singular Construction Contract alias, preserving all retained contract locations.', { Chunks: ['Construction Contract[+]'] });
review('003480', 'Tirannwn achievements', 'Correct Medium achievements capitalisation to the exact existing Medium Achievements completion row.', { Tasks: tasks('003480', { '~|Tirannwn Achievements#Medium|~ Complete the Medium achievements': '~|Tirannwn Achievements#Medium|~ Complete the Medium Achievements' }) });
review('003531', 'Imcando at a Tree', 'Correct Imcadno to the exact retained Imcando achievement and Wiki objective, combining the hatchet with Thurgo.', { Tasks: tasks('003531', { '~|Skills achievements#Woodcutting|~ Imcadno at a Tree': '~|Skills achievements#Woodcutting|~ Imcando at a Tree' }) });
for (const suffix of ['0035da', '00423c']) review(suffix, 'The Distracted (title)', 'Retain unsupported: the Fur ’n Seek wish-list lore completion task is absent. Quest completion is not equivalent to finishing its separate wish list; no substitute is admitted.');
review('003fa0', 'Cave bug', 'Retain unsupported: CaveBug alternative group is absent, and current versus retained cave-bug level variants and soul eligibility require a reviewed mapping.');
for (const suffix of ['004876', '004877']) review(suffix, 'Demon Flash Mob', 'This is live members-only content. Retain unsupported: the corresponding DemonFlashMob chunk alias is missing; no event geography or reward supply is invented.');
review('004a13', 'Creature of Fenkenstrain', 'Correct Fenkentrain to the exact retained Fenkenstrain step 7, preserving the graves step and all other clue gates.', { Tasks: tasks('004a13', { '~|Creature of Fenkentrain|~ 7': '~|Creature of Fenkenstrain|~ 7' }) });
if (new Set(rows.map(row => row.id)).size !== 34) throw new Error('Audit must review all 34 baseline tasks once.');
const bundle = { schemaVersion: 1, reviewedOn: '2026-10-13', provenance: { reference: 'rs3-chunkpicker-chunkinfo-export.json', referenceSha256: sha256RepositoryText(bytes), referenceHashMode: 'git-lf', generator: 'scripts/research/retained-unsupported-audit.mjs', generatorSha256: sha256RepositoryText(readFileSync(import.meta.filename)), method: 'All 34 compiled retained unsupported rows, bounded public Wiki revisions, exact-record aliases and task corrections; no private gameplay reads or writes.' }, wiki, corrections,
  audit: { retainedUnsupportedCount: 34, outputVarRows: unsupported.filter(row => row.record.OutputVar).length, f2pRows: rows.filter(row => row.membership === 'F2P').length, supportedRows: rows.filter(row => row.decision === 'support').length, keptHiddenRows: rows.filter(row => row.decision !== 'support').length, rows } };
writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: local, supported: bundle.audit.supportedRows, keptHidden: bundle.audit.keptHiddenRows, wikiPins: wiki.length }));
