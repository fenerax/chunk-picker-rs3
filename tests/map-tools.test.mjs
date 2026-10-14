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
      { id: 'actor1', name: 'Player', sourceMapId: 'bbb', unlocked: [chunkId(0)], preferences: {} },
      { id: 'reed', name: 'Reed', sourceMapId: 'aaa', unlocked: [], preferences: {} },
    ],
    history: [], legacy: { maps: { bbb: {}, aaa: {} } },
  };
}

test('recent rolls use confirmed personal records and reject pending, undone, marker and unknown records', () => {
  const state = fixture();
  state.legacy.maps.bbb.chunkOrder = { [Date.parse(at(0))]: Number(chunkId(0)) };
  state.legacy.maps.aaa.chunkOrder = { [Date.parse(at(9))]: Number(chunkId(10)) };
  state.history = [
    { type: 'roll', revision: 1, at: at(1), command: { memberId: 'actor1', count: 2, rolled: [chunkId(1), chunkId(2)] } },
    { type: 'unlock-selection', revision: 2, at: at(2), command: { memberId: 'actor1', chunkId: chunkId(1) } },
    { type: 'roll', revision: 3, at: at(3), undoneRevision: 4, command: { memberId: 'actor1', count: 1, rolled: [chunkId(2)] } },
    { type: 'set-starting-chunk', revision: 5, at: at(4), command: { memberId: 'actor1', chunkId: chunkId(3) } },
    { type: 'random-start', revision: 6, at: at(5), command: { memberId: 'actor1', count: 2, rolled: [chunkId(3), chunkId(4)] } },
    { type: 'roll', revision: 7, at: at(6), command: { memberId: 'reed', count: 1, rolled: [chunkId(9)] } },
    { type: 'roll', revision: 8, at: 'invalid-date', command: { memberId: 'actor1', count: 1, rolled: [chunkId(5)] } },
    { type: 'roll', revision: 9, at: at(7), command: { memberId: 'actor1', count: 1, rolled: ['99999'] } },
  ];
  const before = structuredClone(state);
  assert.deepEqual(recentRolls(state, 'actor1', world), [
    { id: chunkId(1), at: Date.parse(at(2)), source: 'Chosen roll', revision: 2, unlocked: false },
    { id: chunkId(0), at: Date.parse(at(0)), source: 'Imported roll', revision: undefined, unlocked: true },
  ]);
  assert.deepEqual(recentRolls(state, 'reed', world).map(roll => roll.id), [chunkId(10), chunkId(9)]);
  assert.deepEqual(state, before);
  assert.deepEqual(recentRolls(state, 'actor1', world, 0), []);
  assert.throws(() => recentRolls(state, 'missing', world), /Unknown member/);
  assert.throws(() => recentRolls(state, 'actor1', world, -1), /limit/);
});

test('same-timestamp unlock-both records retain both choices and sort five recent chunks by revision', () => {
  const state = fixture();
  state.history = [
    { type: 'unlock-both', revision: 1, at: at(1), command: { memberId: 'actor1' },
      undo: { members: [{ id: 'actor1', pendingRoll: [chunkId(0), chunkId(1)] }] } },
    { type: 'unlock-both', revision: 2, at: at(1), command: { memberId: 'actor1' },
      undo: { memberChanges: [{ id: 'actor1', changes: [
        { path: ['pendingRoll'], before: { exists: true, value: [chunkId(2), chunkId(3)] } },
      ] }] } },
    { type: 'roll', revision: 3, at: at(1), command: { memberId: 'actor1', count: 1, rolled: [chunkId(4)] } },
  ];
  const recent = recentRolls(state, 'actor1', world);
  assert.equal(recent.length, 5);
  assert.deepEqual(recent.map(roll => roll.id), [chunkId(4), chunkId(2), chunkId(3), chunkId(0), chunkId(1)]);
  assert.deepEqual(recent.map(roll => roll.revision), [3, 2, 2, 1, 1]);
  assert.equal(recent.filter(roll => roll.source === 'Both roll choices').length, 4);
});

test('imported recent records decode numeric keys and only collapse immediate duplicate rolls', () => {
  const state = fixture();
  const timestamp = Date.parse(at(0));
  state.legacy.maps.bbb.chunkOrder = {
    [`*fb*_${timestamp}`]: Number(chunkId(0)),
    [`*fb*_${timestamp + 5000}`]: Number(chunkId(0)),
    [`*fb*_${timestamp + 20000}`]: Number(chunkId(0)),
    invalid: Number(chunkId(1)),
  };
  const recent = recentRolls(state, 'actor1', world);
  assert.deepEqual(recent.map(roll => roll.at), [timestamp + 20000, timestamp + 5000]);
  assert.ok(recent.every(roll => roll.source === 'Imported roll'));
});

test('markers preserve owner isolation, normalize imported metadata and let null mask an inherited sticker', () => {
  const state = fixture();
  state.legacy.maps.bbb.chunks = {
    stickered: { [`*fb*_${chunkId(0)}`]: 'star', [chunkId(1)]: 'flag', [chunkId(2)]: 'unknown-icon' },
    stickeredColors: { [`*fb*_${chunkId(0)}`]: '-_-23FF0000' },
    stickeredNotes: { [`*fb*_${chunkId(0)}`]: 'Mine-_-20west' },
  };
  state.legacy.maps.aaa.chunks = { stickered: { [chunkId(0)]: 'heart' }, stickeredNotes: { [chunkId(0)]: 'Reed’s marker' } };
  state.members[0].stickers = { [chunkId(1)]: null, [chunkId(3)]: { type: 'attack', color: '#00ff00', text: 'Train here' } };
  const before = structuredClone(state);
  const personal = resolveMemberStickers(state, state.members[0]);
  assert.deepEqual(personal[chunkId(0)], [{ id: `legacy-sticker-${chunkId(0)}`, type: 'star', color: '#FF0000', text: 'Mine west' }]);
  assert.deepEqual(personal[chunkId(1)], []);
  assert.equal(Object.hasOwn(personal, chunkId(2)), false);
  assert.deepEqual(personal[chunkId(3)], [{ id: `legacy-sticker-${chunkId(3)}`, ...state.members[0].stickers[chunkId(3)] }]);
  assert.equal(resolveMemberStickers(state, state.members[1])[chunkId(0)][0].type, 'heart');
  personal[chunkId(0)][0].text = 'Modified result';
  personal[chunkId(3)][0].text = 'Another modified result';
  assert.deepEqual(state, before);
});

test('starting markers inherit per owner and clearing or moving one never grants access', () => {
  const state = fixture();
  state.legacy.maps.bbb.settings = { startingChunk: chunkId(1) };
  state.legacy.maps.aaa.settings = { startingChunk: chunkId(2) };
  state.members[0].unlocked = [];
  assert.equal(resolveStartingChunk(state, state.members[0]), chunkId(1));
  assert.equal(resolveStartingChunk(state, state.members[1]), chunkId(2));
  state.members[0].preferences.startingChunk = '';
  assert.equal(resolveStartingChunk(state, state.members[0]), null);
  assert.equal(resolveStartingChunk(state, state.members[1]), chunkId(2));
  state.members[0].preferences.startingChunk = chunkId(3);
  const before = structuredClone(state);
  assert.equal(resolveStartingChunk(state, state.members[0]), chunkId(3));
  assert.deepEqual(state.members[0].unlocked, []);
  assert.deepEqual(state, before);
});

test('contrast calculations match known WCAG reference pairs', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.478089453577214) < 1e-10);
  assert.ok(Math.abs(contrastRatio('#0000ff', '#ffffff') - 8.592471358428805) < 1e-10);
});

test('all ten themes derive readable component foregrounds without changing their palettes', () => {
  // Light and gray are authored for the duo picker; the other eight keep the retained colours.
  assert.deepEqual(Object.keys(themePalettes), ['light', 'gray', 'dark', 'terminal', 'neon', 'pumpkin', 'mono', 'winter', 'autumn', 'voyage']);
  const before = structuredClone(themePalettes);
  for (const [theme, palette] of Object.entries(themePalettes)) {
    const values = new Map(), root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value) } };
    applyTheme(root, theme);
    assert.equal(root.dataset.theme, theme);
    assert.equal(root.style.colorScheme, palette.scheme);
    for (const [background, keys] of [
      [palette.bg, ['text', 'muted', 'link']],
      [palette.panel, ['panel-text', 'panel-muted', 'panel-link']],
      [palette.surface, ['surface-text', 'surface-muted', 'surface-link']],
    ]) for (const key of keys) assert.ok(contrastRatio(values.get(`--${key}`), background) >= 4.5, `${theme}: ${key}`);
  }
  assert.deepEqual(themePalettes, before);
});

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

test('stylesheet consumers use readable link, surface, focus and completed colors in every theme', () => {
  const panelSelector = ':is(.topbar,.floating-panel,.empty-map,.task-sidebar,dialog,.startup-error,.recent-panel,.roll-presentation,.map-summary,#map-tooltip)';
  const surfaceSelector = ':is(.roll-card,.data-preview,.info-table th)';
  assert.equal(declarations('a').color, 'var(--context-link,var(--link))');
  assert.equal(declarations(':focus-visible').outline, '2px solid var(--focus)');
  const completedRule = declarations('.task-row[data-completed=true] .task-label-button');
  assert.equal(completedRule.color, 'var(--completed-colour,#a5d2be)');
  const section = declarations('.task-list>section'), hover = declarations('.task-row:hover');
  for (const theme of Object.keys(themePalettes)) {
    for (const preference of ['#a5d2be', '#000000', '#ffffff', '#ff0000', '#00ff00']) {
      const variables = themeVariables(theme, preference);
      const check = (foreground, background, minimum, consumer) => assert.ok(contrastRatio(resolveColor(foreground, variables), background) >= minimum, `${theme}/${preference}: ${consumer}`);
      check(declarations('a').color, variables.get('--bg'), 4.5, 'body link');
      for (const selector of ['.topbar', '.floating-panel', '.empty-map', '.task-sidebar', 'dialog', '.startup-error', '.roll-presentation']) {
        const background = resolveColor(declarations(selector).background, variables);
        check(declarations(panelSelector)['--context-link'], background, 4.5, `${selector} link`);
      }
      for (const selector of ['.roll-card', '.data-preview', '.info-table th']) {
        const rule = declarations(selector), background = resolveColor(rule.background, variables);
        check(rule.color, background, 4.5, `${selector} text`);
        check(declarations(surfaceSelector)['--context-link'], background, 4.5, `${selector} link`);
      }
      // Category headings are flat labels; links still use the panel link colour.
      const heading = declarations('.category-heading'), headingBackground = resolveColor(heading.background, variables);
      check(heading.color, headingBackground, 4.5, '.category-heading text');
      check(heading['--context-link'], headingBackground, 4.5, '.category-heading link');
      const badge = declarations('.task-heading span');
      check(badge.color, resolveColor(badge.background, variables), 4.5, 'task count');
      for (const background of ['--bg', '--panel', '--surface']) check('var(--focus)', variables.get(background), 3, `focus against ${background}`);
      const normal = compositeCSS(section.background, variables.get('--panel'), variables);
      const hovered = compositeCSS(hover.background, normal, variables);
      for (const [state, background] of [['normal', normal], ['hover', hovered]]) {
        check(completedRule.color, background, 4.5, `completed task ${state}`);
        check(section.color, background, 4.5, `task text ${state}`);
        check(section['--context-link'], background, 4.5, `task link ${state}`);
        check(declarations('.task-meta').color, background, 4.5, `task metadata ${state}`);
        check(declarations('.blocked-reason').color, background, 4.5, `blocked reason ${state}`);
      }
    }
  }
});

test('disabled toolbar text retains full opacity and readable contrast in every theme', () => {
  assert.equal(declarations('.map-toolbar button:disabled').opacity, '1');
  assert.equal(declarations('.map-toolbar button:disabled').background, 'transparent');
  assert.equal(declarations('.toolbar-group').background, 'var(--panel)');
  for (const [theme, palette] of Object.entries(themePalettes)) {
    const variables = themeVariables(theme, '#a5d2be');
    const color = resolveColor(declarations('.map-toolbar button:disabled').color, variables);
    assert.ok(contrastRatio(color, palette.panel) >= 4.5, `${theme}: disabled Undo contrast`);
  }
});

test('displayed completed colors preserve a readable preference and do not mutate saved preferences', () => {
  const preferences = { theme: 'dark', completedTaskColor: '#a5d2be' }, before = structuredClone(preferences);
  assert.equal(themeVariables(preferences.theme, preferences.completedTaskColor).get('--completed-colour'), preferences.completedTaskColor);
  assert.notEqual(themeVariables('winter', preferences.completedTaskColor).get('--completed-colour'), preferences.completedTaskColor);
  assert.deepEqual(preferences, before);
  const values = new Map(), root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value) } };
  applyTheme(root, 'missing');
  assert.equal(root.dataset.theme, 'dark');
});

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
    state: () => state, memberId: () => 'actor1', world: () => world, preferences: () => ({}), el,
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

test('sticker save completion and errors cannot close or touch a newer dialog', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const editor = editorFixture();
    editor.tools.sticker(chunkId(0));
    const save = editor.find(node => node.textContent === 'Save sticker');
    const pending = save.click();
    assert.equal(save.disabled, true);
    assert.equal(editor.writes[0].command.memberId, 'actor1');
    assert.equal(editor.writes[0].revision, 9);
    editor.ctx.openDialog('New dialog', {});
    editor.writes[0][outcome](outcome === 'reject' ? new Error('Save failed') : undefined);
    await pending;
    assert.deepEqual(editor.closures, []);
    assert.deepEqual(editor.errors, []);
    assert.equal(save.disabled, true, 'stale finally must not touch the old control');
    await save.click();
    assert.equal(editor.writes.length, 1, 'stale editor cannot submit again');
  }
});

test('starting marker continuations do not move the map or close a replacement dialog', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const editor = editorFixture();
    editor.tools.startingChunk();
    const search = editor.find(node => node.type === 'search');
    search.value = chunkId(0); search.events.input();
    const choose = editor.find(node => node.textContent === 'Set starting marker');
    const pending = choose.click();
    editor.ctx.openDialog('New dialog', {});
    editor.writes[0][outcome](outcome === 'reject' ? new Error('Save failed') : undefined);
    await pending;
    assert.deepEqual(editor.centers, []);
    assert.deepEqual(editor.closures, []);
    assert.deepEqual(editor.errors, []);
  }
  const editor = editorFixture();
  editor.tools.startingChunk();
  const clear = editor.find(node => node.textContent === 'Clear starting marker');
  const pending = clear.click(); editor.writes[0].resolve(); await pending;
  assert.deepEqual(editor.closures, [1]);
  assert.equal(editor.writes[0].command.chunkId, null);
});

test('current marker editors finish successfully and keep failed sticker saves retryable', async () => {
  const sticker = editorFixture();
  sticker.tools.sticker(chunkId(0));
  const save = sticker.find(node => node.textContent === 'Save sticker');
  let pending = save.click();
  const error = new Error('Save failed'); sticker.writes[0].reject(error); await pending;
  assert.deepEqual(sticker.errors, [error]);
  assert.equal(save.disabled, false);
  pending = save.click(); sticker.writes[1].resolve(); await pending;
  assert.deepEqual(sticker.closures, [], 'list editor remains open for consecutive additions');
  assert.equal(save.disabled, false);
  const starting = editorFixture();
  starting.tools.startingChunk();
  const search = starting.find(node => node.type === 'search');
  search.value = chunkId(0); search.events.input();
  pending = starting.find(node => node.textContent === 'Set starting marker').click();
  starting.writes[0].resolve(); await pending;
  assert.deepEqual(starting.centers, [chunkId(0)]);
  assert.deepEqual(starting.closures, [1]);
});


test('full sticker editor adds, updates, removes and clears by id while advancing its reviewed revision', async () => {
  const original = { id: 'first', type: 'star', color: '#ffffff', text: 'Original label' };
  const editor = editorFixture([original]); editor.tools.sticker(chunkId(0));
  const save = editor.find(node => node.textContent === 'Save sticker');
  const label = editor.find(node => node.tag === 'textarea'), color = editor.find(node => node.type === 'color');
  label.value = 'Revised label'; color.value = '#123456';
  let pending = save.click();
  assert.deepEqual(editor.writes[0].command, { type: 'update-sticker', memberId: 'actor1', chunkId: chunkId(0), stickerId: 'first', sticker: { type: 'star', color: '#123456', text: 'Revised label' } });
  await save.click(); assert.equal(editor.writes.length, 1, 'busy save cannot enqueue again');
  editor.state.revision = 10; editor.state.members[0].stickers[chunkId(0)] = [{ ...original, color: '#123456', text: 'Revised label' }];
  editor.writes[0].resolve({ state: editor.state }); await pending;
  editor.find(node => node.textContent === 'New sticker').click();
  editor.find(node => node.attributes?.['aria-label'] === 'heart').click(); label.value = 'Added label';
  pending = save.click();
  assert.equal(editor.writes[1].revision, 10);
  assert.equal(editor.writes[1].command.type, 'add-sticker');
  assert.equal(editor.writes[1].command.sticker.type, 'heart');
  editor.state.revision = 11; editor.state.members[0].stickers[chunkId(0)].push({ id: 'second', ...editor.writes[1].command.sticker });
  editor.writes[1].resolve({ state: editor.state }); await pending;
  assert.equal(label.value, '', 'successful new sticker clears its draft label');
  pending = editor.find(node => node.attributes?.['aria-label'] === 'Remove star').click();
  assert.deepEqual(editor.writes[2].command, { type: 'remove-sticker', memberId: 'actor1', chunkId: chunkId(0), stickerId: 'first' });
  assert.equal(editor.writes[2].revision, 11);
  editor.state.revision = 12; editor.state.members[0].stickers[chunkId(0)].shift(); editor.writes[2].resolve({ state: editor.state }); await pending;
  pending = editor.find(node => node.textContent === 'Clear all stickers').click();
  assert.equal(editor.writes[3].command.type, 'clear-stickers'); assert.equal(editor.writes[3].revision, 12);
  editor.state.revision = 13; editor.state.members[0].stickers[chunkId(0)] = []; editor.writes[3].resolve({ state: editor.state }); await pending;
  assert.equal(editor.find(node => node.textContent === 'Clear all stickers').disabled, true);
  assert.deepEqual(editor.closures, []);
});

test('full editor enforces the addition cap while preserving selected edits and reloads a stale review explicitly', async () => {
  const editor = editorFixture(Array.from({ length: 6 }, (_, index) => ({ id: `marker-${index}`, type: 'star', color: '#ffffff', text: `Label ${index}` })));
  editor.tools.sticker(chunkId(0));
  const save = editor.find(node => node.textContent === 'Save sticker'), add = editor.find(node => node.textContent === 'New sticker');
  assert.equal(add.disabled, true); assert.equal(save.disabled, false, 'existing sticker edits remain available at the cap');
  add.click(); assert.equal(save.disabled, true);
  await save.click(); assert.equal(editor.writes.length, 0);
  editor.state.revision = 20; editor.state.members[0].stickers[chunkId(0)].pop();
  editor.find(node => node.textContent === 'Reload stickers').click();
  assert.equal(save.disabled, false);
  const pending = save.click(); assert.equal(editor.writes[0].revision, 20);
  editor.writes[0].reject(new Error('Still unavailable')); await pending;
  assert.equal(save.disabled, false);
});


test('starting chunk choices display names and gate numeric IDs behind Advanced for editors', () => {
  for (const [advanced, canWrite] of [[false, true], [true, true], [true, false]]) {
    const editor = editorFixture();
    const namedWorld = { ...world, chunks: new Map(world.chunks) };
    namedWorld.chunks.set(chunkId(0), { ...namedWorld.chunks.get(chunkId(0)), name: 'Lumbridge' });
    editor.ctx.world = () => namedWorld;
    editor.ctx.preferences = () => ({ advanced }); editor.ctx.canWrite = () => canWrite;
    editor.state.members[0].preferences.startingChunk = chunkId(0);
    editor.tools.startingChunk();
    const status = editor.find(node => node.className === 'status-detail');
    assert.equal(status.textContent, `Current starting marker: Lumbridge${advanced && canWrite ? ` (${chunkId(0)})` : ''}`);
    const search = editor.find(node => node.tag === 'input'); search.value = chunkId(0); search.events.input();
    assert.ok(editor.find(node => node.tag === 'span' && node.textContent === `Lumbridge${advanced && canWrite ? ` (${chunkId(0)})` : ''}`));
    assert.equal(editor.writes.length, 0);
  }
});
