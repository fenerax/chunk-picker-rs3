import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld } from '../app/data/world.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

// Keep the reference fixture's twelve north-to-south cells; smaller grids
// continue in the next column so every synthetic editor target stays on-map.
const chunkId = index => String(SURFACE_GRID.startId + Math.floor(index / SURFACE_GRID.rows) * SURFACE_GRID.stride - index % SURFACE_GRID.rows);
import { resolveMemberStickers, resolveStartingChunk } from '../app/core/map-markers.mjs';
import { applyTheme, contrastRatio, createMapTools, recentRolls, themePalettes } from '../app/web/map-tools.mjs';

const world = buildWorld({
  chunks: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [chunkId(index), {}])),
  walkableChunks: [], walkableChunksF2P: [],
});
const at = minute => `2026-10-07T10:${String(minute).padStart(2, '0')}:00Z`;
function fixture() {
  return {
    members: [
      { id: 'player1', name: 'Player 1', sourceMapId: 'qxa', unlocked: [chunkId(0)], preferences: {} },
      { id: 'player2', name: 'Player 2', sourceMapId: 'qxb', unlocked: [], preferences: {} },
    ],
    history: [], legacy: { maps: { qxa: {}, qxb: {} } },
  };
}

const tokenValues = new Map(readFileSync(new URL('../docs/design-token-values.tsv', import.meta.url), 'utf8').trim().split('\n').slice(1).map(row => row.replace(/\r$/, '').split('\t')));
const stylesheet = readFileSync(new URL('../app/web/style.css', import.meta.url), 'utf8')
  .replace(/var\((--[\w-]+)\)/g, (value, token) => tokenValues.get(token) ?? value);
const cssRules = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body }));
function declarations(selector) {
  const rule = cssRules.find(rule => rule.selector === selector);
  assert.ok(rule, `Missing stylesheet rule: ${selector}`);
  return Object.fromEntries(rule.body.split(';').filter(Boolean).map(declaration => {
    const colon = declaration.indexOf(':');
    return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
  }));
}
function themeVariables(theme, completedTaskColor) {
  const values = new Map(), root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value) } };
  applyTheme(root, theme, completedTaskColor);
  return values;
}
function resolveColor(value, variables) {
  if (value.startsWith('var(')) {
    const [, key, fallback] = value.match(/^var\((--[\w-]+)(?:,(.*))?\)$/);
    return variables.get(key) ?? resolveColor(fallback, variables);
  }
  return value;
}
function compositeCSS(value, backdrop, variables) {
  const [, variable, percent] = value.match(/^color-mix\(in srgb,var\((--[\w-]+)\) (\d+)%,transparent\)$/);
  const front = resolveColor(`var(${variable})`, variables), fraction = Number(percent) / 100;
  // Browser srgb color-mix over an opaque ancestor, independently of applyTheme.
  return `#${[1, 3, 5].map(offset => Math.round(parseInt(front.slice(offset, offset + 2), 16) * fraction + parseInt(backdrop.slice(offset, offset + 2), 16) * (1 - fraction)).toString(16).padStart(2, '0')).join('')}`;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function editorFixture(stickers = []) {
  const state = fixture(); state.revision = 9;
  state.members[0].stickers = { [chunkId(0)]: stickers };
  class Element {
    constructor(tag, text, className) { this.tag = tag; this.textContent = text; this.className = className; this.children = []; this.events = {}; this.style = {}; this.value = ''; this.disabled = false; this.isConnected = true; this.replacements = 0; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this.replacements++; }
    addEventListener(type, callback) { this.events[type] = callback; }
    setAttribute(key, value) { (this.attributes ??= {})[key] = value; }
    focus() {}
  }
  const el = (...args) => new Element(...args);
  let generation = 0, content;
  const writes = [], closures = [], errors = [], centers = [];
  const ctx = {
    state: () => state, memberId: () => 'player1', world: () => world, preferences: () => ({}), el,
    button: (text, handler) => { const node = el('button', text); node.click = handler; return node; },
    input: (type, value = '') => { const node = el('input'); node.type = type; node.value = value; return node; },
    select: (options, value) => { const node = el('select'); node.value = value; return node; },
    field: (label, control) => { const node = el('label', label); node.append(control); return node; },
    openDialog: (title, node) => { content = node; return ++generation; },
    dialogGeneration: () => generation, dialogCurrent: token => token === generation,
    closeDialog: token => { if (token === generation) { closures.push(token); generation++; } },
    command: (command, revision) => { const pending = deferred(); writes.push({ command, revision, ...pending }); return pending.promise; },
    showError: error => errors.push(error), centerOnChunk: id => centers.push(id),
  };
  const find = (predicate, node = content) => predicate(node) ? node : node.children.map(child => find(predicate, child)).find(Boolean);
  return { tools: createMapTools(ctx), ctx, state, writes, closures, errors, centers, find };
}

test('deferred sticker font preview belongs to the editor that opened it', async () => {
  const previousFont = globalThis.FontFace, previousDocument = globalThis.document, font = deferred();
  globalThis.FontFace = class { load() { return font.promise; } };
  globalThis.document = { fonts: { add() {} } };
  try {
    const editor = editorFixture();
    editor.tools.sticker(chunkId(0));
    const preview = editor.find(node => node.className === 'marker-preview');
    assert.equal(preview.replacements, 1);
    editor.ctx.openDialog('New dialog', {});
    const current = editorFixture();
    current.tools.sticker(chunkId(0));
    const currentPreview = current.find(node => node.className === 'marker-preview');
    font.resolve({});
    await font.promise; await Promise.resolve(); await Promise.resolve();
    assert.equal(preview.replacements, 1, 'connected but stale previews must not rerender');
    assert.equal(currentPreview.replacements, 2, 'current previews receive the loaded font');
  } finally {
    if (previousFont === undefined) delete globalThis.FontFace; else globalThis.FontFace = previousFont;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

