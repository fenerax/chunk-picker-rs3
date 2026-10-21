// Offline Wiki adaptations. Authored selections name exact variants and methods;
// every emitted fact is checked against the pinned page before use.
import { templateFields } from './open-f2p-stories.mjs';

const prefix = 'rs3:open-f2p:';
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = value => String(value ?? '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/'{2,3}/g, '').trim();
const unique = values => [...new Set(values)];
const union = rows => [...new Map(rows.filter(Boolean).map(row => [`${row.page}:${row.revision}`, row])).values()];
const sorted = rows => rows.sort((a, b) => a.id.localeCompare(b.id, 'en'));
const region = point => String(Math.floor(point.x / 64) * 256 + Math.floor(point.y / 64));
const noGate = fields => !fields.requirements || /^(none|no)$/i.test(fields.requirements);
const integer = (value, name, minimum = 1) => {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) throw new Error(`Unknown equipment ${name}: ${value}.`);
  return Number(value);
};
const number = (value, name, fallback = 0) => {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`Unknown equipment ${name}: ${value}.`);
  return Number(value);
};

export function buildEquipment({ spec, pages, cells, templates, stock = [], sources = [] }) {
  const equipment = [], monsters = [], drops = [], facilities = [], recipes = [], acquisitions = [], tasks = [], equipmentReview = [];
  const result = () => Object.fromEntries(Object.entries({ equipment, monsters, drops, facilities, recipes, acquisitions, tasks, equipmentReview }).map(([key, rows]) => [key, sorted(rows)]));
  if (!spec.equipmentActivities) return result();
  const page = title => {
    const row = pages.get(title);
    if (!row?.text || !row.provenance || /\{\{\s*(?:Deleted|Historical)(?:\s+content)?\s*(?:\||\}\})/i.test(row.text)) throw new Error(`Missing/current equipment Wiki page: ${title}.`);
    return row;
  };
  const evidence = proof => {
    const row = page(proof.page);
    if (!proof.needle || !row.text.includes(proof.needle)) throw new Error(`Equipment evidence changed: ${proof.page}: ${proof.needle}.`);
    return row.provenance;
  };
  const mapDefaultProof = (spec.equipmentMapDefaults ?? []).map(evidence);
  const itemCache = new Map();
  const item = title => {
    if (itemCache.has(title)) return itemCache.get(title);
    const source = page(title), boxes = templates(source.text, 'Infobox Item');
    if (boxes.length !== 1) throw new Error(`Ambiguous equipment/item variants: ${title}.`);
    const fields = templateFields(boxes[0]);
    if (fields.members?.toLowerCase() !== 'no' || clean(fields.name) !== source.provenance.page) throw new Error(`No exact free item: ${title}.`);
    const row = { item: clean(fields.name), itemId: integer(fields.id, 'item id'), fields, source };
    itemCache.set(title, row); return row;
  };
  const points = (text, kind) => [...text.matchAll(new RegExp(`${kind}id\\s*:\\s*(\\d+)\\s*,\\s*x\\s*:\\s*(\\d+)\\s*,\\s*y\\s*:\\s*(\\d+)`, 'gi'))]
    .map(match => ({ [`${kind}Id`]: Number(match[1]), x: Number(match[2]), y: Number(match[3]), plane: 0 }));
  const selectedRows = (source, template, selection) => {
    const rows = templates(source.text, template).filter(text => selection.locations.includes(clean(templateFields(text).loc)));
    if (!rows.length) throw new Error(`No reviewed equipment location: ${selection.page}.`);
    for (const text of rows) {
      const fields = templateFields(text);
      if (fields.mem?.toLowerCase() !== 'no' || !noGate(fields) || fields.plane !== undefined && fields.plane !== '0'
        || fields.mapid !== undefined && fields.mapid !== '28') throw new Error(`Gated/member/interior equipment location: ${selection.page}.`);
      if ((fields.plane === undefined || fields.mapid === undefined) && (!selection.surfaceDefaults || !mapDefaultProof.length)) throw new Error(`Unknown surface defaults: ${selection.page}.`);
    }
    return rows;
  };
  const ids = new Set();
  const push = (rows, row) => {
    if (ids.has(row.id)) throw new Error(`Duplicate equipment identity: ${row.id}.`);
    ids.add(row.id); rows.push(row); return row;
  };

  for (const selection of spec.equipmentFacilities ?? []) {
    const source = page(selection.page), proof = (selection.evidence ?? []).map(evidence);
    let mapped = [];
    if (selection.kind === 'tanner') {
      const boxes = templates(source.text, 'Infobox NPC');
      if (boxes.length !== 1) throw new Error(`Ambiguous tanner: ${selection.page}.`);
      const fields = templateFields(boxes[0]);
      if ((fields[`members${selection.variant}`] ?? fields.members)?.toLowerCase() !== 'no') throw new Error(`No free tanner variant: ${selection.page}.`);
      const maps = templates(fields[`map${selection.variant}`] ?? fields.map ?? '', 'NPC map');
      if (maps.length !== 1) throw new Error(`No exact tanner map: ${selection.page}.`);
      const map = templateFields(maps[0]);
      if (map.mapid !== '28' || map.plane !== '0') throw new Error(`Tanner floor/map unknown: ${selection.page}.`);
      mapped = [{ x: integer(map.x, 'tanner x'), y: integer(map.y, 'tanner y'), plane: 0 }];
    } else {
      for (const text of selectedRows(source, 'ObjectLocLine', selection)) {
        const fields = templateFields(text);
        if (clean(fields.name ?? fields.objectname) !== selection.page) throw new Error(`Wrong facility variant: ${selection.page}.`);
        mapped.push(...points(text, 'object'));
      }
    }
    const groups = new Map();
    for (const point of mapped) {
      const cell = region(point);
      if (!cells.has(cell)) continue;
      if (!groups.has(cell)) groups.set(cell, []);
      groups.get(cell).push(point);
    }
    if (!groups.size) throw new Error(`Facility has no existing reviewed cell: ${selection.page}.`);
    for (const [cell, coordinates] of groups) push(facilities, { id: `${prefix}facility:${selection.slug}:${cell}`, name: selection.page,
      kind: selection.kind, cell, coordinates: coordinates.sort((a, b) => a.x - b.x || a.y - b.y), membership: 'free', provenance: union([source.provenance, ...proof, ...mapDefaultProof]) });
  }

  for (const selection of spec.monsterActivities ?? []) {
    const source = page(selection.page), box = templates(source.text, 'Infobox Monster')[selection.infoboxIndex ?? 0];
    if (!box) throw new Error(`Missing exact monster infobox: ${selection.page}.`);
    const fields = templateFields(box), receipts = [source.provenance, ...(selection.evidence ?? []).map(evidence), ...mapDefaultProof];
    const allowedIds = new Set();
    for (const key of selection.variants) {
      if ((fields[`members${key}`] ?? fields.members)?.toLowerCase() !== 'no') throw new Error(`No free monster variant: ${selection.page}:${key}.`);
      for (const value of String(fields[`id${key}`] ?? fields.id ?? '').split(',').map(x => x.trim())) allowedIds.add(integer(value, 'monster id'));
    }
    if (!selection.npcIds.length || selection.npcIds.some(value => !allowedIds.has(value))) throw new Error(`Unreviewed exact monster IDs: ${selection.page}.`);
    const groups = new Map();
    for (const text of selectedRows(source, 'LocLine', { ...selection, surfaceDefaults: true })) for (const point of points(text, 'npc')) {
      if (!selection.npcIds.includes(point.npcId)) continue;
      const cell = region(point);
      if (!cells.has(cell)) continue;
      if (!groups.has(cell)) groups.set(cell, []);
      groups.get(cell).push(point);
    }
    if (!groups.size) throw new Error(`Monster has no existing reviewed placement: ${selection.page}.`);
    let dropText = source.text;
    if (selection.dropSection) {
      const begin = source.text.indexOf(selection.dropSection.start), end = source.text.indexOf(selection.dropSection.end, begin + 1);
      if (begin < 0 || end < begin) throw new Error(`Missing exact drop-table section: ${selection.page}.`);
      dropText = source.text.slice(begin, end);
    }
    const chosen = [];
    for (const review of selection.drops) {
      const target = item(review.page);
      const candidates = templates(dropText, 'DropsLine').filter(text => clean(templateFields(text).name) === target.item);
      if (!candidates.length) throw new Error(`Missing selected drop: ${selection.page}:${target.item}.`);
      for (const text of candidates) {
        const fields = templateFields(text);
        if (fields.members && fields.members.toLowerCase() !== 'no' || fields.version || fields.altrarity || fields.quantitynotes || fields.noted?.toLowerCase() === 'yes') throw new Error(`Conditional/member drop: ${selection.page}:${target.item}.`);
        const notes = `${fields.namenotes ?? ''}${fields.raritynotes ?? ''}`;
        if (notes && (!review.noteEvidence?.length || review.notes !== notes)) throw new Error(`Unreviewed drop notes: ${selection.page}:${target.item}.`);
        const proof = (review.noteEvidence ?? []).map(evidence);
        if (review.f2pOnly && !fields.namenotes?.includes('{{F2POnly}}')) throw new Error(`Missing F2P-only drop marker: ${target.item}.`);
        const quantity = fields.quantity, rate = fields.rarity;
        if (!/^\d+(?:-\d+)?$/.test(quantity)) throw new Error(`Unknown drop quantity: ${selection.page}:${target.item}.`);
        const parts = /^(\d+)\/(\d+)$/.exec(rate ?? '');
        const probability = /^always$/i.test(rate ?? '') ? 1 : parts && Number(parts[2]) > 0 ? Number(parts[1]) / Number(parts[2]) : null;
        if (!(probability > 0 && probability <= 1)) throw new Error(`Unknown selected drop rate: ${selection.page}:${target.item}.`);
        chosen.push({ item: target.item, itemId: target.itemId, quantity, rate, probability,
          ...(review.f2pOnly ? { world: 'free' } : {}), provenance: union([...receipts, target.source.provenance, ...proof]) });
      }
    }
    for (const [cell, coordinates] of groups) {
      const monster = push(monsters, { id: `${prefix}monster:${selection.slug}:${cell}`, name: selection.name, page: selection.page, variant: selection.variant,
        cell, coordinates: coordinates.sort((a, b) => a.x - b.x || a.y - b.y || a.npcId - b.npcId), membership: 'free',
        manualChecks: [`Confirm you can defeat ${selection.name} in game; combat capability and kill time are not tracked.`], provenance: union(receipts) });
      for (const drop of chosen) push(drops, { ...drop, id: `${prefix}drop:${selection.slug}:${cell}:${slug(drop.item)}:${drop.quantity}`, monsterId: monster.id, cell, membership: 'free' });
    }
  }

  for (const selection of spec.equipmentRecipes ?? []) {
    const target = item(selection.page), all = templates(target.source.text, 'Infobox Recipe');
    const matching = all.filter(text => { const fields = templateFields(text); return fields.members?.toLowerCase() === 'no' && clean(fields.output1) === target.item
      && (fields.facility ?? '') === (selection.recipeFacility ?? '') && !fields.process && !fields.method; });
    if (matching.length !== 1) throw new Error(`No exact free recipe: ${selection.page}.`);
    const fields = templateFields(matching[0]), receipts = [target.source.provenance, ...(selection.evidence ?? []).map(evidence)];
    if (fields.output2 || fields.output1qty && fields.output1qty !== '1' || fields.skill2 || fields.requirements) throw new Error(`Unsupported multi-output/skill/gated recipe: ${selection.page}.`);
    const skillRequirements = { [fields.skill1]: integer(fields.skill1lvl, 'recipe skill') };
    const inputs = [];
    for (let at = 1; at <= 20; at++) if (fields[`mat${at}`]) {
      const material = item(clean(fields[`mat${at}`]));
      inputs.push({ item: material.item, quantity: integer(fields[`mat${at}qty`] ?? '1', 'material quantity') });
      receipts.push(material.source.provenance);
    }
    if (!inputs.length) throw new Error(`Missing recipe materials: ${selection.page}.`);
    const tools = fields.tool ? [clean(fields.tool)] : [];
    for (const title of [...tools, ...(selection.extraSupplies ?? [])]) receipts.push(item(title).source.provenance);
    const selectedFacilities = (selection.facilities ?? []).map(key => {
      const matches = facilities.filter(row => row.id === `${prefix}facility:${key}`);
      if (matches.length !== 1) throw new Error(`Missing recipe facility: ${selection.page}:${key}.`);
      return matches[0];
    });
    if (fields.facility && !selectedFacilities.some(row => row.name === fields.facility || fields.facility === 'Tanner' && row.kind === 'tanner')) throw new Error(`Wrong recipe facility: ${selection.page}.`);
    if (fields.tool === 'Hammer' && !selectedFacilities.some(row => row.kind === 'forge')) throw new Error(`Smithing recipe lacks reviewed forge: ${selection.page}.`);
    if (fields.skill1 === 'Crafting' && fields.tool === 'Needle' && !(selection.extraSupplies ?? []).includes('Thread')) throw new Error(`Leather sewing recipe lacks thread: ${selection.page}.`);
    const cell = selection.cell ?? selectedFacilities[0]?.cell;
    if (!cells.has(cell) || selectedFacilities.some(row => row.cell !== cell)) throw new Error(`Recipe has unreviewed or split facility cell: ${selection.page}.`);
    receipts.push(...selectedFacilities.flatMap(row => row.provenance));
    push(recipes, { id: `${prefix}recipe:${selection.slug}`, item: target.item, itemId: target.itemId, cell, inputs, tools,
      supplyItems: unique([...inputs.map(row => row.item), ...tools, ...(selection.extraSupplies ?? [])]),
      facilityIds: selectedFacilities.map(row => row.id), objectRequirements: selectedFacilities.filter(row => row.kind !== 'tanner').map(row => row.name),
      npcRequirements: selectedFacilities.filter(row => row.kind === 'tanner').map(row => row.name), skillRequirements, output: [target.item], membership: 'free',
      itemChecks: [`Check required quantities in game: ${inputs.map(row => `${row.quantity} ${row.item}`).join(', ')}. Inventory and consumption are not tracked.`],
      manualChecks: selection.manualChecks ?? [], provenance: union(receipts) });
  }

  const acquire = (target, source, sourceKind, name, manualChecks = []) => {
    const acquisition = push(acquisitions, { id: `${prefix}acquisition:${sourceKind}:${source.id.slice(prefix.length)}`, item: target.item, itemId: target.itemId,
      sourceId: source.id, sourceKind, cell: source.cell, provenance: union([...source.provenance, target.source.provenance]) });
    const recipe = sourceKind === 'recipe' ? source : null;
    push(tasks, { id: `${prefix}activity:obtain:${sourceKind}:${source.id.slice(prefix.length)}`, sourceId: acquisition.id, acquisitionSourceId: source.id,
      itemId: target.itemId, cell: source.cell, skill: 'Extra', level: 1,
      label: `Obtain ${target.item}${sourceKind === 'drop' ? ` (${source.quantity}; ${source.rate})` : ''} ${name} (${source.cell})`,
      reason: recipe ? `Make ${target.item} using the reviewed recipe. ${source.itemChecks.join(' ')} ${source.manualChecks.join(' ')}` : `A reviewed ${sourceKind} source can supply ${target.item}. Check access, inventory and any costs in game. ${manualChecks.join(' ')}`,
      ...(recipe ? { output: recipe.output, supplyItems: recipe.supplyItems, objectRequirements: recipe.objectRequirements, npcRequirements: recipe.npcRequirements,
        skillRequirements: recipe.skillRequirements } : {}),
      ...(sourceKind === 'drop' ? { monsterRequirements: [source.monsterId] } : {}),
      manualChecks: recipe ? recipe.manualChecks : manualChecks, provenance: acquisition.provenance });
    return acquisition;
  };
  const acquirePages = unique([...(spec.equipmentActivities ?? []).map(row => row.page), ...(spec.equipmentRecipes ?? []).map(row => row.page), ...drops.map(row => row.item)]);
  for (const title of acquirePages) {
    const target = item(title);
    for (const source of stock.filter(row => row.item === target.item)) acquire(target, source, 'shop', `from ${source.provenance[0].page}${source.variant === 'free' ? ' (free sample)' : ''}`);
    for (const source of drops.filter(row => row.item === target.item)) {
      const monster = monsters.find(row => row.id === source.monsterId);
      acquire(target, source, 'drop', `as a drop from ${monster.name}`, monster.manualChecks);
    }
    for (const source of recipes.filter(row => row.item === target.item)) acquire(target, source, 'recipe', 'by making it');
  }

  for (const selection of spec.equipmentActivities) {
    const target = item(selection.page), boxes = templates(target.source.text, 'Infobox Bonuses');
    if (target.fields.equipable?.toLowerCase() !== 'yes' || boxes.length !== 1) throw new Error(`Not exact wearable equipment: ${selection.page}.`);
    const fields = templateFields(boxes[0]), requirements = {};
    const raw = fields.requirements ?? '';
    if (!/^none$/i.test(raw)) {
      const matches = [...raw.matchAll(/\{\{sc\|([a-z]+)\|(\d+)\}\}/gi)];
      if (!matches.length || raw.replace(/\{\{sc\|[a-z]+\|\d+\}\}/gi, '').trim()) throw new Error(`Unsupported wield requirements: ${selection.page}.`);
      for (const match of matches) requirements[match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()] = integer(match[2], 'wield level');
    }
    if (!['weapon', 'off-hand', 'head', 'body', 'legs', 'feet', 'hands', 'neck', 'ring', 'back', 'pocket'].includes(fields.slot) || !['melee', 'ranged', 'magic', 'hybrid', 'all'].includes(fields.class)) throw new Error(`Unknown equipment slot/class: ${selection.page}.`);
    const options = acquisitions.filter(row => row.itemId === target.itemId).sort((a, b) => (a.sourceKind === 'shop' ? -1 : 1) - (b.sourceKind === 'shop' ? -1 : 1) || a.id.localeCompare(b.id, 'en'));
    if (!options.length) throw new Error(`Equipment lacks reviewed acquisition: ${selection.page}.`);
    const useRequirements = selection.useRequirements ?? {};
    const useProof = (selection.useEvidence ?? []).map(evidence);
    if (Object.keys(useRequirements).length && !useProof.length) throw new Error(`Tool use requirements lack evidence: ${selection.page}.`);
    if (selection.page === 'Bronze pickaxe') {
      const info = templateFields(templates(target.source.text, 'Infobox pickaxe')[0] ?? '');
      if (useRequirements.Mining !== integer(info.level, 'pickaxe use level')) throw new Error('Pickaxe use level differs from Wiki.');
    }
    if (selection.page === 'Bronze hatchet') {
      const source = page('Hatchet');
      const match = /\|\s*\{\{plinkt\|Bronze hatchet\}\}\s*\|\|\s*(\d+)\s*\|\|/.exec(source.text);
      if (!match || useRequirements.Woodcutting !== Number(match[1])) throw new Error('Hatchet use level differs from Wiki.');
    }
    const row = push(equipment, { id: `${prefix}equipment:${selection.slug}`, item: target.item, itemId: target.itemId, page: target.source.provenance.page,
      cell: options[0].cell, slot: fields.slot, class: fields.class, tier: number(fields.tier, 'tier'), armour: number(fields.armour, 'armour'),
      prayer: number(fields.prayer, 'prayer'), ability_damage: number(fields.damage, 'damage'), accuracy: number(fields.accuracy, 'accuracy'), requirements,
      useRequirements, membership: 'free', acquisitionSourceIds: options.map(row => row.id), provenance: union([target.source.provenance, ...useProof, ...options.flatMap(row => row.provenance)]) });
    push(tasks, { id: `${prefix}activity:wield:${selection.slug}`, sourceId: row.id, itemId: row.itemId, cell: row.cell, skill: 'Extra', level: 1,
      requiredCells: [], label: `${row.slot === 'weapon' ? 'Wield' : 'Wear'} ${row.item}`, reason: 'Obtain this exact item from a reviewed source, then equip it in game. Current inventory and equipped items are not tracked.',
      supplyItems: [row.item], skillRequirements: requirements, manualChecks: ['Equip the exact item in game before checking this goal.'], provenance: row.provenance });
  }
  for (const selection of spec.equipmentSkips ?? []) push(equipmentReview, { id: `${prefix}equipment-review:${selection.slug}`, reason: selection.reason,
    provenance: union((selection.evidence ?? []).map(evidence)) });
  // Gathering supply joins use already admitted source IDs, never cached game
  // catalogues or an inferred crafting source.
  for (const row of recipes) row.inputSourceIds = Object.fromEntries(row.inputs.map(input => [input.item,
    unique([...sources.filter(source => source.output === input.item).map(source => source.id), ...acquisitions.filter(source => source.item === input.item).map(source => source.id)])]));
  return result();
}
