import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wikiAliasItemFacts } from '../lib/item-membership-alias-evidence.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

const snapshots = ['items.json', 'item-followup.json', 'copied-save-items.json', 'copied-save-items-followup.json', 'copied-save-items-scroll.json'];
export const titles = [
  ['Herbert', 'Medium XP lamp', 'Sneakerpeeper', 'Wingsuit v1', 'Wingsuit v2', 'Ceremonial sword',
    "Artisans' Workshop Reward Shop", 'Gold amulet (unstrung)', 'Nothing', 'Racing boots', 'Revenant Spirit',
    'Runes for Slayer Dart', 'Slayer Rewards', 'Slayer', 'Starting horn', 'Super large egg', 'Timepiece',
    'Topiary hedge (bagged)', 'Garden Centre', "Faruq's Tools for Games"],
  ['Timepiece (running)', 'Timepiece (paused)', 'Timepiece (stopped)', 'Template:Slayer Rewards stock',
    "Template:Artisans' Workshop Reward Shop stock", 'Slayer Dart', 'Revenant Pet'],
  ['Crassian scuttler pet','Dragon trinket','Magma golem pet','Metallic dragon trinket','Player-Owned Port enhancer',
    'Scroll of excavating','Split dragontooth nekclace','Crassian scuttler','Magma golem','Split dragontooth necklace'],
  ['Tetch','Micah','Dragon trinkets','Metallic dragon trinkets','Player-owned ports enhancer','Player-owned port enhancer',
    'Scroll of excavation','Scroll of excavating (Dungeoneering)'],
  ['Scroll of restoration'],
];

/** Sequential bounded requests; build mode never accesses the network. */
export async function gatherMembershipItemReview(directory) {
  mkdirSync(directory, { recursive: true });
  for (const [index, batch] of titles.entries()) {
    const url = new URL('https://runescape.wiki/api.php');
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...(index < 2 ? { redirects: '1' } : {}),
      prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: batch.join('|') });
    const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerMembershipReview/1.0 (bounded personal audit)' }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(JSON.stringify(payload.error));
    writeFileSync(join(directory, snapshots[index]), JSON.stringify({ requestedTitles: batch, payload }) + '\n');
  }
}

export function buildMembershipItemReview({ directory = '.local/game-data/membership-review-2026-10-12-v1', output = 'app/data/item-membership-review.2026-10-12.v1.json' } = {}) {
  const artifacts = snapshots.map(file => {
    const bytes = readFileSync(join(directory, file));
    return { file, sha256: sha256(bytes), data: JSON.parse(bytes) };
  });
  const pages = new Map(artifacts.flatMap(row => row.data.payload.query.pages).map(page => [page.title, page]));
  const text = title => pages.get(title)?.revisions?.[0]?.slots.main.content ?? '';
  const pin = title => {
    const revision = pages.get(title)?.revisions?.[0];
    if (!revision) throw new Error(`No pinned revision: ${title}`);
    return { title, revid: revision.revid, timestamp: revision.timestamp, url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, contentSha256: sha256(text(title)) };
  };
  const requireText = (title, literal) => {
    if (!text(title).includes(literal)) throw new Error(`Review evidence drift: ${title}: ${literal}`);
    return pin(title);
  };
  const item = (name, title, members, ids, reason, extra = {}) => {
    const facts = wikiAliasItemFacts(pages.get(title));
    const variants = facts.boxes.flatMap(box => box.variants);
    // Historical pages use histid or omit IDs. Never replace them with a guessed cache ID.
    if (ids.length ? !ids.every(id => variants.some(row => row.id === id && row.members === members))
      : !facts.boxes.some(box => /^(yes|true)$/i.test(box.fields.members ?? '') === members && /^(yes|no|true|false)$/i.test(box.fields.members ?? ''))) {
      throw new Error(`Typed Item evidence differs: ${name}`);
    }
    return { name, kind: 'item', members, status: members ? 'members' : 'free', ids, reason, wiki: pin(title), ...extra };
  };
  const catalogueFile = 'app/data/item-membership.2026-10-08.v1.json';
  const catalogueBytes = readFileSync(catalogueFile), catalogue = JSON.parse(catalogueBytes);
  const conflicts = [
    ['Herbert', true, [38095]], ['Medium XP lamp', false, [23714]], ['Sneakerpeeper', true, [19895]],
    ['Wingsuit v1', true, [49381, 50120]], ['Wingsuit v2', true, [49382, 50121]],
  ].map(([name, members, ids]) => {
    const prior = catalogue.entries.find(row => row.name === name);
    if (!prior?.wikiDisagreement) throw new Error(`Expected dated cache conflict: ${name}`);
    return item(name, name, members, ids, 'reviewed-wiki-over-cache-conflict', {
      cacheEvidence: { freeIds: prior.freeIds, memberIds: prior.memberIds, disagreement: prior.wikiDisagreement },
      ...(name === 'Medium XP lamp' ? { availability: 'historical-treasure-hunter-source-removed' } : {}),
    });
  });
  const aliases = [item('Gold amulet(unstrung)', 'Gold amulet (unstrung)', false, [1673], 'reviewed-picker-spelling'),
    item('Racing boots', 'Racing boots', false, [15065], 'reviewed-historical-item', { availability: 'removed-2014-12-08' }),
    item('Starting horn', 'Starting horn', false, [15067], 'reviewed-historical-item', { availability: 'removed-2014-12-08' }),
    item('Super large egg', 'Super large egg', false, [], 'reviewed-historical-item', { historicalIds: [15412], availability: 'removed-2026-02-16' }),
    item('Topiary hedge (bagged)', 'Topiary hedge (bagged)', true, [], 'reviewed-historical-item', { availability: 'removed-2026-07-13' }),
  ];
  requireText('Super large egg', '|histid = 15412');
  requireText('Super large egg', '|removal = [[16 February]] [[2026]]');
  requireText('Topiary hedge (bagged)', '|removal = [[13 July]] [[2026]]');
  for (const name of ['Racing boots','Starting horn']) requireText(name, '|removal = [[8 December]] [[2014]]');
  const stateItems = ['Timepiece (stopped)', 'Timepiece (running)', 'Timepiece (paused)'].map((title, index) =>
    item(title, title, false, [[15061], [15063], [15064]][index], 'reviewed-item-state'));
  requireText('Timepiece', '* {{plink|Timepiece (stopped)}}');
  aliases.push({ name: 'Timepiece', kind: 'item-family', members: false, status: 'free', ids: stateItems.flatMap(row => row.ids),
    reason: 'reviewed-free-item-state-family', wiki: pin('Timepiece'), variants: stateItems });
  const spirit = item('Revenant Spirit', 'Revenant Spirit', true, [47660], 'reviewed-revenant-progress-item');
  requireText('Revenant Spirit', 'automatically unlocks the next skin');
  const stages = ['Cyclops', 'Dark beast', 'Demon', 'Dragon', 'Goblin', 'Hellhound', 'Hobgoblin', 'Icefiend', 'Knight', 'Ork', 'Pyrefiend', 'Vampyre', 'Werewolf'];
  aliases.push(...stages.map(stage => ({ ...spirit, name: `Revenant Spirit#${stage}`, kind: 'progress-item',
    reason: 'reviewed-revenant-pet-stage', stage, supportingWiki: pin('Revenant Pet') })));
  requireText('Nothing', "'''Nothing''', also known as an empty roll");
  const entities = [{ name: 'Nothing', kind: 'empty-outcome', members: null, status: 'not-applicable', ids: [],
    reason: 'reviewed-empty-drop-outcome', wiki: pin('Nothing') }];
  requireText('Ceremonial sword', 'It is a members-only activity. Free players can only view the tutorial via Egil.');
  requireText("Artisans' Workshop Reward Shop", 'All rewards can be bought in [[free-to-play]]');
  requireText("Template:Artisans' Workshop Reward Shop stock", 'name=Ceremonial Swordsmith I');
  entities.push({ name: 'Ceremonial sword', kind: 'method-capability', members: null, status: 'not-applicable', ids: [], membersToUse: true,
    reason: 'reviewed-member-sword-creation-capability', wiki: pin('Ceremonial sword'),
    supportingWiki: [pin("Artisans' Workshop Reward Shop"), pin("Template:Artisans' Workshop Reward Shop stock")],
    distinction: 'Retained ingredient represents sword creation, not purchasing the free Swordsmith reward upgrade.' });
  requireText('Template:Slayer Rewards stock', 'text=Runes for Slayer Dart');
  requireText('Template:Slayer Rewards stock', 'displayname=Slayer XP');
  entities.push({ name: 'Runes for Slayer Dart', kind: 'reward-bundle', members: false, status: 'free', ids: [],
    reason: 'reviewed-free-rune-bundle', wiki: pin('Template:Slayer Rewards stock'),
    components: ['Air rune', 'Death rune'], distinction: 'A reward bundle, not a spell or a physical item. Spell membership cannot ban its free component runes.' });
  requireText('Slayer', 'Non-members can get tasks from [[Turael]] and [[Jacquelyn]] and train Slayer up to level 5.');
  entities.push({ name: 'Slayer XP', kind: 'experience-reward', members: false, status: 'free', ids: [],
    reason: 'reviewed-trial-skill-experience', wiki: pin('Slayer'), supportingWiki: [pin('Slayer Rewards'), pin('Template:Slayer Rewards stock')],
    distinction: 'Experience is not an inventory item; free Slayer training stops at level 5. Reward-source availability remains a separate source policy.' });
  const entries = [...conflicts, ...aliases, ...entities];
  const cacheById = new Map(catalogue.entries.flatMap(row => [...row.freeIds.map(id => [id,{name:row.name,members:false}]),
    ...row.memberIds.map(id => [id,{name:row.name,members:true}])]));
  const additional = [
    ['Crassian scuttler pet','Tetch',true,[47540,47541],'Crassian scuttler pet'],
    ['Dragon trinket','Dragon trinkets',false,[34808],'Dragon trinket'],
    ['Magma golem pet','Micah',true,[43395,43396],'Magma golem pet'],
    ['Metallic dragon trinket','Metallic dragon trinkets',false,[37193],'Metallic dragon trinket'],
    ['Player-Owned Port enhancer','Player-owned ports enhancer',true,[32719,34171],'Player-owned port enhancer'],
    ['Scroll of excavating','Scroll of restoration',true,[61429],null],
    ['Split dragontooth nekclace','Split dragontooth necklace',true,[19887],null],
  ].map(([name,title,members,ids,redirect]) => {
    const cacheEvidence = ids.map(id => ({id,...cacheById.get(id)}));
    if (cacheEvidence.some(row => !row.name)) throw new Error(`Additional alias lacks literal ordinary cache ID: ${name}`);
    const disagrees = cacheEvidence.some(row => row.members !== members);
    const row = item(name,title,members,ids,disagrees ? 'reviewed-wiki-over-cache-conflict' : 'reviewed-picker-alias', {
      cacheEvidence: { selected: cacheEvidence, freeIds: cacheEvidence.filter(row => !row.members).map(row => row.id),
        memberIds: cacheEvidence.filter(row => row.members).map(row => row.id) },
      ...(redirect ? { supportingWiki: [requireText(redirect, `[[${title}]]`)] } : {}),
    });
    if (name === 'Scroll of excavating') requireText(title, 'with the name "scroll of excavating"');
    return row;
  });
  // Canonical names must not bypass the same reviewed physical pet-token IDs.
  const supplementary = additional.filter(row => ['Tetch','Micah'].includes(row.wiki.title)).map(row => ({ ...row, name: row.wiki.title, aliasFor: row.name }));
  entries.push(...additional,...supplementary);
  const referenceFile = 'rs3-chunkpicker-chunkinfo-export.json', referenceBytes = readFileSync(referenceFile), reference = JSON.parse(referenceBytes);
  const sourceRows = Object.entries(reference.challenges.Extra).filter(([label, record]) =>
    /Obtain (?:any |an? )~\|(?:off-hand )?(?:iron|steel|mithril|adamant|rune) ceremonial sword/.test(label)
    && record.Items?.includes('Ceremonial sword')).map(([source, record]) => ({
    kind: 'Task', source, category: 'Extra', members: true, status: 'verified-row',
    beforeRecordSha256: sha256(JSON.stringify(record)), identity: 'exact-retained-sword-creation-goal',
    wiki: { title: 'Ceremonial sword', revisionId: pin('Ceremonial sword').revid, url: pin('Ceremonial sword').url },
  }));
  const result = { schemaVersion: 1, id: 'membership-item-review:2026-10-12:v1', reviewedOn: '2026-10-12',
    policy: 'Exact reviewed identities only. Wiki Item decisions override the five dated cache conflicts and two additional pet-token conflicts without changing raw flags. Literal Item IDs, canonical redirects and recorded cache names distinguish these tokens from NPC/Monster homonyms. Historical membership does not assert current acquisition. Virtual rewards and empty outcomes are typed separately. Custom catalogues never inherit this review.',
    provenance: { catalogue: { path: catalogueFile, sha256: sha256RepositoryText(catalogueBytes) },
      reference: { path: referenceFile, sha256: sha256RepositoryText(referenceBytes) },
      generator: { path: 'scripts/research/membership-item-review.mjs', sha256: sha256RepositoryText(readFileSync(import.meta.filename)) },
      libraries: ['scripts/lib/item-membership-alias-evidence.mjs', 'scripts/lib/provenance-hash.mjs', 'app/data/item-membership-index.mjs'].map(path => ({ path, sha256: sha256RepositoryText(readFileSync(path)) })),
      artifacts: artifacts.map(({ file, sha256 }) => ({ file, sha256 })) },
    summary: { cacheConflicts: conflicts.length, residualLabels: aliases.length + entities.length, members: entries.filter(row => row.members === true).length,
      free: entries.filter(row => row.members === false).length, notApplicable: entries.filter(row => row.status === 'not-applicable').length,
      additionalCopiedSaveLabels: additional.length, additionalCacheDisagreements: additional.filter(row => row.reason === 'reviewed-wiki-over-cache-conflict').length,
      supplementaryPhysicalNames: supplementary.length, memberCreationGoals: sourceRows.length }, entries, sourceRows };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'gather') await gatherMembershipItemReview(process.argv[3] ?? '.local/game-data/membership-review-2026-10-12-v1');
  else console.log(JSON.stringify(buildMembershipItemReview().summary));
}
