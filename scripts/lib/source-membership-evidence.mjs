/** Read the first typed, balanced source infobox. Nested recipes/drop tables
 * cannot supply membership fields for the named source itself. Mixed or
 * unrecognized values remain unknown rather than certifying membership.
 */
export function sourceInfobox(text) {
  const start = /\{\{Infobox (Monster|NPC|Shop|Scenery|Location|Area|Quest|Prayer|Spell)\b/i.exec(text);
  if (!start) return null;
  let depth = 1, end = start.index + start[0].length, body = '';
  for (; end < text.length && depth; end++) {
    if (text.slice(end, end + 2) === '{{') { depth++; end++; }
    else if (text.slice(end, end + 2) === '}}') { depth--; end++; }
    else if (depth === 1) body += text[end];
  }
  if (depth) return null;
  const fields = [...body.matchAll(/^\|\s*members\d*\s*=\s*([^\n|]*)/gmi)].map(match => match[1].replace(/<!--.*?-->/g, '').trim());
  const values = fields.map(value => /^(yes|true)$/i.test(value) ? true : /^(no|false)$/i.test(value) ? false : null);
  const type = start[1].toLowerCase() === 'npc' ? 'NPC' : start[1][0].toUpperCase() + start[1].slice(1).toLowerCase();
  const names = [...body.matchAll(/^\|\s*name\d*\s*=\s*([^\n|]*)/gmi)].map(match => match[1].trim());
  const ids = [...body.matchAll(/^\|\s*id\d*\s*=\s*([^\n|]*)/gmi)].flatMap(match => /^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(match[1]) ? match[1].split(',').map(value => Number(value.trim())) : []);
  const ambiguous = /\{\{\s*(otheruses|other uses|disambig|disambiguation)\b/i.test(text.slice(0, start.index));
  return { type, fields, names, ids, ambiguous, members: values.length && values.every(value => value === values[0]) ? values[0] : null };
}

export const sourceIdentityName = value => String(value).normalize('NFC').replace(/[’‘]/g, "'").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target).replaceAll('_', ' ').trim().toLowerCase();
