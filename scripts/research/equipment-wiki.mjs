import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Split wikitext only outside nested templates, links, and template arguments. */
export function splitWikiTopLevel(text, delimiter = '|') {
  const parts = []; let start = 0; const stack = [];
  for (let i = 0; i < text.length; i++) {
    const token3 = text.slice(i, i + 3), token2 = text.slice(i, i + 2);
    if (token3 === '{{{') { stack.push('}}}'); i += 2; }
    else if (stack.at(-1) === '}}}' && token3 === '}}}') { stack.pop(); i += 2; }
    else if (token2 === '{{') { stack.push('}}'); i++; }
    else if (token2 === '[[') { stack.push(']]'); i++; }
    else if (token2 === stack.at(-1)) { stack.pop(); i++; }
    else if (!stack.length && text[i] === delimiter) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start)); return parts;
}

/** All complete templates, including templates nested inside another template. */
export function parseWikiTemplates(wikitext) {
  const text = String(wikitext).replace(/<!--[\s\S]*?-->/g, '').replace(/<nowiki\b[^>]*>[\s\S]*?<\/nowiki>/gi, '');
  const stack = [], templates = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text.slice(i, i + 3) === '{{{') { stack.push({ start: i, argument: true }); i += 2; }
    else if (stack.at(-1)?.argument && text.slice(i, i + 3) === '}}}') { stack.pop(); i += 2; }
    else if (text.slice(i, i + 2) === '{{') { stack.push({ start: i, argument: false }); i++; }
    else if (text.slice(i, i + 2) === '}}' && stack.length && !stack.at(-1).argument) {
      const { start } = stack.pop(); const raw = text.slice(start, i + 2);
      const [name, ...parts] = splitWikiTopLevel(raw.slice(2, -2)); const fields = {}, positional = [], conflicts = [];
      for (const part of parts) {
        const eq = splitWikiTopLevel(part, '=');
        if (eq.length < 2) { positional.push(part.trim()); continue; }
        const key = eq.shift().trim().toLowerCase(), value = eq.join('=').trim();
        if (Object.hasOwn(fields, key) && fields[key] !== value) conflicts.push(key);
        fields[key] = value;
      }
      templates.push({ name: name.trim().replace(/_/g, ' '), fields, positional, conflicts, raw, start }); i++;
    }
  }
  return templates.sort((a, b) => a.start - b.start);
}

export function wikiPlainText(value) {
  return String(value ?? '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^>]*\/\s*>/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '').replace(/'{2,5}/g, '').replace(/&nbsp;/g, ' ').trim();
}

export function wikiNumber(value) {
  const plain = wikiPlainText(value).replace(/\u2212/g, '-');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*kg)?$/i.test(plain) ? Number(plain.replace(/\s*kg$/i, '')) : null;
}

export function wikiItemIds(value) {
  const plain = wikiPlainText(value);
  return /^\d+(?:\s*,\s*\d+)*$/.test(plain) ? plain.split(',').map(x => Number(x.trim())) : [];
}

export function wikiTemplateVariants(template) {
  const suffixes = [...new Set(Object.keys(template.fields).map(key => key.match(/\d+$/)?.[0]).filter(Boolean))].sort((a,b) => Number(a)-Number(b));
  // Suffixes occur on metadata such as release dates too; only identity/variant keys declare variants.
  const identitySuffixes = suffixes.filter(s => ['id', 'name', 'version', 'weight', 'bucketname'].some(k => Object.hasOwn(template.fields, k+s)));
  const result = identitySuffixes.length ? identitySuffixes : [''];
  return result.map(suffix => {
    const fields = {}, fieldSources = {};
    for (const [key, value] of Object.entries(template.fields)) if (!/\d+$/.test(key)) { fields[key] = value; fieldSources[key] = `${template.name}.${key}`; }
    if (suffix) for (const [key, value] of Object.entries(template.fields)) if (key.endsWith(suffix) && key.match(/\d+$/)?.[0] === suffix) { const baseKey = key.slice(0, -suffix.length); fields[baseKey] = value; fieldSources[baseKey] = `${template.name}.${key}`; }
    return { suffix, version: wikiPlainText(fields.version || fields.bucketname), name: wikiPlainText(fields.name), ids: wikiItemIds(fields.id), weight: wikiNumber(fields.weight), fields, fieldSources, conflicts: template.conflicts };
  });
}

export function parseEquipmentWikiPage(page) {
  const revision = page?.revisions?.[0];
  const content = revision?.slots?.main?.content ?? revision?.['*'] ?? page?.content ?? '';
  const templates = parseWikiTemplates(content);
  const itemTemplates = templates.filter(t => t.name.toLowerCase() === 'infobox item');
  const bonusTemplates = templates.filter(t => t.name.toLowerCase() === 'infobox bonuses');
  return { title: page?.title, pageid: page?.pageid ?? null, missing: Boolean(page?.missing), revisionId: revision?.revid ?? page?.revisionId ?? null,
    timestamp: revision?.timestamp ?? null,
    source: { title: page?.title, revisionId: revision?.revid ?? page?.revisionId ?? null, timestamp: revision?.timestamp ?? null,
      url: `https://runescape.wiki/w/${encodeURIComponent(String(page?.title).replace(/ /g, '_'))}?oldid=${revision?.revid ?? page?.revisionId ?? ''}` },
    items: itemTemplates.flatMap(wikiTemplateVariants), bonuses: bonusTemplates.flatMap(wikiTemplateVariants), itemTemplates, bonusTemplates };
}

export function selectWikiVariants(parsed, candidateIds) {
  const ids = new Set(candidateIds);
  return parsed.items.filter(variant => !hasWikiFieldConflict(variant, ['name', 'id', 'version', 'bucketname']) && variant.ids.some(id => ids.has(id)));
}

/** Duplicate conflicting binding fields cannot be resolved by last-write wins. */
export function hasWikiFieldConflict(variant, fields) {
  const names = new Set(fields);
  return (variant.conflicts ?? []).some(field => names.has(field.replace(/\d+$/, '')));
}

/** Match bonuses by declared bucket/version, never by coincidental suffix position. */
export function selectWikiBonusVariants(parsed, itemVariant) {
  if (hasWikiFieldConflict(itemVariant, ['name', 'id', 'version', 'bucketname'])) return [];
  return parsed.bonuses.filter(bonus => {
    if (hasWikiFieldConflict(bonus, ['bucketname', 'version'])) return false;
    const labels = bonus.fields.bucketname || bonus.fields.version || '';
    if (!labels) return parsed.bonuses.length === 1 && bonus.suffix === '';
    return labels.split('¦').map(label => wikiPlainText(label).toLowerCase()).includes(itemVariant.version.toLowerCase());
  });
}

/** Use only the exact item variant and its explicitly matched/shared bonus weight. */
export function resolveWikiVariantWeight(parsed, itemVariant) {
  const bonusVariants = selectWikiBonusVariants(parsed, itemVariant).filter(variant => variant.weight !== null);
  if (bonusVariants.some(variant => variant.conflicts.length)) return { weight: null, fields: [], reason: 'conflicting-wiki-infobox-fields' };
  const facts = [itemVariant, ...bonusVariants].filter(variant => variant.weight !== null);
  if (facts.some(variant => variant.weight !== facts[0].weight)) return { weight: null, fields: facts.map(variant => variant.fieldSources.weight), reason: 'conflicting-item-and-bonuses-weights' };
  return { weight: facts[0]?.weight ?? null, fields: [...new Set(facts.map(variant => variant.fieldSources.weight))], reason: null };
}

/** Resumeable local caching; one bounded API request at a time. No cache/game state writes. */
export async function fetchEquipmentWikiSnapshot({ titles, output, batchSize = 40, delayMs = 150 }) {
  let snapshot;
  try { snapshot = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  snapshot ??= { schemaVersion: 1, fetchedAt: new Date().toISOString(), api: 'https://runescape.wiki/api.php', requestedTitles: [], pages: [], resolutions: {}, batches: [] };
  const complete = new Set(snapshot.requestedTitles), unique = [...new Set(titles)], pending = unique.filter(title => !complete.has(title));
  await mkdir(dirname(output), { recursive: true });
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize), url = new URL(snapshot.api);
    for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', redirects: '1', titles: batch.join('|'), maxlag: '5' })) url.searchParams.set(key, value);
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerEquipmentResearch/1.0 (local evidence audit)' }, signal: AbortSignal.timeout(60000) });
        if (!result.ok) throw new Error(`Wiki HTTP ${result.status}`);
        response = await result.json(); if (response.error) throw new Error(JSON.stringify(response.error)); break;
      } catch (error) { if (attempt === 3) throw error; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); }
    }
    const query = response.query ?? {}, aliases = new Map([...(query.normalized ?? []), ...(query.redirects ?? [])].map(x => [x.from, x.to]));
    const pages = new Map(snapshot.pages.map(page => [page.title, page]));
    for (const page of query.pages ?? []) pages.set(page.title, page);
    snapshot.pages = [...pages.values()];
    for (const title of batch) { let target = title; const seen = new Set(); while (aliases.has(target) && !seen.has(target)) { seen.add(target); target = aliases.get(target); } snapshot.resolutions[title] = target; }
    snapshot.requestedTitles.push(...batch);
    snapshot.batches.push({ fetchedAt: new Date().toISOString(), titles: batch, normalized: query.normalized ?? [], redirects: query.redirects ?? [] });
    snapshot.completedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(snapshot));
    console.log(`Wiki snapshot ${snapshot.requestedTitles.length}/${unique.length}, ${snapshot.pages.length} canonical pages`);
    await new Promise(r => setTimeout(r, delayMs));
  }
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const picker = JSON.parse(await readFile(option('--reference', 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
  await fetchEquipmentWikiSnapshot({ titles: Object.keys(picker.equipment), output: option('--output', '.local/equipment-wiki.2026-10-08.v1.json') });
}
