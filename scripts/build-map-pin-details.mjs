import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { categoryForCachePin } from '../app/data/map-pin-categories.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const inputFile = join(root, 'app/data/map-pin-details.inputs.2026-10-08.v1.json');
const wikiFile = join(root, 'app/data/map-pin-details.wiki.2026-10-08.v1.json');
const outputFile = join(root, 'archive/data/map-pin-details.2026-10-08.v1.json');
const hash = b => createHash('sha256').update(b).digest('hex');
const clean = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1').replace(/\{\{QuestIcon\|([^}]+)\}\}/g, '$1').trim();
const read = file => JSON.parse(readFileSync(file));
const jsonWrite = (file, data) => writeFileSync(file, `${JSON.stringify(data)}\n`);
const pages = ["Fishing spot (crayfish)", "Fishing spot (small fishing net, bait)", "Fishing spot (lure, bait)", "Fishing spot (big fishing net, harpoon)", "Fishing spot (cage, harpoon)", "Fishing spot (Piscatoris Fishing Colony)", "Fishing spot (Otto's Grotto)", "Fishing spot (Hemenster)", "Fishing spot (slimy eels)", "Fishing spot (Holy Lake)", "Fishing spot (Karambwan)", "Fishing spot (Menaphos)", "Fishing spot (Braindeath Island)", "Fishing spot (Prifddinas Waterfall)", "Fishing spot (hogfish)", "Fishing spot (claret crab)", "Giant crayfish (fishing spot)"];
const shopPages = [ ['Lumbridge General Store','general-store'], ["Gerrant's Fishy Business",'fishing-shop'], ["Aubury's Rune Shop",'magic-shop'], ["Betty's Magic Emporium",'magic-shop'], ['Lumbridge Fishing Supplies','fishing-shop'] ];
// Reviewed against multiple local coordinate rows. These are semantic associations
// of distinct encoded marker subtypes, not decoded or observed NPC placements.
const spotTypeByElement = {
  5104:'Fishing spot (crayfish)', 5106:'Fishing spot (small fishing net, bait)', 5107:'Fishing spot (lure, bait)',
  5108:'Fishing spot (big fishing net, harpoon)', 5109:'Fishing spot (cage, harpoon)', 5110:'Fishing spot (lure, bait)',
  5111:'Fishing spot (big fishing net, harpoon)', 5112:'Fishing spot (lure, bait)', 5113:'Fishing spot (big fishing net, harpoon)',
  5114:'Fishing spot (big fishing net, harpoon)', 5115:'Fishing spot (big fishing net, harpoon)', 5117:'Fishing spot (small fishing net, bait)',
  5118:'Fishing spot (cage, harpoon)', 5121:'Fishing spot (Holy Lake)', 5122:'Fishing spot (Karambwan)',
  5125:'Fishing spot (slimy eels)', 5126:"Fishing spot (Otto's Grotto)", 5128:'Fishing spot (Piscatoris Fishing Colony)',
  5133:'Fishing spot (Menaphos)', 5686:'Giant crayfish (fishing spot)', 5829:'Fishing spot (hogfish)', 5830:'Fishing spot (claret crab)',
};

// Capture only permitted, versioned export files. This never opens JS5 databases.
export function captureInputs(main = 'C:/Users/User/Projects/chunk-picker-rs3') {
  const pinPath = '.local/map-assets/pins.cache-2026-10-08-05932552f7af-v1.json';
  const defPath = '.local/game-data/objects-2026-10-08-v3/objects.definitions.v1.json.gz';
  const travelPath = '.local/game-data/places-2026-10-08-v3/travel.v1.json';
  const questPath = '.local/game-data/quests-achievements-2026-10-08-v2/quests.v1.json';
  const pins = read(join(main, pinPath)).pins;
  const objectIds = new Set(pins.map(p => p.source.objectId).filter(Number.isInteger));
  const defs = JSON.parse(gunzipSync(readFileSync(join(main, defPath)))).definitions;
  const travel = read(join(main, travelPath));
  const resources = read(join(root, 'app/data/cache-resources.2026-10-08.v1.json'));
  const resourcePins = pins.filter(p => ['rare-tree','mining-site'].includes(categoryForCachePin(p).id));
  const resourceRows = resources.placements.filter(row => /^(tree|ore):/.test(row[2]) && resourcePins.some(p => p.chunkId === row[3] && Math.hypot(p.x-row[4],p.y-row[5]) <= 32));
  const sources = [pinPath, defPath, travelPath].map(file => ({ file, sha256: hash(readFileSync(join(main, file))) }));
  sources.push({ file: 'app/data/cache-resources.2026-10-08.v1.json', sha256: sha256RepositoryText(readFileSync(join(root, 'app/data/cache-resources.2026-10-08.v1.json'))) });
  sources.push({file:questPath,sha256:hash(readFileSync(join(main,questPath)))});
  return { schemaVersion: 1, sources,
    pins: pins.map(p => ({ id: p.id, x: p.x, y: p.y, mapId: p.mapId, plane: p.plane, chunkId: p.chunkId,
      spriteId: p.spriteId, category: p.category, elementId: p.elementId, label: p.label, objectName: p.objectName,
      source: p.source, conditional: !!p.placementConditional || (p.conditions ?? []).some(c => c.kind !== 'uninterpreted-element-setting'),
      elementParams: p.elementDefinition.extra ?? [] })),
    definitions: defs.filter(d => objectIds.has(d.objectId)).map(d => ({ objectId: d.objectId, name: d.name, actions: d.actions,
      memberActions: d.memberActions, membersFlag: d.raw.is_members ?? d.raw.isMembers ?? null })),
    resources: { classes: resources.classes, columns: resources.schema.placementColumns, placements: resourceRows },
    lodestones: travel.lodestones.map(d => ({ structId: d.structId, name: d.name, description: d.description, membersCandidate: d.membersCandidate, coordinates: d.coordinates })),
    quests: read(join(main,questPath)).records.filter(q=>q.listEntry).map(q=>({id:q.id,name:q.name,members:q.members,questPoints:q.questPoints,
      difficulty:q.difficulty.label,sequence:q.raw.extra?.find(p=>p.prop===1345)?.intvalue ?? null,
      startGuidance:clean(q.raw.extra?.find(p=>p.prop===7814)?.stringvalue),
      startCoordinates:q.startLocationPath.map(packed=>({x:(packed>>>14)&16383,y:packed&16383,plane:packed>>>28})),source:q.source})),
  };
}

// Retain facts and coordinate rows, not entire copyrighted Wiki articles.
export async function captureWiki() {
  const rows = [];
  for (const title of pages) {
    const url = new URL('https://runescape.wiki/api.php');
    for (const [key, value] of Object.entries({ action: 'query', prop: 'revisions', rvprop: 'ids|content', rvslots: 'main', format: 'json', titles: title })) url.searchParams.set(key, value);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Wiki ${title}: HTTP ${response.status}`);
    const data = await response.json(), page = Object.values(data.query.pages)[0], revision = page.revisions?.[0];
    if (!revision) continue;
    const text = revision.slots.main['*'];
    const field = key => clean(text.match(new RegExp(`^\\|${key}\\s*=([^\\n]*)`, 'm'))?.[1]);
    const locations = [...text.matchAll(/\{\{FishingSpotLocLine\b([\s\S]*?)\n\}\}/g)].map(([, body]) => {
      const get = key => clean(body.match(new RegExp(`\\|${key}\\s*=([^\\n]*)`))?.[1]);
      return { name: get('loc'), mapId: Number(get('mapID') || 28), members: get('mem') === 'Yes' ? true : get('mem') === 'No' ? false : null,
        requirements: get('requirements'), points: [...body.matchAll(/(?:x:)?(\d+)\s*,\s*(?:y:)?(\d+)/g)].map(m => ({ x: +m[1], y: +m[2] })) };
    }).filter(l => l.points.length && l.points.every(p => p.x > 0 && p.y > 0));
    const mainLoot = text.split('==Loot==')[1]?.split('===Secondary===')[0] ?? '';
    const fish = [...new Set([...mainLoot.matchAll(/\{\{DropsLineFish\|name=([^|}]+)/g)].map(m => clean(m[1])).filter(n => /^(Raw |Leaping |Slimy eel|Frog spawn)/.test(n)))];
    const fishDetails = fish.map(name => {
      const row = mainLoot.split('\n').find(line => line.startsWith(`{{DropsLineFish|name=${name}|`)) ?? '';
      const notes = name === 'Raw baron shark' ? 'Requires an active juju fishing potion or perfect juju fishing potion.'
        : name === 'Raw great white shark' ? 'Requires the tier 5 great white shark fishing perk from the player-owned house prawnbroker.'
        : name === 'Raw rainbow fish' ? 'Requires stripy feathers; members-only fish.' : '';
      const level = Number(row.match(/\|level=(\d+)/)?.[1] ?? text.match(/\|level = (\d+)/)?.[1]) || null;
      return { name, level, ...(notes ? { conditions: notes } : {}), ...(name === 'Raw rainbow fish' ? { members: true } : {}) };
    });
    const info = text.split('==Fishing info==')[1]?.split('==Locations==')[0] ?? '';
    const methods = [...new Set([...info.matchAll(/\|version\d+\s*=([^\n]+)/g)].map(m => clean(m[1]).replace(/\s*\([^)]*\)/g, '')))];
    const actions = (methods.length ? methods : (field('actions') || field('options')).split(',').map(s=>s.trim())).filter(s => s && s !== 'Examine');
    const tools=[...new Set([...info.matchAll(/\|tool\d*\s*=([^\n]+)/g)].map(m=>clean(m[1]).replace(/\{\{plink\|([^|}]+)(?:\|[^}]*)?\}\}/g,'$1')))];
    const npcIds = [...field('npcid').matchAll(/\d+/g)].map(m => +m[0]);
    rows.push({ title: page.title, revision: revision.revid, url: `https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ', '_'))}?oldid=${revision.revid}`,
      retrievedOn: '2026-10-08', actions, tools, npcIds, fish, fishDetails, locations });
  }
  const shops=[];
  for (const [title,categoryId] of shopPages) {
    const url='https://runescape.wiki/api.php?action=query&prop=revisions&rvprop=ids%7Ccontent&rvslots=main&format=json&titles='+encodeURIComponent(title);
    const page=Object.values((await(await fetch(url)).json()).query.pages)[0], revision=page.revisions?.[0];
    if(!revision) throw new Error(`Missing shop evidence ${title}`);
    const text=revision.slots.main['*'], field=key=>clean(text.match(new RegExp(`^\\|${key}\\s*=([^\\n]*)`,'m'))?.[1]);
    const area=text.match(/\{\{Area map\|([^}]+)\}\}/)?.[1];
    const polygon=area?[...area.matchAll(/(\d+)\s*,\s*(\d+)/g)].map(m=>({x:+m[1],y:+m[2]})):null;
    const map=text.match(/\{\{Map\|([^}]+)\}\}/)?.[1];
    const x=map?.match(/(?:^|\|)\s*x\s*=\s*(\d+)/)?.[1], y=map?.match(/(?:^|\|)\s*y\s*=\s*(\d+)/)?.[1];
    if(!polygon&&(!x||!y)) throw new Error(`Missing shop geometry ${title}`);
    shops.push({title:page.title,categoryId,owner:field('owner'),location:field('location'),members:field('members')==='Yes',
      polygon,...(x&&y?{point:{x:+x,y:+y},maxDistance:3}:{}),
      url:`https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}?oldid=${revision.revid}`,revision:revision.revid,retrievedOn:'2026-10-08'});
  }
  const boats=[];
  for(const [title,pinId,destinationPinId,routeName,description] of [
    ['Captain Tobias','cache-d7277ddb549f7bafb65fc743','cache-f82dc351018379ceaf8aa330','Port Sarim – Musa Point ferry','Captain Tobias sails from Port Sarim to Musa Point for a base fare of 30 coins.'],
    ['Customs officer','cache-f82dc351018379ceaf8aa330','cache-d7277ddb549f7bafb65fc743','Musa Point – Port Sarim ferry','The Musa Point customs officer arranges passage to Port Sarim for a base fare of 30 coins.'],
  ]) {
    const page=Object.values((await(await fetch('https://runescape.wiki/api.php?action=query&prop=revisions&rvprop=ids%7Ccontent&rvslots=main&format=json&titles='+encodeURIComponent(title))).json()).query.pages)[0];
    const revision=page.revisions[0],text=revision.slots.main['*'];
    const mapBodies=[...text.matchAll(/\{\{NPC map\|([^}]+)\}\}/g)].map(m=>m[1]);
    const points=mapBodies.map(body=>{
      const pair=body.match(/(?:^|\|)\s*(\d+)\s*,\s*(\d+)/);
      const x=pair?.[1]??body.match(/\|\s*x\s*=\s*(\d+)/)?.[1],y=pair?.[2]??body.match(/\|\s*y\s*=\s*(\d+)/)?.[1];
      return {x:+x,y:+y};
    }).filter(p=>p.x&&p.y);
    boats.push({title:routeName,pinId,destinationPinId,description,members:false,points,maxDistance:7,
      url:`https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}?oldid=${revision.revid}`,revision:revision.revid,retrievedOn:'2026-10-08'});
  }
  const questChecks=[];
  for(const title of ["Cook's Assistant"]) {
    const page=Object.values((await(await fetch('https://runescape.wiki/api.php?action=query&prop=revisions&rvprop=ids%7Ccontent&rvslots=main&format=json&titles='+encodeURIComponent(title))).json()).query.pages)[0];
    const revision=page.revisions[0],text=revision.slots.main['*'];
    const field=key=>text.match(new RegExp(`^\\|${key}\\s*=([^\\n]*)`,'m'))?.[1].trim();
    questChecks.push({title:page.title,id:Number(field('id')),number:Number(field('number')),members:field('members')==='Yes',
      url:`https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}?oldid=${revision.revid}`,revision:revision.revid,retrievedOn:'2026-10-08'});
  }
  return { schemaVersion: 1, policy: 'Wiki typed fishing-location coordinate rows; reviewed matching encoded marker subtype and local-site association within 12 tiles, never a broad chunk guess. NPC IDs identify the Wiki spot type, not an observed cache NPC.', spotTypeByElement, pages: rows, shops, boats, questChecks };
}

const functions = {
  bank: 'Banking marker.', 'bank-deposit': 'Deposit items into a bank.', anvil: 'Smithing anvil.', furnace: 'Smelting furnace.',
  range: 'Cooking facility.', 'water-source': 'Water-source marker.', 'spinning-wheel': 'Spin fibres into thread or string.',
  'potters-wheel': 'Shape clay for pottery.', altar: 'Prayer altar marker.', 'rare-tree': 'Woodcutting resource marker.',
  'mining-site': 'Mining resource marker.', 'fishing-spot': 'Fishing location marker.', transportation: 'Transport marker.',
  shortcut: 'Shortcut marker; requirements and destination are unverified.', quest: 'Quest marker; quest identity and current progress are unverified.',
  'quest-in-progress': 'Quest-state marker; quest identity and current progress are unverified.',
};

export function buildMapPinDetails(input, wiki) {
  if(input?.schemaVersion!==1||wiki?.schemaVersion!==1||!Array.isArray(input.pins)||!Array.isArray(wiki.pages))throw new Error('Invalid retained map-pin detail input.');
  if(new Set(input.pins.map(p=>p.id)).size!==input.pins.length)throw new Error('Duplicate stable pin ID in retained detail input.');
  if(input.pins.some(p=>typeof p.id!=='string'||p.mapId!==28||p.plane!==0||!Number.isInteger(p.x)||!Number.isInteger(p.y)))throw new Error('Invalid surface pin coordinate in retained detail input.');
  const definitions = new Map(input.definitions.map(d => [d.objectId, d]));
  const classes = new Map(input.resources.classes.map(c => [c.key, c]));
  const columns = input.resources.columns;
  const placements = input.resources.placements.map(row => Object.fromEntries(columns.map((key, i) => [key, row[i]])));
  const byChunk = new Map();
  const questBySequence=new Map();
  for(const q of input.quests??[]) {if(q.sequence===null)continue;if(!questBySequence.has(q.sequence))questBySequence.set(q.sequence,[]);questBySequence.get(q.sequence).push(q);}
  for (const p of placements) { if (!byChunk.has(p.chunkId)) byChunk.set(p.chunkId, []); byChunk.get(p.chunkId).push(p); }
  const pins = input.pins.map(pin => {
    const category = categoryForCachePin(pin), def = definitions.get(pin.source.objectId);
    const gameName = clean(pin.label) || clean(pin.objectName) || clean(def?.name);
    let title = gameName || category.label;
    const provenance = [{ kind: 'cache-pin', file: input.sources[0].file, pinId: pin.id, elementId: pin.elementId,
      source: pin.source.cache, ...(pin.source.objectId ? { objectId: pin.source.objectId } : {}) }];
    const unknowns = ['Personal unlocks, interaction requirements and server state are unverified.'];
    if (pin.conditional) unknowns.push('Conditional marker; current player variables were not read.');
    let description = functions[category.id] ?? `${category.label} marker.`;
    if (gameName && gameName.toLowerCase() !== category.label.toLowerCase()) description = `${gameName}. ${description}`;
    let members = null, specificity = 'basic', resources = [], destinations = [];
    // Generic scenery names do not count as a named shop, quest or typed resource.
    if (gameName && gameName.toLowerCase() !== category.label.toLowerCase() && !/^(bank (chest|booth|deposit box)|deposit box|range|cooking range|anvil|furnace|altar|tree|rocks|well|sink|water barrel|spinning wheel|potter.?s wheel|fishing spot|lodestone|small obelisk|obelisk|fairy ring|shortcut|portal|stairs|ladder|door)$/i.test(gameName)) specificity = 'specific';
    if (def) provenance.push({ kind: 'cache-object-definition', file: input.sources[1].file, objectId: def.objectId, name: def.name, actions: def.actions, membersFlag: def.membersFlag });
    if(['quest','quest-in-progress'].includes(category.id)) {
      const sequence=pin.elementParams.find(p=>p.prop===4147)?.intvalue;
      const quests=questBySequence.get(sequence)??[];
      if(quests.length===1) {
        const q=quests[0], exact=q.startCoordinates.some(c=>c.x===pin.source.x&&c.y===pin.source.y&&c.plane===pin.source.plane);
        title=q.name;members=q.members;specificity='specific';
        description=`${q.name}.${q.startGuidance?` Start guidance: ${q.startGuidance}`:''}${q.questPoints!==null?` ${q.questPoints} quest point${q.questPoints===1?'':'s'}.`:''}`;
        provenance.push({kind:'cache-quest-definition',file:input.sources[4].file,questId:q.id,source:q.source,markerParam:4147,questParam:1345,sequence,
          identityInterpretation:'Empirical encoded sequence join, corroborated by 407 exact marker/start-path source-coordinate matches across this bundle.',
          exactStartCoordinate:exact,startCoordinates:q.startCoordinates});
        const wikiCheck=(wiki.questChecks??[]).find(c=>c.id===q.id&&c.number===sequence);
        if(wikiCheck)provenance.push({kind:'wiki-quest-sequence-check',url:wikiCheck.url,revision:wikiCheck.revision,questId:q.id,sequence});
        unknowns.push('The quest identity is known; this conditional icon does not establish current progress or the next quest step.');
        if(!exact)unknowns.push('This marker differs from the quest start-path coordinate; its exact step or alternate-start semantics remain unknown.');
      }
    }
    const shopCandidates=(wiki.shops??[]).filter(shop=>shop.categoryId===category.id&&(
      shop.polygon?pin.x>=Math.min(...shop.polygon.map(p=>p.x))&&pin.x<=Math.max(...shop.polygon.map(p=>p.x))&&pin.y>=Math.min(...shop.polygon.map(p=>p.y))&&pin.y<=Math.max(...shop.polygon.map(p=>p.y)):
        Math.hypot(pin.x-shop.point.x,pin.y-shop.point.y)<=shop.maxDistance));
    if(shopCandidates.length===1) {
      const shop=shopCandidates[0];title=shop.title;members=shop.members;specificity='specific';
      description=`${shop.title}, ${shop.location}. Run by ${shop.owner}.`;
      provenance.push({kind:'wiki-shop-site',url:shop.url,revision:shop.revision,scope:shop.polygon?'named-shop-polygon':'named-shop-point-within-3-tiles',
        ...(shop.polygon?{polygon:shop.polygon}:{matchedPoint:shop.point,distanceTiles:+Math.hypot(pin.x-shop.point.x,pin.y-shop.point.y).toFixed(3)})});
      unknowns.push('Current stock, prices and purchase restrictions were not imported.');
    }
    const boat=(wiki.boats??[]).find(b=>b.pinId===pin.id&&b.points.some(p=>Math.hypot(p.x-pin.x,p.y-pin.y)<=b.maxDistance));
    if(boat) {
      const destination=input.pins.find(p=>p.id===boat.destinationPinId);
      if(!destination)throw new Error(`Missing ferry destination marker ${boat.destinationPinId}`);
      title=boat.title;members=boat.members;specificity='specific';description=boat.description;
      destinations=[{name:boat.title.split(' – ')[1].replace(' ferry',''),x:destination.x,y:destination.y,plane:destination.plane,mapId:destination.mapId,
        kind:'boat',coordinateKind:'destination-map-marker',pinId:destination.id,source:'reviewed-wiki-route-and-cache-marker'}];
      provenance.push({kind:'wiki-boat-route',url:boat.url,revision:boat.revision,scope:'reviewed-local-dock-site',originWikiPoints:boat.points,destinationPinId:destination.id});
      unknowns.push('Exact ship landing tile is unknown; the destination coordinate identifies the map marker at the dock. Fare discounts and personal permission remain separate.');
    }
    if (['rare-tree', 'mining-site'].includes(category.id)) {
      const prefix = category.id === 'rare-tree' ? 'tree:' : 'ore:';
      const nearby = (byChunk.get(pin.chunkId) ?? []).filter(p => p.classKey.startsWith(prefix) && !p.classKey.includes(':unknown:') && Math.hypot(p.x - pin.x, p.y - pin.y) <= 32);
      const groups = new Map();
      for (const p of nearby) { if (!groups.has(p.classKey)) groups.set(p.classKey, []); groups.get(p.classKey).push(p); }
      resources = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, ps]) => ({ name: classes.get(key).name, classKey: key,
        scope: ps.some(p => p.x === pin.x && p.y === pin.y && p.objectId === pin.source.objectId) ? 'exact-placement' : 'nearby-area',
        count: new Set(ps.map(p => p.id)).size, objectIds: [...new Set(ps.map(p => p.objectId))].sort((a,b) => a-b),
        coordinates: ps.map(p => ({ id: p.id, x: p.x, y: p.y, plane: p.effectivePlane, mapId: 28 })) }));
      if (resources.length) { specificity = 'specific'; description = `Nearby within 32 tiles: ${resources.map(r => r.name).join(', ')}.`;
        provenance.push({ kind: 'cache-resource-catalogue', file: input.sources[3].file, scope: 'same-chunk-within-32-tiles', placementIds: [...new Set(nearby.map(p => p.id))].sort() }); }
      else unknowns.push('No typed static resource was matched within the reviewed nearby area.');
      if(resources.some(r=>r.scope==='nearby-area')) unknowns.push('Nearby-area availability does not identify this icon as an exact resource node or grant access.');
    }
    if (category.id === 'fishing-spot') {
      const reviewedType = wiki.spotTypeByElement?.[pin.elementId];
      const candidates = wiki.pages.filter(page => page.title === reviewedType).flatMap(page => page.locations.filter(l => l.mapId === 28).flatMap(location => location.points
        .map(point => ({ page, location, point, distance: Math.hypot(point.x-pin.x, point.y-pin.y) })).filter(c => c.distance <= 12)));
      candidates.sort((a,b) => a.distance-b.distance || a.page.title.localeCompare(b.page.title));
      const selected = candidates[0], distinctType = new Set(candidates.filter(c => c.distance <= (selected?.distance ?? 0) + 1).map(c => c.page.title));
      if (selected && distinctType.size === 1 && selected.page.fish.length) {
        specificity = 'specific'; members = selected.location.members; title = `${selected.location.name} fishing spot`;
        resources = selected.page.fish.map(name => ({ ...(selected.page.fishDetails?.find(d=>d.name===name) ?? {name}), scope: 'reviewed-local-site', fishingSpotType: selected.page.title,
          methods: selected.page.actions, wikiNpcIds: selected.page.npcIds }));
        const catchLabels=selected.page.fish.map(name=>{
          const plain=name.replace(/^Raw /,'');
          return name==='Raw rainbow fish'?`${plain} (members; stripy feathers)`:name==='Raw baron shark'?`${plain} (juju fishing potion)`:
            name==='Raw great white shark'?`${plain} (tier 5 prawnbroker perk)`:plain;
        });
        description = `${selected.location.name}: ${catchLabels.join(', ')}. ${(selected.page.tools?.length?selected.page.tools:selected.page.actions).join(' or ')}.`;
        if(selected.page.title==='Fishing spot (lure, bait)')description+=' Feathers for fly fishing; fishing bait for pike.';
        else if(['Fishing spot (small fishing net, bait)','Fishing spot (slimy eels)','Fishing spot (Menaphos)'].includes(selected.page.title))description+=' Rod fishing requires fishing bait.';
        if (resources.some(r=>r.conditions)) unknowns.push('Some listed catches require extra bait, unlocks or effects; see each resource condition.');
        provenance.push({ kind: 'wiki-fishing-site', url: selected.page.url, revision: selected.page.revision, location: selected.location.name,
          marker: { x: pin.x, y: pin.y }, matchedPoint: selected.point, distanceTiles: +selected.distance.toFixed(3), scope: 'reviewed-local-site',
          encodedSpotSubtype: pin.elementParams.find(p => p.prop === 4147)?.intvalue ?? null });
        unknowns.push('Exact current NPC spawn, movement and cache NPC ID are unverified.');
        if (selected.location.requirements && selected.location.requirements !== 'None') description += ` Site requirement: ${selected.location.requirements}.`;
      } else unknowns.push('Fish and spot methods remain unknown: no unambiguous typed Wiki coordinate match within 12 tiles.');
    }
    if (['lodestone', 'lodestone-activated'].includes(category.id)) {
      const matches = input.lodestones.flatMap(l => l.coordinates.flatMap(c => c.surface.filter(p => p.mapId===28 && p.plane===pin.plane && Math.hypot(p.x-pin.x,p.y-pin.y)<=3).map(p=>({l,p}))));
      const names = new Set(matches.map(m=>m.l.name));
      if (names.size===1) {
        const {l,p} = matches[0]; specificity='specific'; title=l.name; description = l.description;
        destinations = [{ name: l.name, x:p.x, y:p.y, plane:p.plane, mapId:28, source: 'cache-typed-lodestone-struct', structIds:[...new Set(matches.map(m=>m.l.structId))].sort((a,b)=>a-b) }];
        const flags = new Set(matches.map(m=>m.l.membersCandidate));
        if (flags.size===1 && [0,1].includes([...flags][0])) members=!![...flags][0];
        provenance.push({kind:'cache-travel-struct', file:input.sources[2].file, structIds: destinations[0].structIds, membershipInterpretation:'consistent candidate ability flag; does not grant geographic or personal access'});
        unknowns.push('Lodestone activation and travel permission remain personal requirements.');
      }
    }
    if (!destinations.length&&['transportation','shortcut','dungeon','dungeon-entrance','dungeon-exit','fairy-ring','house-portal'].includes(category.id)) unknowns.push('Exact route destination is unknown for this stable pin ID.');
    if (category.group === 'Shops / Trading' && !gameName&&!shopCandidates.length) unknowns.push('Shop identity and stock are unknown; the category is not a shop name.');
    if (members === null) unknowns.push('Membership is unknown; the icon or object flag alone does not establish location access.');
    return { id:pin.id, categoryId:category.id, categoryLabel:category.label, title, description, members, specificity, resources, destinations, provenance, unknowns };
  }).sort((a,b)=>a.id.localeCompare(b.id));
  const categories = {};
  for (const p of pins) { const row = categories[p.categoryId] ??= {total:0,basic:0,specific:0,provenance:0}; row.total++; row[p.specificity]++; if(p.provenance.length) row.provenance++; }
  return { schemaVersion:1, bundle:'cache-2026-10-08-05932552f7af-v1', sources:input.sources,
    inputSha256:hash(JSON.stringify(input)), wikiSha256:hash(JSON.stringify(wiki)), generator:{file:'scripts/build-map-pin-details.mjs',sha256:sha256RepositoryText(readFileSync(fileURLToPath(import.meta.url)))}, pins,
    coverage:{total:pins.length,basic:pins.filter(p=>p.specificity==='basic').length,specific:pins.filter(p=>p.specificity==='specific').length,provenance:pins.length,categories},
    limits:['Map labels are anchors, not enclosing place polygons.','Resource matches use the same chunk and a maximum 32-tile distance; they do not grant access.',wiki.policy,
      'Lodestone structs supply automatic typed landings; the two reviewed ferry routes use dock map-marker coordinates, with exact landing tiles unknown. Other route destinations remain unknown.',
      'The generator reads retained versioned exports and committed evidence; it does not open game-cache databases or personal saves.'] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--capture-inputs')) jsonWrite(inputFile, captureInputs());
  if (process.argv.includes('--capture-wiki')) jsonWrite(wikiFile, await captureWiki());
  const result = buildMapPinDetails(read(inputFile), read(wikiFile));
  jsonWrite(outputFile, result);
  console.log(JSON.stringify({total:result.coverage.total,basic:result.coverage.basic,specific:result.coverage.specific,provenance:result.coverage.provenance,fishing:result.coverage.categories['fishing-spot']}));
}
