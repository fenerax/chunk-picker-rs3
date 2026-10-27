import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createStreamSafe } from '../app/web/stream-safe.mjs';
import { createScreenControls, handleScreenEscape } from '../app/web/screen-controls.mjs';
import { controlUsageId } from '../app/web/usage-client.mjs';
import { createScreenUsage } from '../app/web/screen-usage.mjs';
import { galleryEntries } from '../app/web/gallery-catalogue.mjs';

const shell = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8');
const settingsSource = (await readFile(new URL('../app/web/screen-settings.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const createScreenSettings = c => runInNewContext(settingsSource + '\ncreateScreenSettings(c);', { c, createStreamSafe, originalSettings: {}, document: globalThis.document });
class Node extends EventTarget {
  constructor(id) { super(); this.id = id; this.hidden = false; this.open = false; this.style = { setProperty() {} }; this.parentElement = this; }
  contains(node) { return node === this; }
  setAttribute() {}
  append() {}
  querySelector() { return { focus: () => { this.focused = true; } }; }
  getBoundingClientRect() { return { height: 0 }; }
}
function fixture(t) {
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
  const doc = new Node('document'); doc.documentElement = { dataset: {} }; doc.querySelector = doc.getElementById = $;
  const previous = { document: globalThis.document, ResizeObserver: globalThis.ResizeObserver };
  globalThis.document = doc; globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const noop = () => {};
  const c = new Proxy({ $, canWrite: () => false, dockPanels: [], settingsPanels: {}, infoPanels: {}, originalSync: {},
    sandbox: {}, backupStatus: { refresh() {} }, stickerPicker: { isOpen: () => false }, el: () => new Node(), button: () => new Node(), input: () => new Node(),
  }, { get: (target, key) => key in target ? target[key] : noop });
  // These optional factories are absent until startup mounts them.
  for (const key of ['mapCapture', 'poolRanking', 'phoneLayout']) c[key] = undefined;
  return { c, $, doc };
}

test('Admin starts hidden, preserves launchers, and sits before More with a real gallery link', () => {
  const admin = shell.match(/<details class="more-tools" id="admin-tools" hidden>([\s\S]*?)<\/details>/)?.[1];
  assert(admin); assert.match(admin, /<summary>Admin<\/summary>/);
  for (const id of ['invites-open', 'accounts-open', 'overlays-open', 'usage-open']) {
    assert.match(admin, new RegExp(`<button id="${id}" hidden>`));
    assert.equal(shell.match(new RegExp(`id="${id}"`, 'g')).length, 1);
  }
  assert.match(admin, /<a id="gallery-open" href="\/gallery" target="_blank" rel="noopener">Component gallery<\/a>/);
  assert(shell.indexOf('id="admin-tools"') < shell.indexOf('id="more-tools"'));
  const more = shell.match(/id="more-tools">([\s\S]*?)<\/details>/)[1];
  assert.match(more, /id="saves-heading">Saves/); assert.match(more, /id="about-heading">About/);
  assert(!/invites-open|accounts-open|overlays-open|usage-open/.test(more));
});

test('only a loaded writable admin session reveals Admin; losing access closes it', t => {
  const { c, $ } = fixture(t); $('admin-tools').hidden = true;
  createScreenSettings(c); assert.equal($('admin-tools').hidden, true);
  for (const session of [{}, { admin: false, memberId: 'player2' }, { admin: false, readOnly: true },
    { admin: true, adminAvailable: false }, { admin: true, readOnly: true }, { admin: true, canWrite: false }, { admin: true, capabilities: { canWrite: false } }]) {
    $('admin-tools').open = true; c.applySession(session);
    assert.equal($('admin-tools').hidden, true); assert.equal($('admin-tools').open, false);
  }
  c.applySession({ admin: true, canWrite: true }); assert.equal($('admin-tools').hidden, false);
  $('admin-tools').open = true; c.applySession({ admin: false });
  assert.equal($('admin-tools').hidden, true); assert.equal($('admin-tools').open, false);
});

test('Info, Admin and More close one another, outside clicks and Escape dismiss Admin', t => {
  const { c, $, doc } = fixture(t); createScreenControls(c); c.bindControls();
  for (const id of ['info-tools', 'admin-tools', 'more-tools']) {
    for (const other of ['info-tools', 'admin-tools', 'more-tools']) $(other).open = true;
    $(id).dispatchEvent(new Event('toggle'));
    assert.deepEqual(['info-tools', 'admin-tools', 'more-tools'].filter(key => $(key).open), [id]);
  }
  $('admin-tools').open = true;
  let prevented = false; handleScreenEscape(c, { key: 'Escape', preventDefault: () => { prevented = true; } });
  assert.equal($('admin-tools').open, false); assert.equal($('admin-tools').focused, true); assert(prevented);
  $('admin-tools').open = true; doc.dispatchEvent(new Event('click'));
  assert.equal($('admin-tools').open, false);
  $('admin-tools').open = true;
  const click = new Event('click'); Object.defineProperty(click, 'target', { value: { closest: selector => selector === 'button, a' } });
  $('.topbar nav').dispatchEvent(click); assert.equal($('admin-tools').open, false);
});

test('Invite links, Accounts, Account and OBS overlays retain their startup dialog handlers', async t => {
  const { c, $ } = fixture(t), opened = [], stop = new Error('Stop before full startup');
  const source = (await readFile(new URL('../app/web/screen-startup.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  c.api = async () => { throw stop; }; c.applySession = session => { c.sessionAdmin = session.admin; };
  c.panelContext = {};
  const panel = () => ({ start() {}, setSession() {} });
  runInNewContext(source + '\ncreateScreenStartup(c);', { c, document: globalThis.document, globalThis: {},
    createFeedback: panel, createUpdates: panel, createBackupStatus: panel,
    createInvites: () => ({ loadSession: async () => ({ admin: true }), open: async () => opened.push('Invite links') }),
    createAccountPanel: () => ({ setSession() {}, open: () => opened.push('Account') }),
    createAccountsPanel: () => ({ setSession() {}, open: async () => opened.push('Accounts') }),
    createOverlayPanel: () => ({ open: async () => opened.push('OBS overlays') }),
    loadArtStatus: async () => {}, loadTerrainManifest: async () => {},
  });
  await assert.rejects(c.start(), error => error === stop);
  $('invites-open').dispatchEvent(new Event('click')); $('accounts-open').dispatchEvent(new Event('click')); $('account-open').dispatchEvent(new Event('click')); $('overlays-open').dispatchEvent(new Event('click'));
  await Promise.resolve(); assert.deepEqual(opened, ['Invite links', 'Accounts', 'Account', 'OBS overlays']);
  c.sessionAdmin = false; $('accounts-open').dispatchEvent(new Event('click')); $('overlays-open').dispatchEvent(new Event('click'));
  assert.equal(opened.length, 4);
});

test('Admin and Component gallery have stable usage ids and an Admin gallery sample', () => {
  assert.equal(controlUsageId({ tagName: 'SUMMARY', parentElement: { id: 'admin-tools' } }), 'dom:admin-tools');
  assert.equal(controlUsageId({ tagName: 'A', id: 'gallery-open' }), 'dom:gallery-open');
  const entry = galleryEntries.find(entry => entry.id === 'topbar-admin');
  assert.equal(entry.menu, 'admin-tools'); assert(entry.covers.includes('dom:admin-tools'));
});

test('the moved Usage button still opens Usage for an admin', async t => {
  const { c, $ } = fixture(t), titles = [];
  c.state = { members: [{ id: 'player1', name: 'Player 1' }] }; c.sessionAdmin = true; c.sessionReadOnly = false;
  c.openDialog = title => titles.push(title); c.api = async () => ({ counts: [] }); c.dialogCurrent = () => false;
  createScreenUsage(c, { storage: { getItem: () => 'false' } });
  t.after(() => c.usage.stop()); c.usage.start();
  assert.equal($('usage-open').hidden, false); $('usage-open').dispatchEvent(new Event('click'));
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(titles, ['Usage']);
});
