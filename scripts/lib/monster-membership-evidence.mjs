import { sourceIdentityName } from './source-membership-evidence.mjs';

/** Each typed entity is parsed separately, including entities inside a Multi
 * infobox. Only fields at that entity's own depth supply membership. */
export function monsterInfoboxes(text) {
  const result = [];
  for (const match of text.matchAll(/\{\{Infobox (Monster|NPC)\b/gi)) {
    let depth = 1, body = '', cursor = match.index + match[0].length;
    for (; cursor < text.length && depth; cursor++) {
      if (text.slice(cursor, cursor + 2) === '{{') { depth++; cursor++; }
      else if (text.slice(cursor, cursor + 2) === '}}') { depth--; cursor++; }
      else if (depth === 1) body += text[cursor];
    }
    if (depth) continue;
    const fields = Object.fromEntries([...body.matchAll(/^\|[ \t]*(\w+)[ \t]*=[ \t]*([^\n]*)/gm)].map(row => [row[1].toLowerCase(), row[2].replace(/<!--.*?-->/g, '').trim()]));
    const memberFields = Object.entries(fields).filter(([key]) => /^members\d*$/.test(key));
    const values = memberFields.map(([, value]) => /^(yes|true)$/i.test(value) ? true : /^(no|false)$/i.test(value) ? false : null);
    result.push({ type: match[1].toLowerCase() === 'npc' ? 'NPC' : 'Monster', fields,
      names: Object.entries(fields).filter(([key]) => /^name\d*$/.test(key)).map(([, value]) => sourceIdentityName(value)),
      memberFields, members: values.length && values.every(value => value === values[0]) ? values[0] : null });
  }
  return result;
}

export function monsterVariantMembership(box, selector) {
  const matches = Object.entries(box.fields).filter(([key, value]) => /^version\d*$/.test(key) && sourceIdentityName(value) === sourceIdentityName(selector));
  if (matches.length !== 1) return null;
  const suffix = matches[0][0].slice('version'.length);
  const value = box.fields[`members${suffix}`] ?? box.fields.members;
  return /^(yes|true)$/i.test(value ?? '') ? true : /^(no|false)$/i.test(value ?? '') ? false : null;
}

export function monsterVariants(box) {
  const versions = Object.entries(box.fields).filter(([key]) => /^version\d*$/.test(key));
  const ids = value => /^\d+(?:\s*,\s*\d+)*$/.test(value ?? '') ? value.split(',').map(Number) : [];
  return (versions.length ? versions : [['version', 'Default']]).map(([key, version]) => {
    const suffix = key.slice('version'.length), raw = box.fields[`members${suffix}`] ?? box.fields.members;
    return { version, name: box.fields[`name${suffix}`] ?? box.fields.name ?? null,
      npcIds: ids(box.fields[`id${suffix}`] ?? box.fields.id),
      members: /^(yes|true)$/i.test(raw ?? '') ? true : /^(no|false)$/i.test(raw ?? '') ? false : null,
      memberValue: raw ?? null };
  });
}
