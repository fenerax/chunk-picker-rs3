// Offline, dependency-free derivation from the authored review and pinned wikitext.
const prefix = 'rs3:open-f2p:';
const clean = value => String(value ?? '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/'{2,3}/g, '').trim();
const slug = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sort = rows => rows.sort((a, b) => a.id.localeCompare(b.id, 'en'));
const union = rows => [...new Map(rows.map(row => [`${row.page}:${row.revision}`, row])).values()];

function templates(text, name) {
  const result = [];
  for (const match of text.matchAll(new RegExp(`\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?=\\||\\n|\\}\\})`, 'gi'))) {
    let depth = 1, end = match.index + 2;
    while (depth && end < text.length) {
      const pair = text.slice(end, end + 2);
      if (pair === '{{') { depth++; end += 2; }
      else if (pair === '}}') { depth--; end += 2; }
      else end++;
    }
    if (depth) throw new Error(`Unclosed ${name} template.`);
    result.push(text.slice(match.index, end));
  }
  return result;
}

// Split only top-level parameters, retaining nested templates and link displays.
function fields(template) {
  const parts = [], body = template.slice(2, -2);
  let depth = 0, links = 0, start = 0;
  for (let at = 0; at < body.length; at++) {
    const pair = body.slice(at, at + 2);
    if (pair === '{{') { depth++; at++; }
    else if (pair === '}}') { depth--; at++; }
    else if (pair === '[[') { links++; at++; }
    else if (pair === ']]') { links--; at++; }
    else if (body[at] === '|' && !depth && !links) { parts.push(body.slice(start, at)); start = at + 1; }
  }
  parts.push(body.slice(start));
  return new Map(parts.slice(1).filter(part => part.includes('=')).map(part => {
    const split = part.indexOf('=');
    return [part.slice(0, split).trim().toLowerCase(), part.slice(split + 1).trim()];
  }));
}
const field = (template, key) => fields(template).get(key.toLowerCase());
const ungated = template => !field(template, 'requirements') || /^(none|no)$/i.test(field(template, 'requirements'));
const coords = text => [...text.matchAll(/\bx\s*:\s*(\d+)\s*,\s*y\s*:\s*(\d+)/gi)].map(match => ({ x: +match[1], y: +match[2], plane: 0 }));
function mapPoints(infobox) {
  const result = [];
  const maps = ['NPC map', 'Area map', 'Map'].flatMap(name => templates(infobox, name));
  for (const map of maps) {
    const parameters = fields(map), x = Number(parameters.get('x')), y = Number(parameters.get('y'));
    const plane = Number(parameters.get('plane') ?? 0);
    if (!Number.isSafeInteger(plane) || plane < 0 || plane > 3) throw new Error('Unknown map plane.');
    if (parameters.has('mapid') && parameters.get('mapid') !== '28') continue;
    if (Number.isSafeInteger(x) && Number.isSafeInteger(y)) result.push({ x, y, plane });
    else {
      const tuple = /\|\s*(\d+)\s*,\s*(\d+)\s*(?=\||\}\})/.exec(map);
      if (tuple) result.push({ x: +tuple[1], y: +tuple[2], plane });
    }
  }
  return result;
}

/** Derive reviewed shops, stock, banking services, and paid route metadata. */
export function buildServices({ spec, pages, addCell, anchors }) {
  const shops = [], stock = [], services = [], routes = [], tasks = [], ids = new Set();
  const page = title => {
    const result = pages.get(title);
    if (!result || typeof result.text !== 'string' || !result.provenance) throw new Error(`Missing reviewed Wiki page: ${title}.`);
    return result;
  };
  const bounds = spec.serviceBounds ?? spec.bounds;
  const inBounds = point => !bounds || point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  const push = (rows, row) => {
    if (ids.has(row.id)) throw new Error(`Duplicate reviewed service/stock ID: ${row.id}.`);
    ids.add(row.id); rows.push(row); return row;
  };
  const reviewedPoint = (title, type, plane) => {
    const source = page(title), box = templates(source.text, type)[0];
    if (!box || field(box, 'members')?.toLowerCase() !== 'no') throw new Error(`No explicit free ${type}: ${title}.`);
    if (/\{\{\s*Deleted(?:\s+content)?\s*(?:\||\}\})/i.test(source.text)) throw new Error(`Deleted reviewed page: ${title}.`);
    const point = mapPoints(box).find(inBounds);
    if (!point) throw new Error(`No reviewed in-bounds map anchor: ${title}.`);
    if (plane !== undefined && point.plane !== plane) throw new Error(`Reviewed plane mismatch: ${title}.`);
    return { source, box, point };
  };
  const itemProof = new Map();
  for (const title of spec.itemPages ?? []) {
    const source = page(title), box = templates(source.text, 'Infobox Item')[0];
    if (!box || field(box, 'members')?.toLowerCase() !== 'no') throw new Error(`No explicit free item membership: ${title}.`);
    itemProof.set(clean(field(box, 'name') ?? title), source.provenance);
    itemProof.set(title, source.provenance);
  }
  for (const review of spec.shops ?? []) {
    const { source, box, point } = reviewedPoint(review.page, 'Infobox Shop', 0);
    const name = clean(field(box, 'name') ?? review.page), cell = addCell(point, name, source.provenance);
    const shop = push(shops, { id: `${prefix}shop:${review.slug}`, cell, name, coordinates: [point], membership: 'free',
      reason: 'Reviewed free-to-play shop; stock includes only positive quantities with known prices and explicit free membership evidence.', provenance: [source.provenance] });
    let omitted = 0;
    for (const line of templates(source.text, 'StoreLine')) {
      const item = clean(field(line, 'name')), members = field(line, 'members')?.toLowerCase();
      const quantityText = field(line, 'stock') ?? '', priceText = field(line, 'sell') ?? '';
      const quantity = /^[\d,]+$/.test(quantityText) ? Number(quantityText.replaceAll(',', '')) : NaN;
      const price = /^free$/i.test(priceText) ? 0 : /^[\d,]+$/.test(priceText) ? Number(priceText.replaceAll(',', '')) : NaN;
      const proof = itemProof.get(item);
      if (!item || members && members !== 'no' || members !== 'no' && !proof || !ungated(line)
        || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(price) || price < 0) { omitted++; continue; }
      const variant = price === 0 ? 'free' : 'standard';
      const row = push(stock, { id: `${prefix}stock:${review.slug}:${slug(item)}:${variant}`, shopId: shop.id, cell, item,
        stock: quantity, price, variant, membership: 'free', provenance: union([source.provenance, ...(members !== 'no' ? [proof] : [])]) });
      if (!(spec.purchaseItems ?? []).includes(item)) continue;
      push(tasks, { id: `${prefix}activity:buy:${row.id.slice(`${prefix}stock:`.length)}`, sourceId: row.id, cell, skill: 'Extra', level: 1,
        label: `Buy ${item}${variant === 'free' ? ' (free sample)' : ''} from ${name} (${cell})`,
        reason: `${quantity} in stock at ${price} coins each.${price ? ` Bring ${price} coins per item.` : ' This sample costs no coins.'}`, provenance: row.provenance });
    }
    if (omitted) shop.reason += ` ${omitted} stock rows omitted for membership, availability, price, or requirements.`;
  }
  const serviceTask = service => push(tasks, { id: `${prefix}activity:${service.id.slice(prefix.length + 'service:'.length)}`,
    sourceId: service.id, cell: service.cell, skill: 'Extra', level: 1,
    label: service.kind === 'bank' ? `Use ${service.name} (${service.cell})` : `Deposit an item at ${service.name} (${service.cell})`,
    reason: service.kind === 'bank' ? `Free-to-play bank access. ${service.access}` : `Free-to-play deposit access. Bring an item to deposit. ${service.access}`, provenance: service.provenance });
  for (const review of spec.banks ?? []) {
    const { source, box, point } = reviewedPoint(review.page, 'Infobox Location', review.plane ?? 0);
    const name = source.provenance.page, cell = addCell(point, name, source.provenance);
    const service = push(services, { id: `${prefix}service:bank:${review.slug}`, kind: 'bank', cell, name,
      coordinates: [point], access: review.access ?? 'Use the bank at its mapped location.', membership: 'free', provenance: [source.provenance] });
    serviceTask(service);
  }
  for (const review of spec.serviceLocations ?? []) {
    if (!['bank', 'deposit-box'].includes(review.kind)) throw new Error(`Unknown service kind: ${review.kind}.`);
    const source = page(review.page), groups = new Map(), allowed = new Set(review.locations);
    for (const line of templates(source.text, 'ObjectLocLine')) {
      const location = clean(field(line, 'loc'));
      if (!allowed.has(location) || field(line, 'mem')?.toLowerCase() !== 'no' || field(line, 'mapid') !== '28'
        || field(line, 'plane') !== '0' || !ungated(line)) continue;
      // A deposit-box row present in the bank-chest article is not a bank.
      if (clean(field(line, 'name')) !== review.page) continue;
      for (const point of coords(line).filter(inBounds)) {
        const cell = addCell(point, location, source.provenance), id = `${prefix}service:${review.kind}:${slug(location)}:${cell}`;
        if (!groups.has(id)) groups.set(id, { id, kind: review.kind, cell, name: `${review.page} at ${location}`, coordinates: [],
          access: review.kind === 'bank' ? 'Use the surface bank chest.' : 'Deposit items into the bank; this service does not withdraw items.', membership: 'free', provenance: [source.provenance] });
        const service = groups.get(id);
        if (!service.coordinates.some(row => row.x === point.x && row.y === point.y)) service.coordinates.push(point);
      }
    }
    for (const service of groups.values()) {
      service.coordinates.sort((a, b) => a.x - b.x || a.y - b.y);
      push(services, service); serviceTask(service);
    }
  }
  for (const review of spec.routes ?? []) {
    if (review.fare !== 30) throw new Error(`Unreviewed route fare: ${review.slug}.`);
    const endpoints = [review.from, review.to].map(title => {
      const { source, point } = reviewedPoint(title, 'Infobox NPC', 0);
      return { cell: addCell(point, title, source.provenance), provenance: source.provenance };
    });
    const evidence = (review.evidence ?? []).map(row => {
      const source = page(row.page);
      if (!row.needle || !source.text.includes(row.needle)) throw new Error(`Paid route evidence changed: ${review.slug} (${row.page}).`);
      return source.provenance;
    });
    if (!evidence.length) throw new Error(`Paid route lacks reviewed evidence: ${review.slug}.`);
    const route = push(routes, { id: `${prefix}route:${review.slug}`, from: endpoints[0].cell, to: endpoints[1].cell, mode: 'boat', fare: 30,
      requirements: ['Bring 30 coins for each crossing'], reason: review.reason, membership: 'free', provenance: union([...endpoints.map(row => row.provenance), ...evidence]) });
    for (const [direction, cell, outbound] of [['outbound', route.from, true], ['return', route.to, false]]) {
      const toMusaPoint = (review.from === 'Captain Tobias') === outbound;
      push(tasks, { id: `${prefix}activity:route:${review.slug}:${direction}`, sourceId: route.id, cell, skill: 'Extra', level: 1,
        label: toMusaPoint ? 'Sail to Musa Point from Port Sarim' : 'Sail to Port Sarim from Musa Point',
        reason: `Bring 30 coins for this crossing. ${review.reason}`, supplyItems: ['Coins'], provenance: route.provenance });
    }
  }
  return { shops: sort(shops), stock: sort(stock), services: sort(services), routes: sort(routes), tasks: sort(tasks) };
}

/** Ordinary non-skill harvests and dialogue purchases, without shop semantics. */
export function buildOrdinarySupplies({ spec, pages, cells }) {
  const harvests = [], dialogueSupplies = [], tasks = [];
  const evidence = review => {
    if (!review.evidence?.length) throw new Error(`Ordinary supply lacks evidence: ${review.slug}.`);
    return union(review.evidence.map(({ page, needle }) => {
      const source = pages.get(page);
      if (!source || !needle || !source.text.includes(needle)) throw new Error(`Ordinary supply evidence changed: ${page}: ${needle}.`);
      return source.provenance;
    }));
  };
  const knownCell = cell => { if (!cells.has(cell)) throw new Error(`Ordinary supply cell is outside the reviewed slice: ${cell}.`); };
  for (const review of spec.ordinaryHarvests ?? []) {
    const source = pages.get(review.page), box = templates(source?.text ?? '', 'Infobox Scenery')[0];
    if (!box || field(box, 'members')?.toLowerCase() !== 'no' || field(box, 'options') !== 'Pick, Examine') throw new Error(`Not a reviewed free ordinary harvest: ${review.page}.`);
    const provenance = union([source.provenance, ...evidence(review)]);
    const row = templates(source.text, 'ObjectLocLine').find(row => field(row, 'loc') === review.location);
    if (!row || field(row, 'mem')?.toLowerCase() !== 'no' || !ungated(row)
      || field(row, 'plane') && field(row, 'plane') !== '0' || field(row, 'mapID') && field(row, 'mapID') !== '28') throw new Error(`Ordinary harvest location changed: ${review.slug}.`);
    const loot = templates(source.text, 'DropsLineSearch').find(row => field(row, 'name') === review.item);
    if (!loot || field(loot, 'quantity') !== '1' || field(loot, 'rarity') !== 'Common') throw new Error(`Ordinary harvest output changed: ${review.slug}.`);
    knownCell(review.cell);
    const coordinates = coords(row).filter(point => String(Math.floor(point.x / 64) * 256 + Math.floor(point.y / 64)) === review.cell);
    if (!coordinates.length) throw new Error(`Ordinary harvest has no placement in its reviewed cell: ${review.slug}.`);
    const harvest = { id: `${prefix}harvest:${review.slug}`, cell: review.cell, name: clean(field(box, 'name')),
      item: review.item, coordinates, membership: 'free', renewable: true, provenance };
    harvests.push(harvest);
    tasks.push({ id: `${prefix}activity:harvest:${review.slug}`, sourceId: harvest.id, cell: harvest.cell, skill: 'Extra', level: 1,
      label: review.label, reason: 'Pick the ordinary wild crop. No Farming level, seed or Farming experience is involved; the plant respawns. This is a renewable supply option, not an owned item.',
      objectRequirements: [harvest.name], output: [harvest.item], provenance });
  }
  for (const review of spec.dialogueSupplies ?? []) {
    const source = pages.get(review.page), box = templates(source?.text ?? '', 'Infobox NPC')[0];
    const suffix = review.variant ?? '';
    if (!box || (field(box, `members${suffix}`) ?? field(box, 'members'))?.toLowerCase() !== 'no') throw new Error(`No explicit free dialogue NPC variant: ${review.page}.`);
    const map = field(box, `map${suffix}`) ?? '';
    const coordinates = [...mapPoints(map), ...coords(map)];
    if (coordinates.length !== 1 || coordinates[0].plane !== 0) throw new Error(`Dialogue NPC placement is ambiguous: ${review.page}.`);
    const point = coordinates[0], cell = String(Math.floor(point.x / 64) * 256 + Math.floor(point.y / 64));
    knownCell(cell);
    if (cell !== review.cell || !review.paymentAlternatives?.length
      || review.paymentAlternatives.some(payment => !Object.keys(payment).length || Object.entries(payment).some(([item, count]) => !item || !Number.isSafeInteger(count) || count <= 0))) throw new Error(`Invalid reviewed dialogue payment/location: ${review.slug}.`);
    const standard = templates(source.text, 'StoreLine').find(row => field(row, 'name') === review.item && !field(row, 'quest') && (!field(row, 'quantity') || field(row, 'quantity') === '1'));
    if (!standard || field(standard, 'stock') !== 'inf') throw new Error(`Dialogue output is not reviewed repeatable supply: ${review.slug}.`);
    for (const payment of review.paymentAlternatives) for (const [item, count] of Object.entries(payment)) {
      const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (item === 'Coins' ? Number(field(standard, 'sell')) !== count
        : !new RegExp(`\\b${count} \\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]`).test(source.text)) throw new Error(`Dialogue payment differs from pinned evidence: ${review.slug}: ${item}.`);
    }
    const provenance = union([source.provenance, ...evidence(review)]);
    const supply = { id: `${prefix}dialogue-supply:${review.slug}`, cell, name: clean(field(box, 'name')), item: review.item,
      quantity: 1, coordinates, membership: 'free', mode: 'closure-only', paymentAlternatives: review.paymentAlternatives, provenance };
    dialogueSupplies.push(supply);
    tasks.push({ id: `${prefix}activity:dialogue-supply:${review.slug}`, sourceId: supply.id, cell, skill: 'Extra', level: 1,
      label: review.label, reason: review.reason, npcRequirements: [supply.name], output: [supply.item],
      dialogueSupply: { mode: supply.mode, paymentAlternatives: supply.paymentAlternatives }, provenance });
  }
  return { harvests: sort(harvests), dialogueSupplies: sort(dialogueSupplies), tasks: sort(tasks) };
}
