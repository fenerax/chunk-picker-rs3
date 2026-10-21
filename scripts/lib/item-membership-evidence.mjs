import { normalizeItemMembershipName } from '../../app/data/item-membership-index.mjs';
import { stripTaskMarkup } from '../../app/tasks/migration.mjs';
import { collectPickerItemNames } from '../cache/game-data-items.mjs';

/** Exact item selectors only; labels/outputs also include aliases and stay auditable. */
export function runtimeItemNames(definitions) {
  const names = new Map();
  const add = (name, origin) => {
    if (typeof name !== 'string' || !name) return;
    const clean = normalizeItemMembershipName(stripTaskMarkup(name));
    const origins = names.get(clean) ?? new Set(); origins.add(origin); names.set(clean, origins);
  };
  for (const row of collectPickerItemNames(definitions)) for (const origin of row.origins) add(row.name, origin);
  for (const [category, tasks] of Object.entries(definitions.challenges ?? {})) for (const [label, task] of Object.entries(tasks)) {
    for (const name of Array.isArray(task.Items) ? task.Items : []) add(name, `challenge:${category}:${label}:Items`);
    if (typeof task.Output === 'string') add(task.Output, `challenge:${category}:${label}:Output`);
  }
  for (const name of Object.keys(definitions.taskUnlocks?.Items ?? {})) add(name, 'taskUnlocks.Items');
  for (const chunk of Object.values(definitions.chunks ?? {})) for (const field of ['Items','Spawn'])
    for (const name of Object.keys(chunk[field] ?? {})) add(name, `chunks.${field}`);
  for (const table of ['dropTables','boostItems']) for (const values of Object.values(definitions.codeItems?.[table] ?? {}))
    Object.keys(values).forEach(name=>add(name,`codeItems.${table}`));
  for (const table of ['elementalStaves','ammoTools']) for (const [name,values] of Object.entries(definitions.codeItems?.[table] ?? {})) {
    add(name,`codeItems.${table}`);
    (Array.isArray(values) ? values : Object.keys(values)).forEach(value=>add(value,`codeItems.${table}`));
  }
  for (const table of ['boneItems','elementalRunes']) for (const name of Object.values(definitions.codeItems?.[table] ?? {})) add(name,`codeItems.${table}`);
  for (const table of ['rangedItems','tools','magicTools','telegrabSpawns']) for (const name of Object.keys(definitions.codeItems?.[table] ?? {})) add(name,`codeItems.${table}`);
  return [...names].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,origins])=>({name, origins:[...origins].sort()}));
}

/** Read only the first balanced Item infobox, avoiding Recipe members fields. */
export function wikiItemFacts(page) {
  const revision = page.revisions?.[0], text = revision?.slots?.main?.content ?? '';
  const start = /\{\{Infobox Item\s*[\n|]/i.exec(text)?.index;
  if (start === undefined) return { title:page.title, revid:revision?.revid ?? null, reason:page.missing ? 'missing-page' : 'no-item-infobox', ids:[], variants:[] };
  let depth = 0, end = start;
  for (; end < text.length - 1; end++) {
    const pair = text.slice(end,end+2);
    if (pair === '{{') { depth++; end++; }
    else if (pair === '}}') { depth--; end++; if (!depth) { end++; break; } }
  }
  const fields = new Map([...text.slice(start,end).matchAll(/^\|\s*(id\d*|members\d*)\s*=\s*([^\n]*)/gmi)]
    .map(match=>[match[1].toLowerCase(),match[2].trim()]));
  const flag = value => /^(yes|true)$/i.test(value ?? '') ? true : /^(no|false)$/i.test(value ?? '') ? false : null;
  const variants = [...fields].filter(([key])=>key.startsWith('id')).flatMap(([key,value])=>{
    if (!/^\d+(?:\s*,\s*\d+)*$/.test(value)) return [];
    const suffix = key.slice(2), memberField = fields.has(`members${suffix}`) ? `members${suffix}` : 'members';
    return value.split(',').map(id=>({id:Number(id),members:flag(fields.get(memberField)),memberField}));
  });
  return { title:page.title, pageid:page.pageid, revid:revision.revid, timestamp:revision.timestamp,
    url:`https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}?oldid=${revision.revid}`,
    fields:Object.fromEntries(fields), ids:variants.map(row=>row.id), variants,
    reason:variants.length ? 'explicit-infobox-item-ids' : 'no-literal-item-ids' };
}

export function crosscheckItemMembership(entry, facts, rawById) {
  const variants = facts.variants.filter(v=>{
    const raw = rawById.get(v.id)?.definition;
    return raw?.name && normalizeItemMembershipName(raw.name) === entry.name &&
      (entry.freeIds.includes(v.id) || entry.memberIds.includes(v.id));
  });
  const ids = variants.map(v=>v.id);
  if (!ids.length) return { name:entry.name, title:facts.title, revid:facts.revid, status:'no-matching-explicit-ids', ids:[] };
  if (variants.some(v=>v.members === null) || new Set(variants.map(v=>v.members)).size > 1)
    return { name:entry.name, title:facts.title, revid:facts.revid, status:'ambiguous-wiki-members', ids };
  const members = variants[0].members;
  if (ids.some(id=>(entry.memberIds.includes(id)) !== members))
    return { name:entry.name, title:facts.title, revid:facts.revid, status:'cache-wiki-disagreement', members, ids };
  const resolution = { members, ids, title:facts.title, revid:facts.revid, timestamp:facts.timestamp, url:facts.url };
  return { name:entry.name, title:facts.title, revid:facts.revid,
    status:entry.members === null ? 'conflict-resolved-by-explicit-wiki-ids' : 'match', members, ids, resolution };
}
