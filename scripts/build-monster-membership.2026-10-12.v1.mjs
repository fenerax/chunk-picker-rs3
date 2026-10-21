import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
import { sourceIdentityName, sourceInfobox } from './lib/source-membership-evidence.mjs';
import { monsterInfoboxes, monsterVariantMembership, monsterVariants } from './lib/monster-membership-evidence.mjs';
const dir = '.local/game-data/monster-membership-2026-10-12-v1';
const original = JSON.parse(readFileSync('app/data/source-membership.2026-10-08.v1.json'));
const npcDefinitions = JSON.parse(readFileSync('app/data/cache-npcs.2026-10-08.v1.json'));
const definitions = JSON.parse(readFileSync('rs3-chunkpicker-chunkinfo-export.json'));
const requests = JSON.parse(readFileSync(`${dir}/requests.json`));
const pages = new Map(), aliases = new Map(), artifacts = [];
for (const file of readdirSync(dir).filter(file => /^(batch-|extra-).*\.json$/.test(file)).sort()) {
  const path = `${dir}/${file}`, bytes = readFileSync(path), data = JSON.parse(bytes);
  artifacts.push({ path, sha256: sha256(bytes) });
  for (const row of [...data.query.normalized ?? [], ...data.query.redirects ?? []]) aliases.set(sourceIdentityName(row.from), row.to);
  for (const page of Object.values(data.query.pages)) if (page.revisions?.length || !pages.has(sourceIdentityName(page.title))) pages.set(sourceIdentityName(page.title), page);
  for (const page of Object.values(data.query.pages)) {
    const redirect = /^\s*#redirect\s*\[\[([^\]#]+)(?:#[^\]]*)?\]\]/i.exec(page.revisions?.[0].slots.main['*'] ?? '');
    if (redirect) aliases.set(sourceIdentityName(page.title), redirect[1]);
  }
}
const knownRevisions = new Map();
const knownPages = new Map();
for (const file of readdirSync(dir).filter(file => /^known-\d+\.json$/.test(file)).sort()) {
  const path = `${dir}/${file}`, bytes = readFileSync(path), data = JSON.parse(bytes);
  artifacts.push({ path, sha256: sha256(bytes) });
  for (const page of Object.values(data.query.pages)) for (const revision of page.revisions ?? []) {
    knownRevisions.set(revision.revid, { page, revision });
    knownPages.set(sourceIdentityName(page.title), { ...page, revisions: [revision] });
  }
}
for (const file of readdirSync(dir).filter(file => /^search-\d+\.json$/.test(file)).sort()) {
  const path = `${dir}/${file}`; artifacts.push({ path, sha256: sha256(readFileSync(path)) });
}
const resolve = title => { const seen = new Set(); while (aliases.has(sourceIdentityName(title)) && !seen.has(title)) { seen.add(title); title = aliases.get(sourceIdentityName(title)); } return pages.get(sourceIdentityName(title))?.revisions?.length ? pages.get(sourceIdentityName(title)) : knownPages.get(sourceIdentityName(title)) ?? pages.get(sourceIdentityName(title)); };
const baseName = text => sourceIdentityName(text.split('#')[0].replace(/ \([^)]*\)$/, ''));
const placements = source => Object.entries(definitions.chunks).flatMap(([location, record]) => [['', record], ...Object.entries(record.Sections ?? {})]
  .filter(([, section]) => Object.hasOwn(section.Monster ?? {}, source)).map(([section]) => ({ location, section, ...(record.Name ? { name: record.Name } : {}), ...(record.Nickname ? { nickname: record.Nickname } : {}) })));
const titleOverrides = {
  'Chinchompa': 'Chinchompa (Hunter)', 'Crystal skillchompa': 'Crystal skillchompa (Hunter)',
  'Cobalt skillchompa': 'Cobalt skillchompa (Hunter)', 'Azure skillchompa': 'Azure skillchompa (Hunter)',
  'Crimson skillchompa': 'Crimson skillchompa (Hunter)', 'Viridian skillchompa': 'Viridian skillchompa (Hunter)',
  'The Kendal': 'The Kendal (monster)', 'Necromancer': 'Necromancer (monster)', 'Zamorak mage': 'Zamorak mage (monster)',
  'Abyssal savages': 'Abyssal savage', 'Ripper dinosaurs': 'Ripper dinosaur',
  'Mefis, the jailer': 'Mefis, the Jailer', 'Red deadly spider': 'Deadly red spider',
  'Shadow': 'Shadow (Temple of Light)', 'Twig': 'Twig (monster)', 'Rock': 'Rock (monster)',
  'Warrior': 'Warrior (Rellekka)', 'Soldier': 'Soldier (Yanille)',
  'Lumbridge guard': 'Lumbridge guard (attackable)', 'Bull': 'Bull (monster)',
  'Thora': 'Thora (Miscellania Castle)', 'False User': 'False User (One of a Kind)',
  'Lava monster': 'Lava monster (TokTz-Ket-Dill)',
  'Penguin': 'Penguin (monster)',
  'Archer': 'Archer (Ardougne)', 'Barrows': 'The Barrows Brothers',
  'Bandit': 'Bandit (Kharidian Desert Bandit Camp)',
};
// Explicit identity reviews, not a general permission to treat NPCs as monsters.
// These are exact same-name NPCs already retained under Monster; this changes
// membership admission only and does not manufacture attackability or drops.
const npcEntityReviews = new Set(['Ragnar', 'Troll father', 'Troll mother', 'Tarik', 'Veliaf Hurtz', 'Golden poison frog', 'Phantasmal poison frog', 'Sky-blue poison frog', 'Croesus', 'The Gate of Elidinis', 'Villager', 'Customs Officer']);
const variantReviews = {
  'Crawling hand#Burthorpe': ['Level 6 (1)'],
  'Dwarf#Keldagrim': ['Standard (2)'],
  'Cow#Burthorpe': ['Standard (1)', 'Standard (2)', 'Standard (3)'],
  'Jungle spider#Jade Vine Maze': ['Jade Vine (level 42)', 'Jade Vine (level 49)'],
  'The Untouchable': ['Dominion Tower'],
  'Rasial, the First Necromancer': ['Normal'],
  'Hermod, the Spirit of War': ['Normal'],
};
const identityReviews = {
  'Warrior': 'Retained West Rellekka placement and the Rellekka resident cluster select Warrior (Rellekka), whose Monster name is Warrior; unrelated Lost City and Citadel warriors are not used.',
  'Archer': 'All six retained Archers occur at authored Ardougne Castle (10291), matching the six castle archers on Archer (Ardougne); Burthorpe NPC archers are not used.',
  'Soldier': 'The retained West Yanille section contains Colonel Radick and 16 Soldiers; Soldier (Yanille) documents that attackable Yanille troop.',
  'Shadow': 'Both retained placements explicitly name Mourner Tunnels & Temple of Light, selecting Shadow (Temple of Light) rather than other shadow encounters.',
  'Twig': 'The named Troll Stronghold placement and the typed Twig (monster) identify the guard troll, excluding the human and item homonyms.',
  'Rock': 'The uniquely typed Rock (monster) names the attackable Death Plateau troll. The Rocks scenery redirect is excluded; the source remains intrinsically free.',
  'Thora': 'Thora (Miscellania Castle) is the typed attackable Monster entity; Thora (Miscellania Dungeon) and Thora the Barkeep are NPC homonyms and do not supply this policy.',
  'Lava monster': 'The retained TzHaar Caves label pairs two Lava monsters with two Fire monsters; the TokTz-Ket-Dill monster article documents that quest-cave entity rather than Elder Kiln or Lava Flow Mine variants.',
  'Bull': 'Retained Marigold Farm (16947) selects the typed wild Bull (monster) in Havenhythe, which is free. The Player Owned Farm Bull NPC/item page is excluded.',
  'False User': 'Both authored placements explicitly name Zamorak\'s hideout. False User (One of a Kind) names the attackable apparitions found there; the generic lore term is excluded.',
  'Penguin': 'The typed Penguin (monster) documents the attackable Here Be Penguins and Ardougne Zoo entities. Item, race, hunter and Hide and Seek homonyms are excluded.',
  'Crawling hand#Burthorpe': 'The page explicitly identifies Burthorpe Slayer Cave and ID 1648 (Level 6 (1)) as the free variant; all other hand variants remain separate.',
  'Dwarf#Keldagrim': 'The exact Keldagrim drop family is documented as the Standard (2), ID 120 entity. Its own infobox member field is Yes.',
  'Cow#Burthorpe': 'The ordinary Burthorpe cattle select Standard variants with free fields and IDs 81/14997/14998/14999. The member Zanaris entity (3309) is excluded.',
  'Jungle spider#Jade Vine Maze': 'The retained selector selects both Jade Vine variants (IDs 6377 and 6376), each explicitly members-only; the free Musa Point variant is excluded.',
  'The Untouchable': 'The only authored source is Dominion Tower (14950). The pinned Dominion Tower variant has members No and IDs 14485/14556; Dream Mentor remains a separate member variant.',
  'Rasial, the First Necromancer': 'The retained source has ordinary repeatable boss drops and selects Normal, members No. The article explicitly states normal F2P combat since July 2025 after prior member quest completion; Alpha vs Omega remains a member quest.',
  'Hermod, the Spirit of War': 'The retained source has ordinary repeatable boss drops and selects Normal, members No. The article explicitly states F2P combat since July 2025 after prior The Spirit of War completion; the quest variant remains member.',
  'Suspicious water': 'The pinned Spinolyp article explicitly describes transformation into level 15 Suspicious water; this is an entity-state alias, not a guess from a water scenery name.',
  'Bandit': 'The only retained placement is Tumeken\'s Remnant (13102-1). Bandit (Kharidian Desert Bandit Camp) explicitly documents the same bandits extending to Tumeken\'s Remnant, with IDs 1926/1931 and members Yes.',
  'Mummy': 'Retained Chaos Tunnels (12629) and Jaldraocht Pyramid (12945) match Mummy (Jaldraocht Pyramid), IDs 1960..1968. The pinned Little Helper Pyramid redirect identifies the remaining 13199 placement as Klenter\'s Pyramid, matching Mummy (Klenter\'s Pyramid), IDs 2015..2019. Both entities are member; this consensus covers every retained placement.',
  'Elf': 'The sole authored Elf placement is Arandar (9267-1). Both the attackable Elf warrior family and the unattackable Arandar Elf warrior NPC are explicitly members-only. This consensus decides the retained source membership without choosing an NPC ID or asserting attackability.',
  'Guard': 'The main Guard article explicitly names six combat/pickpocket subfamilies, with free and member Monster infoboxes. The unnamed retained placements do not choose a city or NPC ID, so only mixed-family classification is justified.',
  'Troll': 'The Troll disambiguation identifies free combat trolls alongside member NPC-only troll entities. Troll brute and Mountain troll are explicitly free; Barendir trolls are member NPCs with Examine only. The unnamed retained placement (3413) has no NPC ID. This cross-kind family is mixed, while the exact retained combat identity remains unresolved; no global member ban is justified.',
  'Monsters in Daemonheim': 'This is a monster aggregate inside Dungeoneering, not a single NPC. Dungeoneering explicitly admits both F2P and members and has member content scopes. The monster list identifies the family; it does not select an individual spawn, NPC ID or floor.',
};
const wikiRecord = (page, boxes = []) => {
  const revision = page?.revisions?.[0];
  return revision ? { title: page.title, revisionId: revision.revid, revisionTimestamp: revision.timestamp, url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, infobox: boxes[0]?.type ?? null, memberValues: boxes.flatMap(box => box.memberFields.map(([, value]) => value)) } : null;
};
const composedReviews = {
  'Giant skeleton': ["Giant skeleton (Shadow Dungeon)", "Giant skeleton (Tarn's Lair)"],
  'Twin Furies': ['Nymora, the Vengeful', 'Avaryss, the Unceasing'],
  'Twin Furies (Hard Mode)': ['Nymora, the Vengeful', 'Avaryss, the Unceasing'],
  'Barrows': ['Ahrim the Blighted', 'Dharok the Wretched', 'Guthan the Infested', 'Karil the Tainted', 'Torag the Corrupted', 'Verac the Defiled', 'Akrisae the Doomed', 'Linza the Disgraced'],
  'Barrows: Rise of the Six': ['Ahrim the Blighted', 'Dharok the Wretched', 'Guthan the Infested', 'Karil the Tainted', 'Torag the Corrupted', 'Verac the Defiled'],
  'Zemouregal & Vorkath': ['Vorkath'],
  'Zemouregal & Vorkath (Hard Mode)': ['Vorkath'],
  'Zemouregal & Vorkath (Story Mode)': ['Vorkath'],
  'Mummy': ['Mummy (Jaldraocht Pyramid)', "Mummy (Klenter's Pyramid)"],
};
const records = requests.requests.map(request => {
  const old = original.records.find(row => row.kind === 'Monster' && row.source === request.source);
  const title = titleOverrides[request.source] ?? request.title, page = resolve(title), revision = page?.revisions?.[0];
  const text = revision?.slots.main['*'] ?? '';
  const boxes = monsterInfoboxes(text).filter(box => box.type === 'Monster' || npcEntityReviews.has(request.source));
  const base = baseName(title);
  const cacheMatches = box => Object.entries(box.fields).filter(([field]) => /^id\d*$/.test(field)).flatMap(([, value]) => /^\d+(?:\s*,\s*\d+)*$/.test(value) ? value.split(',').map(Number) : [])
    .filter(id => npcDefinitions.records[request.source]?.candidates.some(candidate => candidate.id === id && sourceIdentityName(candidate.name) === base));
  const candidates = boxes.filter(box => box.names.includes(base) || box.names.includes(sourceIdentityName(title))
    || !box.names.length && sourceIdentityName(page.title) === sourceIdentityName(title) && cacheMatches(box).length);
  const box = candidates[0];
  let members = null, status = 'identity-unresolved', identity = 'missing-or-untyped-entity';
  if (box) {
    const selector = request.source.split('#')[1] ?? request.source.match(/\((Hard|Story) Mode\)$/)?.[1]?.concat(' mode');
    const reviewed = variantReviews[request.source]?.map(selector => monsterVariantMembership(box, selector));
    members = reviewed?.length && reviewed.every(value => value !== null && value === reviewed[0]) ? reviewed[0] : selector ? monsterVariantMembership(box, selector) : null;
    identity = members !== null ? 'exact-infobox-variant' : 'canonical-monster-name-and-page-qualifier';
    if (members === null) members = candidates.every(candidate => candidate.members !== null && candidate.members === box.members) ? box.members : null;
    if (box.type === 'NPC') identity = 'explicit-reviewed-retained-NPC-entity';
    if (!box.names.length) identity = 'canonical-Wiki-and-cache-NPC-ID';
    status = members === null ? 'reviewed-mixed-family' : 'verified-infobox';
  }
  let supportingWiki;
  let supportingVariants;
  const components = composedReviews[request.source];
  if (components) {
    const evidence = components.map(title => {
      const target = resolve(title), content = target?.revisions?.[0].slots.main['*'] ?? '';
      const boxes = monsterInfoboxes(content).filter(box => box.type === 'Monster' && box.names.includes(baseName(title)));
      return { boxes, wiki: wikiRecord(target, boxes) };
    });
    if (evidence.every(row => row.boxes.length && row.boxes.every(box => box.members === true))) {
      members = true; status = 'verified-row'; identity = 'explicit-composed-encounter-or-retained-entity-consensus';
      supportingWiki = evidence.map(row => row.wiki);
      supportingVariants = evidence.flatMap(row => row.boxes.flatMap(monsterVariants).map(variant => ({ ...variant, wikiTitle: row.wiki.title })));
    }
  }
  if (request.source === 'Guard') {
    const titles = ['Guard (Ardougne)', 'Guard (Falador)', 'Guard (Edgeville)', 'Guard (Varrock)', 'Port Sarim guard', 'Ranger'];
    const evidence = titles.map(title => {
      const target = resolve(title), boxes = monsterInfoboxes(target?.revisions?.[0].slots.main['*'] ?? '').filter(box => box.type === 'Monster');
      return { boxes, wiki: wikiRecord(target, boxes) };
    });
    if (evidence.every(row => row.boxes.length) && evidence.some(row => row.boxes.some(box => box.members === true)) && evidence.some(row => row.boxes.some(box => box.members === false))) {
      members = null; status = 'reviewed-mixed-family'; identity = 'explicit-combat-guard-family-with-mixed-typed-entities';
      supportingWiki = evidence.map(row => row.wiki);
      supportingVariants = evidence.flatMap(row => row.boxes.flatMap(monsterVariants).map(variant => ({ ...variant, wikiTitle: row.wiki.title })));
    }
  }
  if (request.source === 'Elf') {
    const names = ['Elf warrior', 'Elf warrior (Arandar)'];
    const evidence = names.map(title => {
      const target = resolve(title), boxes = monsterInfoboxes(target?.revisions?.[0].slots.main['*'] ?? '').filter(box => box.names.includes('elf warrior'));
      return { boxes, wiki: wikiRecord(target, boxes) };
    });
    if (placements(request.source).every(row => row.location === '9267' && row.section === '1' && row.nickname === 'Arandar')
      && evidence.every(row => row.boxes.length && row.boxes.every(box => box.members === true))) {
      members = true; status = 'verified-row'; identity = 'retained-Arandar-elf-family-membership-consensus';
      supportingWiki = evidence.map(row => row.wiki);
      supportingVariants = evidence.flatMap(row => row.boxes.flatMap(monsterVariants).map(variant => ({ ...variant, wikiTitle: row.wiki.title })));
    }
  }
  if (request.source === 'Troll') {
    const names = ['Troll brute', 'Mountain troll', 'Troll (Barendir)'];
    const evidence = names.map(title => {
      const target = resolve(title), boxes = monsterInfoboxes(target?.revisions?.[0].slots.main['*'] ?? '');
      return { boxes, wiki: wikiRecord(target, boxes) };
    });
    if (evidence.every(row => row.boxes.length) && evidence.some(row => row.boxes.some(box => box.members === false)) && evidence.some(row => row.boxes.some(box => box.members === true))) {
      members = null; status = 'reviewed-mixed-family'; identity = 'reviewed-troll-family-with-unresolved-retained-entity';
      supportingWiki = evidence.map(row => row.wiki);
      supportingVariants = evidence.flatMap(row => row.boxes.flatMap(monsterVariants).map(variant => ({ ...variant, wikiTitle: row.wiki.title })));
    }
  }
  if (request.source === 'Monsters in Daemonheim' && /open to both \[\[free-to-play\]\] players and \[\[members\]\]/.test(text)
    && /\{\{Members\|yes\}\}/i.test(text) && resolve('Dungeoneering/Monsters')?.revisions?.length) {
    members = null; status = 'reviewed-mixed-family'; identity = 'reviewed-Dungeoneering-monster-aggregate';
    supportingWiki = [wikiRecord(page), wikiRecord(resolve('Dungeoneering/Monsters'))];
  }
  if (request.source === 'Suspicious water' && /Spinolyps will turn into level 15 suspicious water/.test(text)) {
    const entity = monsterInfoboxes(text).find(box => box.type === 'Monster' && box.names.includes('spinolyp'));
    if (entity?.members === true) { members = true; status = 'verified-row'; identity = 'explicit-named-monster-transformation'; supportingWiki = [wikiRecord(page, [entity])]; }
  }
  if (request.source === 'Monsters in Shattered Wrolds' && /Shattered Worlds.*?combat-oriented members-only/.test(text.replaceAll('\n', ' '))) {
    members = true; status = 'verified-row'; identity = 'exact-member-minigame-monster-aggregate';
  }
  if (request.source === 'Monsters in New Varrock' && sourceInfobox(text)?.type === 'Quest' && sourceInfobox(text).members === true
    && /quest takes place in.*?\[\[New Varrock\]\]/.test(text)) {
    members = true; status = 'verified-row'; identity = 'explicit-monster-aggregate-inside-member-quest';
  }
  const reason = status === 'reviewed-mixed-family' ? 'Family or activity identity reviewed with free and member scopes. No global member ban; retained locations and individual source/row gates remain necessary.'
    : status === 'identity-unresolved' ? 'No matching canonical Monster infobox; generic names, NPC/item pages and encounter aggregates need explicit identity evidence.'
      : status === 'verified-row' ? 'Explicit reviewed entity family, composed encounter, transformation or activity policy; supporting pinned evidence supplies the membership decision.'
        : box?.type === 'NPC' ? 'Explicit exact retained NPC entity review; the NPC member fields decide admission without creating attackability or drops.'
      : identity === 'exact-infobox-variant' ? 'Exact retained selector or explicitly reviewed ordinary encounter matches the infobox version and its own member field.'
        : 'Matching canonical Monster infobox name, typed page and unanimous recognized membership fields; qualifiers preserve this exact entity.';
  return { kind: 'Monster', source: request.source, title, members, status, identity, reason, before: { members: old.members, status: old.status },
    retainedPlacements: placements(request.source),
    variants: candidates.flatMap(monsterVariants),
    ...(supportingVariants ? { supportingVariants } : {}),
    ...(identityReviews[request.source] ? { identityReview: identityReviews[request.source] } : {}),
    ...(['Troll', 'Elf', 'Guard', 'Monsters in Daemonheim'].includes(request.source) ? { identityLimit: 'Family or activity membership is reviewed. The retained label does not establish an exact spawned NPC ID, combat capability or individual variant.' } : {}),
    ...(variantReviews[request.source] ? { selectedVariants: variantReviews[request.source] } : {}),
    ...(supportingWiki ? { supportingWiki } : {}),
    ...(request.source === 'Mummy' ? { identityWiki: [wikiRecord(resolve('Little Helper Pyramid'))] } : {}),
    ...(!box?.names.length && box ? { identityEvidence: { npcIds: cacheMatches(box) } } : {}),
    wiki: wikiRecord(page, candidates) };
});
const knownAudit = original.records.filter(row => row.kind === 'Monster' && row.members !== null).map(row => {
  const snapshot = knownRevisions.get(row.wiki.revisionId);
  if (!snapshot) throw new Error(`Missing pinned audit snapshot for ${row.source}`);
  const boxes = monsterInfoboxes(snapshot.revision.slots.main['*']).filter(box => box.type === 'Monster');
  const consensus = boxes.length && boxes.every(box => box.members === row.members);
  if (!consensus && row.source !== 'Goblin') throw new Error(`Existing policy needs explicit conflict review: ${row.source}`);
  return { source: row.source, members: row.members, status: consensus ? 'retained-pinned-consensus-audited' : 'retained-free-ordinary-variants-with-mixed-family',
    wiki: row.wiki, ...(consensus ? {} : { variants: boxes.flatMap(monsterVariants), reason: 'Ordinary Varrock/Port Sarim goblins are explicitly free. North-West Kandarin and member-area variants are explicitly member entities. Preserve ordinary free admission; this is not a universal family entitlement.' }) };
});
const inputPaths = ['rs3-chunkpicker-chunkinfo-export.json', 'app/data/source-membership.2026-10-08.v1.json', 'app/data/cache-npcs.2026-10-08.v1.json'];
const generatorPaths = ['scripts/gather-monster-membership.2026-10-12.v1.mjs', 'scripts/gather-monster-membership-identities.2026-10-12.v1.mjs', 'scripts/gather-known-monster-membership.2026-10-12.v1.mjs', 'scripts/gather-monster-membership-family-revisions.2026-10-12.v1.mjs', 'scripts/build-monster-membership.2026-10-12.v1.mjs', 'scripts/lib/monster-membership-evidence.mjs', 'scripts/lib/source-membership-evidence.mjs', 'scripts/lib/provenance-hash.mjs'];
const hashes = paths => paths.map(path => ({ path, sha256: sha256RepositoryText(readFileSync(path)) }));
const counts = { reviewed: records.length, members: records.filter(row => row.members === true).length, free: records.filter(row => row.members === false).length, mixedFamilies: records.filter(row => row.status === 'reviewed-mixed-family').length, unreviewedFamilyIdentity: records.filter(row => row.status === 'identity-unresolved').length, explicitExactIdentityLimits: records.filter(row => row.identityLimit).length, unknownBoolean: records.filter(row => row.members === null).length, retainedKnown: knownAudit.length, knownPinnedRevisions: knownRevisions.size };
const manifest = { verifiedOn: '2026-10-12', counts, requests: { path: `${dir}/requests.json`, sha256: sha256(readFileSync(`${dir}/requests.json`)) }, knownRequests: { path: `${dir}/known-revisions.json`, sha256: sha256(readFileSync(`${dir}/known-revisions.json`)) }, artifacts };
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
const dataset = { schemaVersion: 1, verifiedOn: '2026-10-12', policy: 'Focused exact Monster labels. Canonical typed entity or explicit reviewed alias/variant only. No geographical membership inference; mixed families have reviewed variants and no global Boolean restriction. Generic unresolved identity is separate. Existing pinned known Monster rows re-audited and retained separately.', counts, records, knownAudit, provenance: { inputs: hashes(inputPaths), generators: hashes(generatorPaths), snapshotManifest: { path: `${dir}/manifest.json`, sha256: sha256(readFileSync(`${dir}/manifest.json`)) } } };
writeFileSync('app/data/monster-membership-review.2026-10-12.v1.json', JSON.stringify(dataset, null, 2) + '\n');
const escape = value => String(value ?? '').replaceAll('|', '&#124;').replaceAll('\n', ' ');
const decision = row => row.members === true ? 'Member' : row.members === false ? 'Free' : row.status === 'reviewed-mixed-family' ? 'Reviewed mixed family' : 'Identity unresolved';
const citation = wiki => wiki ? `[${wiki.title}, ${wiki.revisionId}](${wiki.url})` : 'No matching typed page';
const oldRows = knownAudit.map(row => `| ${escape(row.source)} | ${row.members ? 'Member' : 'Free'} | ${escape(citation(row.wiki))} | ${row.status === 'retained-pinned-consensus-audited' ? 'All typed Monster infoboxes agree; retain pinned policy.' : escape(row.reason)} |`);
const newRows = records.map(row => `| ${escape(row.source)} | ${decision(row)} | ${escape(citation(row.wiki))} | ${escape(row.identityReview ?? row.identity)} |`);
const familyRows = records.filter(row => row.status === 'reviewed-mixed-family').flatMap(row => (row.supportingVariants ?? row.variants).length
  ? (row.supportingVariants ?? row.variants).map(variant => `| ${escape(row.source)} | ${escape(variant.wikiTitle ?? row.wiki?.title)} | ${escape(variant.version)} | ${variant.members === true ? 'Member' : variant.members === false ? 'Free' : 'Unrecognized/missing field'} | ${variant.npcIds.join(', ') || 'No numeric ID supplied'} |`)
  : [`| ${escape(row.source)} | ${escape(row.wiki?.title)} | Aggregate activity with F2P and member content scopes | Mixed; individual monsters not assigned a Boolean | No individual NPC identity supplied |`]);
const evidenceRows = records.filter(row => row.supportingWiki || row.identityWiki).flatMap(row => [...row.supportingWiki ?? [], ...row.identityWiki ?? []].filter(Boolean).map(wiki => `| ${escape(row.source)} | ${escape(citation(wiki))} | ${escape(wiki.infobox ?? 'Identity/encounter article')} |`));
const specificRows = records.filter(row => row.identityReview).map(row => `| ${escape(row.source)} | ${escape(row.identityReview)} | ${escape(citation(row.wiki))} |`);
const limitRows = records.filter(row => row.identityLimit).map(row => `| ${escape(row.source)} | ${escape(row.identityLimit)} | ${escape(row.identityReview)} |`);
const doc = `# Monster membership review — October 12, 2026

All 1,199 retained Monster labels have a recorded decision. This review re-read the 870 exact pinned revisions behind 895 existing policies and fetched current pages for all 304 formerly unresolved labels. The existing known policies remain separate from the focused runtime overlay.

| Formerly unresolved labels | Count |
| --- | ---: |
| Verified member | ${counts.members} |
| Verified free | ${counts.free} |
| Reviewed mixed family | ${counts.mixedFamilies} |
| Family identity unreviewed | ${counts.unreviewedFamilyIdentity} |
| Total | ${counts.reviewed} |

A mixed family is an identified source with explicit variant evidence. It has no global Boolean restriction. A missing identity is a different limitation. Both keep their existing geographic, quest, source and drop-row gates. A free intrinsic flag never grants entry to a member room, completes a quest, supplies a member item or makes every drop free.

The parser reads every typed Monster entity independently, including entities inside a Multi infobox. It uses fields at the entity's own depth and records each variant's membership and numeric NPC IDs. It never takes a membership field from a nested recipe or from an unrelated Item infobox. Named NPC exceptions are explicit reviews of the retained entity; they do not create combat capabilities. Ragnar, the troll parents, Tarik, Veliaf Hurtz, the three poison frogs, Croesus, the Gate of Elidinis, Villager and Customs Officer are retained under Monster even though their precise Wiki entity uses an NPC infobox.

The known audit found 894 labels whose typed Monster infoboxes unanimously preserve the prior policy. Goblin is the exception: ordinary Varrock/Port Sarim entities are free, while North-West Kandarin and member-area entities are members-only. Its ordinary free policy is retained and the family disagreement is recorded. It does not justify a global member ban or establish free access to every goblin variant.

Normal Rasial and Hermod are intrinsically free in the pinned variants. Their articles explicitly document F2P combat after prior member quest completion, following the July 2025 update. The ordinary repeatable source selects Normal; Alpha vs Omega and The Spirit of War remain separate quest requirements. Skill, quest, item and location gates still run.

The overlay changes intrinsic membership admission only. It does not move a source, rewrite a quantity or drop, alter a save, or infer spawned NPCs from cache names. The decoded cache is used only to corroborate exact NPC IDs where an infobox omits its name; its missing membership fields do not supply any decision. All runtime restrictions remain inactive when F2P is off.

The remaining exact-spawn limits are explicit below. A reviewed mixed family still needs a precise entity or location policy to exclude a member variant inside an otherwise accessible area. Family review does not claim that every authored placement has been reconciled to a current spawn ID.

| Retained label | Exact identity limit | Reviewed membership scope |
| --- | --- | --- |
${limitRows.join('\n')}

## Reproduction and provenance

Run the four gatherers and then the focused builder from the repository root:

\`\`\`powershell
node scripts/gather-monster-membership.2026-10-12.v1.mjs
node scripts/gather-monster-membership-identities.2026-10-12.v1.mjs
node scripts/gather-known-monster-membership.2026-10-12.v1.mjs
node scripts/gather-monster-membership-family-revisions.2026-10-12.v1.mjs
node scripts/build-monster-membership.2026-10-12.v1.mjs
\`\`\`

Requests use only the public RuneScape Wiki API, at most 40 titles or revisions per batch. Five searches return at most five titles each. Snapshots are local research evidence under .local/game-data/monster-membership-2026-10-12-v1. The generated dataset records retained input and generator hashes, exact snapshot hashes and the manifest hash. Repository text hashes normalize CRLF to LF; external snapshot hashes preserve original bytes. The focused builder produces both this review and app/data/monster-membership-review.2026-10-12.v1.json. Generated files must not be edited by hand.

## Exact identity and variant treatments

| Retained label | Identity or variant treatment | Pinned page |
| --- | --- | --- |
${specificRows.join('\n')}

## Decisions for all 304 formerly unresolved labels

| Retained label | Decision | Pinned page | Identity treatment |
| --- | --- | --- | --- |
${newRows.join('\n')}

## Mixed family variants

These rows identify free and member variants without assigning a blanket membership value to the retained family label. Unknown numeric IDs or missing fields stay explicit. The dataset preserves the complete structured evidence.

| Retained label | Entity page | Variant | Membership | NPC IDs |
| --- | --- | --- | --- | --- |
${familyRows.join('\n')}

## Supporting entity and identity evidence

Composed encounters use the member fields of their named combatants. An identity page or redirect only identifies the retained entity; geography does not supply a monster member flag.

| Retained label | Pinned evidence | Evidence type |
| --- | --- | --- |
${evidenceRows.join('\n')}

## Re-audited decisions for 895 existing known labels

Each row retains its original pinned decision after the new multi-entity parser checked that exact revision. The ordinary Goblin exception is stated in its row.

| Retained label | Decision | Pinned page | Audit result |
| --- | --- | --- | --- |
${oldRows.join('\n')}
`;
writeFileSync('docs/research/monster-membership-review-2026-10-12.md', doc);
console.log(counts);
console.log(records.filter(row => row.members === null).map(row => `${row.source}: ${row.wiki?.title ?? 'missing'} (${row.status})`).join('\n'));
