import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Docs and the roadmap tell players where things are ("More → Map display"). This keeps
// those menu paths in step with the labels the picker really shows.
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

const decode = text => text.replace(/&amp;/g, '&').replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ');
const tidy = text => decode(text).replace(/\*\*|`/g, '').replace(/\s+/g, ' ');

function htmlTexts(html) {
  const texts = [...html.matchAll(/>([^<>]+)</g)].map(match => decode(match[1]).trim());
  const attributes = [...html.matchAll(/\b(?:aria-label|title)="([^"]+)"/g)].map(match => decode(match[1]));
  return [...texts, ...attributes].filter(Boolean);
}

function menuLabels(html, id) {
  const block = html.match(new RegExp(`<details[^>]* id="${id}"[\\s\\S]*?</details>`))?.[0];
  assert.ok(block, `index.html has #${id}`);
  // Section headings such as "Map" aren't things to click.
  return htmlTexts(block.replace(/<p class="menu-heading"[^>]*>[^<]*<\/p>/g, ''));
}

// String literals in a module, skipping comments and templates that interpolate.
function literals(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
    .map(match => match[1] ?? match[2] ?? match[3]).filter(text => text && !text.includes('${'))
    .map(text => text.replace(/\\(.)/g, '$1'));
}

function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

// Longest label the text starts with, ending at a word boundary.
function matchLabel(text, labels) {
  return labels.find(label => text.startsWith(label) && !/^[\p{L}\p{N}]/u.test(text.slice(label.length)));
}

async function sources() {
  const docs = (await readdir(new URL('docs/', root))).filter(name => name.endsWith('.md')).map(name => `docs/${name}`);
  const files = await Promise.all([...docs, 'README.md'].map(async path => ({ path, text: tidy(await read(path)) })));
  const roadmap = JSON.parse(await read('app/data/roadmap.json'));
  return [...files, { path: 'app/data/roadmap.json', text: tidy(strings(roadmap).join(' \n ')) }];
}

test('menu paths in the docs and roadmap name labels the picker shows', async () => {
  const html = await read('app/web/index.html');
  const web = await readdir(new URL('app/web/', root));
  const scripts = Object.fromEntries(await Promise.all(web.filter(name => name.endsWith('.mjs'))
    .map(async name => [name, await read(`app/web/${name}`)])));

  // Buttons other modules add to More at runtime.
  const inserted = { 'original-sync-loader.mjs': 'Sync from original picker', 'screen-usage.mjs': 'Usage settings' };
  for (const [name, label] of Object.entries(inserted)) assert.ok(literals(scripts[name]).includes(label), `${name} still adds ${label}`);

  const settingsSections = scripts['settings-panel.mjs'].match(/const sections = \[[\s\S]*?\n\];/)?.[0];
  assert.ok(settingsSections, 'settings-panel.mjs keeps its sections list');
  const settingsExtras = ['Advanced', 'Ready for members', 'Older settings'];
  for (const label of settingsExtras) assert.ok(literals(scripts['settings-panel.mjs']).includes(label), `Settings still shows ${label}`);

  const byLength = labels => [...new Set(labels.map(label => label.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const roots = {
    More: byLength([...menuLabels(html, 'more-tools'), ...Object.values(inserted)]),
    Info: byLength(menuLabels(html, 'info-tools')),
    Admin: byLength(menuLabels(html, 'admin-tools')),
    Settings: byLength([...[...settingsSections.matchAll(/label: '([^']+)'/g)].map(match => match[1]), ...settingsExtras]),
    'Activity Info': byLength(literals(scripts['info-panels.mjs'])),
  };
  // Deeper steps live in dialogs, so any label the picker defines will do.
  const anywhere = byLength([...htmlTexts(html), ...Object.values(scripts).flatMap(literals)]);

  const failures = [];
  let checked = 0;
  for (const { path, text } of await sources()) {
    for (const match of text.matchAll(/(?<!→ )(?<!Activity )\b(Activity Info|More|Info|Admin|Settings) → /g)) {
      let rest = text.slice(match.index + match[0].length), labels = roots[match[1]], trail = match[1];
      for (let depth = 0; ; depth++) {
        const label = matchLabel(rest, labels);
        if (!label) { failures.push(`${path}: ${trail} → ${rest.slice(0, 40)}`); break; }
        trail += ` → ${label}`; rest = rest.slice(label.length);
        if (!rest.startsWith(' → ')) break;
        rest = rest.slice(3);
        labels = depth === 0 && roots[label] ? roots[label] : anywhere;
      }
      checked++;
    }
  }
  assert.ok(checked >= 20, `found ${checked} menu paths; the pattern may have stopped matching`);
  assert.deepEqual(failures, []);
});
