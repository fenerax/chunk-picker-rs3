// The selected dataset owns rule identities and independently authored copy.
// This module only validates and renders it; no private catalogue is bundled.
export const explanationLimits = Object.freeze({ what: 340, example: 280, grindWarning: 200 });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

export function loadRuleExplanations(raw, expectedIds) {
  if (raw?.schemaVersion !== 1 || !plain(raw.entries)) throw new TypeError('Invalid rule explanations.');
  for (const [id, entry] of Object.entries(raw.entries)) {
    if (!id.trim() || !plain(entry)) throw new TypeError('Invalid rule explanation.');
    for (const [part, limit] of Object.entries(explanationLimits)) {
      const value = entry[part];
      if (part === 'grindWarning' && value === undefined) continue;
      if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > limit
        || /[<>\r\n\u0000-\u001f]/.test(value) || /\b(?:rs3:task:|[a-z]+\.[a-z]+[\w.-]*|\d{5,}(?:-\d+)?)\b/.test(value)) {
        throw new TypeError(`Invalid ${part} for rule ${id}.`);
      }
    }
    if (entry.what.split(/[.!?]\s+/).length > 2) throw new TypeError(`Too many sentences for rule ${id}.`);
    if (!Array.isArray(entry.sources) || !entry.sources.length) throw new TypeError(`Missing Wiki sources for rule ${id}.`);
    for (const source of entry.sources) {
      let url;
      try { url = new URL(source.url); } catch { throw new TypeError('Invalid Wiki revision.'); }
      if (typeof source.title !== 'string' || !source.title.trim() || source.title.length > 160
        || url.protocol !== 'https:' || url.hostname !== 'runescape.wiki' || url.port || url.username || url.password || url.hash
        || !url.pathname.startsWith('/w/') || !/^[1-9]\d*$/.test(url.searchParams.get('oldid') ?? '')
        || [...url.searchParams.keys()].some(key => key !== 'oldid')) throw new TypeError('Invalid Wiki revision.');
      Object.freeze(source);
    }
    Object.freeze(entry.sources); Object.freeze(entry);
  }
  if (expectedIds) {
    const expected = new Set(expectedIds), actual = Object.keys(raw.entries);
    if (actual.length !== expected.size || actual.some(id => !expected.has(id))) throw new TypeError('Rule explanation coverage differs from the catalogue.');
  }
  return Object.freeze(raw.entries);
}

/** Keep the decision visible and the longer example, warning and credits folded. */
export function appendRuleExplanation(ctx, host, rule) {
  const entry = rule.explanation;
  if (!entry) return false;
  const { el, details } = ctx;
  host.append(el('p', `What it does: ${entry.what}`, 'rules-explanation'));
  const extra = details(entry.grindWarning ? 'Example & grind warning' : 'Example');
  extra.className = 'rules-example';
  extra.append(el('p', `Example: ${entry.example}`));
  if (entry.grindWarning) extra.append(el('p', `Grind warning: ${entry.grindWarning}`, 'rules-grind-warning'));
  const credit = el('p', 'RuneScape Wiki sources: ', 'rules-example-sources');
  for (const [index, source] of entry.sources.entries()) {
    if (index) credit.append(el('span', ' · '));
    const link = el('a', source.title); link.href = source.url;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; credit.append(link);
  }
  extra.append(credit); host.append(extra);
  return true;
}
