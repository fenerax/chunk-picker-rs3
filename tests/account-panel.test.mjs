import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSignInPage } from '../app/signin-page.mjs';
import { createAccountPanel } from '../app/web/account-panel.mjs';
import { createAccountsPanel } from '../app/web/accounts-panel.mjs';
import { createCharacterForm } from '../app/web/character-menu.mjs';
import { renderAcceptance, ownerInviteControls } from '../app/web/group-invites.mjs';
import { handoverControls } from '../app/web/group-handover.mjs';
import { departureControls } from '../app/web/group-departure.mjs';
import { deletionControls } from '../app/web/character-deletion.mjs';

class Node {
  constructor(tag, text = '', className = '') { this.tag = tag; this.textContent = text ?? ''; this.className = className; this.children = []; this.attributes = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.classList = { add: name => { this.className += ` ${name}`; } }; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  focus() { this.focused = true; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}
const el = (...args) => new Node(...args);
const button = (text, click) => Object.assign(el('button', text), { click });
const walk = node => [node, ...node.children.flatMap(walk)];
const text = node => walk(node).map(item => item.textContent).join(' ');

test('deletion review names all targets, requires final-group confirmation, and keeps uncertain request identity', async () => {
  const sent = [], navigated = []; let offline = true, drained = 0, released = 0;
  const root = deletionControls({ el, kind: 'character', characterId: 'own', pickerId: 'solo', randomId: () => 'retained-request',
    beforeDeparture: async () => { drained++; return () => { released++; }; }, location: { assign: href => navigated.push(href) }, fetch: async (url, options) => {
      sent.push({ url, ...options });
      if (options.body) { if (offline) { offline = false; throw new Error('Connection lost'); } return { ok: true, json: async () => ({ href: '/characters' }) }; }
      return { ok: true, json: async () => ({ reviewToken: 'review', characters: [{ characterId: 'own', runescapeName: 'Sample', pickerId: 'solo' }], keptCharacters: ['other'], groups: ['solo'], backups: { message: 'Configured retained backups' } }) };
    } });
  await walk(root).find(n => n.textContent === 'Refresh deletion review').listeners.click();
  assert.match(text(root), /Sample.*own.*solo/); assert.match(text(root), /1 other character/); assert.match(text(root), /Configured retained backups/);
  const confirm = walk(root).find(n => n.textContent === 'Confirm deletion'), checks = walk(root).filter(n => n.type === 'checkbox');
  await confirm.listeners.click(); assert.equal(sent.some(r => r.body), false);
  checks[0].checked = true; await confirm.listeners.click(); assert.equal(sent.some(r => r.body), false);
  checks[1].checked = true; await confirm.listeners.click(); assert.equal(drained, 1); assert.equal(released, 0); assert.deepEqual(navigated, []);
  await confirm.listeners.click(); assert.equal(drained, 1); assert.equal(released, 1); assert.deepEqual(navigated, ['/characters']);
  const posts = sent.filter(r => r.body); assert.equal(posts[0].body, posts[1].body); assert.equal(JSON.parse(posts[0].body).finalGroupConfirmed, true);
});

test('departure review never allocates for a solo and clearly offers Join another group', async () => {
  const sent = [], root = departureControls({ el, characterId: 'solo', fetch: async (url, options) => { sent.push(options); return { ok: true, json: async () => ({ solo: true }) }; } });
  await walk(root).find(n => n.textContent === 'Refresh departure review').listeners.click();
  assert.match(text(root), /Join another group/); assert.equal(sent.some(o => o.method === 'POST'), false);
});

test('departure confirmation scopes the chosen member and preserves its request after an uncertain response', async () => {
  const sent = [], moves = []; let offline = true, drained = 0, released = 0, stopped = 0;
  const root = departureControls({ el, characterId: 'member', randomId: () => 'same-request', beforeDeparture: async () => { drained++; return () => { released++; }; }, beforeSwitch: async () => { stopped++; }, scopeHeaders: { 'X-Character-Id': 'member', 'X-Picker-Id': 'source' }, location: { assign: url => moves.push(url) },
    fetch: async (url, options) => {
      sent.push(options); if (options.body) { if (offline) { offline = false; throw new Error('Offline'); } return { ok: true, json: async () => ({ character: { href: '/characters/member' } }) }; }
      return { ok: true, json: async () => ({ ownerCharacterId: 'owner', revision: 7, roster: [{ id: 'owner', owner: true }, { id: 'member', owner: false }], backups: { message: 'Configured retention disclosure' } }) };
    } });
  await walk(root).find(n => n.textContent === 'Refresh departure review').listeners.click();
  assert.match(text(root), /read-only and exportable/); assert.match(text(root), /Configured retention disclosure/);
  const select = walk(root).find(n => n.tag === 'select'); select.value = 'member';
  const confirm = walk(root).find(n => n.textContent === 'Confirm leave'); await confirm.listeners.click(); assert.equal(sent.some(o => o.body), false);
  walk(root).find(n => n.type === 'checkbox').checked = true;
  await confirm.listeners.click();
  assert.equal(drained, 1); assert.equal(released, 0); assert.equal(stopped, 0);
  await confirm.listeners.click();
  assert.equal(drained, 1); assert.equal(released, 1); assert.equal(stopped, 1);
  const posted = sent.filter(o => o.body); assert.equal(posted.length, 2); assert.equal(posted[0].body, posted[1].body);
  assert.equal(posted[0].headers['X-Picker-Id'], 'source'); assert.deepEqual(moves, ['/characters/member']);
});

test('handover explains same-login designation and preserves request ID through an uncertain response', async () => {
  const sent = [], changed = []; let fail = true;
  const root = handoverControls({ el, characterId: 'owner', randomId: () => 'same-request', scopeHeaders: { 'X-Character-Id': 'owner' }, onChanged: async () => changed.push(true),
    fetch: async (url, options) => {
      sent.push(options);
      if (options.body) { if (fail) { fail = false; throw new Error('Offline'); } return { ok: true, json: async () => ({ status: 'accepted' }) }; }
      return { ok: true, json: async () => ({ ownerCharacterId: 'owner', candidates: [{ id: 'other', runescapeName: 'Sample', sameLogin: true }], handovers: [] }) };
    } });
  await walk(root).find(n => n.textContent === 'Refresh ownership').listeners.click();
  const select = walk(root).find(n => n.tag === 'select'); select.value = 'other'; select.listeners.change();
  assert.match(text(root), /designates your other character immediately/);
  const confirm = walk(root).find(n => n.textContent === 'Confirm successor');
  await confirm.listeners.click(); await confirm.listeners.click();
  const posts = sent.filter(o => o.body); assert.equal(posts.length, 2); assert.equal(posts[0].body, posts[1].body);
  assert.equal(posts[0].headers['X-Character-Id'], 'owner'); assert.deepEqual(changed, [true]);
});

test('only the addressed character sees accept/decline; proposer sees cancellation', async () => {
  for (const characterId of ['owner', 'target', 'other']) {
    const sent = [], root = handoverControls({ el, characterId, onChanged() {}, fetch: async (url, options) => {
      if (options.body) sent.push(JSON.parse(options.body));
      return { ok: true, json: async () => options.body ? { status: 'accepted' } : { ownerCharacterId: 'owner', candidates: [], handovers: [{ id: 'offer', fromCharacterId: 'owner', toCharacterId: 'target', status: 'pending' }] } };
    } });
    await walk(root).find(n => n.textContent === 'Refresh ownership').listeners.click();
    const labels = walk(root).filter(n => n.tag === 'button').map(n => n.textContent);
    assert.equal(labels.includes('Accept ownership'), characterId === 'target'); assert.equal(labels.includes('Decline ownership'), characterId === 'target'); assert.equal(labels.includes('Cancel handover'), characterId === 'owner');
    if (characterId === 'target') { await walk(root).find(n => n.textContent === 'Accept ownership').listeners.click(); assert.deepEqual(sent[0], { action: 'accept', id: 'offer', confirmed: true }); }
  }
});

test('group invitation review offers New character, disables progressed maps and requires confirmation', async () => {
  const root = el('div'), error = el('p'), sent = [], destinations = [];
  const value = { invite: { status: 'pending' }, reviewToken: 'review', characters: [
    { id: 'progressed', eligible: false, reason: 'This character already has a map in progress. Choose a new character, or wait until moving characters is available.' },
    { id: 'untouched', eligible: true, runescapeName: 'Sample' }], review: { unlocked: ['12341'], blacklisted: [], rules: {}, taskRules: {}, startingChunk: '12341' } };
  await renderAcceptance({ root, error, el: (...args) => Object.assign(el(...args), { style: {} }), location: { assign: href => destinations.push(href) },
    fetch: async (url, options) => { sent.push([url, options.body && JSON.parse(options.body)]); return { ok: true, json: async () => options.body ? { character: { href: '/characters/joined' } } : value }; } });
  assert.match(text(root), /map in progress.*new character/); assert.match(text(root), /New character/); assert.match(text(root), /Destination map and rules/);
  const nodes = walk(root), options = nodes.filter(n => n.tag === 'option'); assert.equal(options.find(n => n.value === 'progressed').disabled, true);
  const form = nodes.find(n => n.tag === 'form'), confirm = nodes.find(n => n.required === true), select = nodes.find(n => n.tag === 'select');
  await form.listeners.submit({ preventDefault() {} }); assert.equal(sent.length, 1);
  select.value = 'untouched'; select.listeners.change(); assert.match(text(root), /onboarding solo will be retired/);
  select.value = ''; select.listeners.change(); nodes.find(n => n.tag === 'input' && n.maxLength === 12).value = 'New Sample';
  confirm.checked = true; await form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(sent[1], ['/auth/group-invite/accept', { reviewToken: 'review', confirmed: true, runescapeName: 'New Sample' }]);
  assert.deepEqual(destinations, ['/characters/joined']);
});

test('owner controls return a link once for copying and send scoped revoke/replace requests', async () => {
  const sent = [], copied = [];
  const root = ownerInviteControls({ el, scopeHeaders: { 'X-Character-Id': 'owner' }, clipboard: { writeText: async value => copied.push(value) },
    fetch: async (url, options) => { sent.push(options); return { ok: true, json: async () => options.body ? { link: 'https://picker.example/join/synthetic' } : { invites: [{ id: 'pending', status: 'pending', expiresAt: '2026-01-08' }] } }; } });
  await walk(root).find(n => n.textContent === 'Create player invitation').listeners.click();
  assert.equal(sent.every(r => r.headers['X-Character-Id'] === 'owner'), true);
  assert.equal(walk(root).find(n => n.tag === 'input').value, 'https://picker.example/join/synthetic');
  await walk(root).find(n => n.textContent === 'Copy invitation link').listeners.click(); assert.deepEqual(copied, ['https://picker.example/join/synthetic']);
  await walk(root).find(n => n.textContent === 'Replace link').listeners.click();
  assert.ok(sent.some(r => r.body === '{"replaceId":"pending"}'));
  await walk(root).find(n => n.textContent === 'Revoke').listeners.click(); assert.ok(sent.some(r => r.body === '{"revokeId":"pending"}'));
});

test('character menu disambiguates, marks current and unavailable characters, and pauses affected deletion', async () => {
  const moves = [], scopes = [], panel = createAccountPanel({ el, openDialog() {}, beforeSwitch: async () => scopes.push('drained'), location: { assign: href => moves.push(href) } });
  panel.setSession({ account: { id: 'sample', providers: ['google'] }, multiPicker: true, characterId: 'one', characters: [
    { id: 'one', runescapeName: null, groupLabel: 'Solo game', playerCount: 1, role: 'owner', available: true, href: '/characters/one' },
    { id: 'two', runescapeName: null, groupLabel: 'Group game', playerCount: 5, role: 'player', available: true, href: '/characters/two' },
    { id: 'three', runescapeName: null, groupLabel: 'Shared game', playerCount: 2, role: 'player', available: false, href: '/characters/three' },
  ], ownerControls: { role: 'owner', shared: false, deletionPaused: true } });
  const rows = panel.rows(), buttons = walk(rows).filter(node => node.tag === 'button');
  assert.equal(buttons.find(n => n.textContent.includes('Character 1')).disabled, true);
  assert.equal(buttons.find(n => n.textContent.includes('Character 3')).disabled, true);
  await buttons.find(n => n.textContent.includes('Character 2')).listeners.click();
  assert.deepEqual(scopes, ['drained']); assert.deepEqual(moves, ['/characters/two']);
  await buttons.find(n => n.textContent === 'Characters and groups').listeners.click();
  assert.deepEqual(scopes, ['drained', 'drained']); assert.deepEqual(moves, ['/characters/two', '/characters']);
  assert.ok(buttons.filter(n => n.textContent.startsWith('Delete ')).every(n => n.disabled));
  assert.match(text(rows), /5 players/); assert.match(text(rows), /legacy shared picker needs operator recovery/);
});

test('Add character preserves its request through uncertainty and duplicate review, including reload', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const requests = [], created = [];
  let mode = 'offline';
  const options = { el, accountId: 'sample', storage, randomId: () => 'same-request', onCreated: character => created.push(character.id), fetch: async (path, options) => {
    requests.push(JSON.parse(options.body));
    if (mode === 'offline') throw new Error('Offline');
    if (mode === 'duplicate') return { ok: false, status: 409, json: async () => ({ code: 'DUPLICATE_CHARACTER_NAME', message: 'Confirm a duplicate' }) };
    return { ok: true, json: async () => ({ character: { id: 'same-character' } }) };
  } };
  let form = createCharacterForm(options), input = walk(form).find(n => n.name === 'runescapeName'); input.value = 'Sample';
  await form.listeners.submit({ preventDefault() {} }); assert.equal(input.disabled, true);
  form = createCharacterForm(options); input = walk(form).find(n => n.name === 'runescapeName'); assert.equal(input.disabled, true);
  mode = 'duplicate'; await form.listeners.submit({ preventDefault() {} }); assert.equal(input.disabled, false);
  const checkbox = walk(form).find(n => n.type === 'checkbox'); checkbox.checked = true; assert.equal(checkbox.parent.hidden, false);
  mode = 'ok'; await form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(requests.map(r => r.requestId), ['same-request', 'same-request', 'same-request']);
  assert.equal(requests[2].acknowledgeDuplicate, true); assert.deepEqual(created, ['same-character']); assert.equal(values.size, 0);
});

test('a definitive login quota refusal shows its guidance and leaves Add character editable after reload', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const options = { el, accountId: 'synthetic', storage, randomId: () => 'same-request', onCreated: () => assert.fail('refused'),
    fetch: async () => ({ ok: false, status: 507, json: async () => ({ code: 'LOGIN_STORAGE_BUDGET_EXCEEDED', message: 'This login has reached its retained map or save storage limit.' }) }) };
  const form = createCharacterForm(options);
  await form.listeners.submit({ preventDefault() {} });
  assert.match(text(form), /login.*storage limit/);
  assert.equal(walk(form).find(n => n.name === 'runescapeName').disabled, false);
  assert.equal(walk(createCharacterForm(options)).find(n => n.name === 'runescapeName').disabled, false);
});

function accountMenu() {
  const topMenu = el('details'), summary = el('summary'), label = el('span'), content = el('div');
  topMenu.hidden = true; topMenu.append(summary, content); summary.append(label);
  topMenu.querySelector = selector => ({ summary, '.account-provider': label, '.more-tools-menu': content })[selector];
  return { topMenu, summary, label, content };
}

test('top-bar account stays hidden for invite, viewer, master/private and sign-in-off sessions', () => {
  const menu = accountMenu(), panel = createAccountPanel({ el, openDialog() {}, topMenu: menu.topMenu });
  for (const session of [{}, { kind: 'master', admin: true }, { kind: 'invite', signIn: { providers: ['discord', 'google'] } },
    { kind: 'invite', readOnly: true, signIn: { providers: ['discord'] } }, { signIn: { mode: 'off', providers: [] } }]) {
    panel.setSession({ account: { provider: 'discord' } }); menu.topMenu.open = true;
    panel.setSession(session);
    assert.equal(menu.topMenu.hidden, true); assert.equal(menu.topMenu.open, false);
    assert.equal(menu.content.children.length, 0);
  }
});

test('top-bar account reuses configured missing-provider links and the POST sign-out form', () => {
  const menu = accountMenu(), panel = createAccountPanel({ el, openDialog() {}, topMenu: menu.topMenu });
  for (const [provider, providers, configured, expected] of [
    ['discord', ['discord'], ['discord', 'google'], ['/auth/link/google']],
    ['google', ['google'], ['discord', 'google'], ['/auth/link/discord']],
    ['discord', ['discord', 'google'], ['discord', 'google'], []],
    ['discord', ['discord'], ['discord'], []],
    ['google', ['google'], ['google', 'toString', '<bad>'], []],
  ]) {
    panel.setSession({ account: { provider, providers }, signIn: { providers: configured } });
    assert.equal(menu.topMenu.hidden, false);
    const name = provider === 'discord' ? 'Discord' : 'Google', nodes = walk(menu.content);
    assert.equal(menu.label.textContent, name); assert.equal(menu.summary.attributes['aria-label'], `${name} account`);
    assert.match(text(menu.content), new RegExp(`Signed in with ${name}`));
    assert.deepEqual(nodes.filter(node => node.tag === 'a').map(node => node.href), expected);
    const form = nodes.find(node => node.tag === 'form');
    assert.equal(form.method, 'post'); assert.equal(form.action, '/auth/signout');
    assert.equal(form.children[0].type, 'submit'); assert.equal(form.children[0].textContent, 'Sign out');
    assert.equal(nodes.find(node => node.tag === 'p').className, 'account-menu-status');
    assert.equal(walk(panel.rows())[0].className, 'account-details', 'Settings retains its layout');
  }
});

for (const compact of [false, true]) test(`sign out posts with same-origin credentials and navigates only on success (${compact ? 'top bar' : 'Settings'})`, async () => {
  const menu = accountMenu(), calls = [], destinations = [];
  let ok = false;
  const panel = createAccountPanel({ el, openDialog() {}, topMenu: menu.topMenu,
    fetch: async (...args) => { calls.push(args); return { ok }; }, location: { assign: value => destinations.push(value) } });
  panel.setSession({ account: { provider: 'discord' } });
  const form = walk(compact ? menu.content : panel.rows()).find(node => node.tag === 'form'), [submit, error] = form.children;
  let prevented = false;
  await form.listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(error.hidden, false); assert.equal(submit.disabled, false);
  assert.deepEqual(destinations, []); assert.match(error.textContent, /Sign out failed/);
  if (compact) { assert.equal(menu.topMenu.open, true); assert.equal(submit.focused, true); }
  ok = true;
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(error.hidden, true); assert.equal(submit.disabled, true);
  assert.deepEqual(destinations, ['/auth/signin']);
  assert.deepEqual(calls, [
    ['/auth/signout', { method: 'POST', credentials: 'same-origin' }],
    ['/auth/signout', { method: 'POST', credentials: 'same-origin' }],
  ]);
});

test('sign-in HTML escapes messages and headings and restricts provider links under a script-free page', () => {
  const html = renderSignInPage({ heading: '<script>alert(1)</script>', message: '<img src=x onerror="bad()"> & denied', providers: ['discord', { id: 'google', label: '<bad>', href: 'https://evil.invalid' }, 'javascript:bad', 'toString', 'discord'], continueInvite: true, claim: true });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; &amp; denied/);
  assert.equal((html.match(/href="\/auth\/discord"/g) ?? []).length, 1);
  assert.match(html, /href="\/auth\/google">Sign in with Google/);
  assert.match(html, /href="\/auth\/signin.css"/);
  assert.match(html, /method="post" action="\/auth\/invite"/);
  assert.match(html, /method="post" action="\/auth\/claim"/);
  assert.doesNotMatch(html, /<script|<style|\sstyle=|https:\/\/evil|javascript:bad|<bad>/);
});

test('account settings show only safe provider names, link only missing providers and sign out by POST', () => {
  const menuButton = el('button');
  const panel = createAccountPanel({ el, openDialog() {}, menuButton });
  panel.setSession({ signIn: { providers: ['discord', 'google'] }, account: { id: 'internal-id', provider: 'discord', providers: ['discord'], email: 'private@example.invalid', subject: 'private-provider-subject' } });
  assert.equal(menuButton.hidden, false);
  const rows = panel.rows(), nodes = walk(rows);
  assert.match(text(rows), /Signed in with Discord/);
  assert.doesNotMatch(text(rows), /private@|private-provider-subject|internal-id/);
  assert.deepEqual(nodes.filter(node => node.tag === 'a').map(node => [node.textContent, node.href]), [['Link Google too', '/auth/link/google']]);
  const form = nodes.find(node => node.tag === 'form');
  assert.equal(form.method, 'post'); assert.equal(form.action, '/auth/signout');
  assert.equal(form.children[0].type, 'submit');
  assert.equal(nodes.find(node => node.tag === 'a').className, 'secondary-button');
  assert.equal(form.children[0].className, 'secondary-button');
  panel.setSession({ signIn: { providers: ['google', 'toString', '<bad>'] }, account: { provider: 'toString', providers: ['<bad>'] } });
  assert.doesNotMatch(text(panel.rows()), /function|<bad>/);
  assert.deepEqual(walk(panel.rows()).filter(node => node.tag === 'a').map(node => node.href), ['/auth/link/google']);
});

test('unassigned invite settings explain player selection without offering sign-in', () => {
  const panel = createAccountPanel({ el, openDialog() {} });
  panel.setSession({ kind: 'invite', memberId: null, signIn: { mode: 'optional', providers: ['discord', 'google'] } });
  const rows = panel.rows();
  assert.match(text(rows), /Ask the admin to choose a player for this invite before signing in/);
  assert.equal(walk(rows).filter(node => node.tag === 'a').length, 0);
  panel.setSession({ kind: 'invite', readOnly: true, memberId: null, signIn: { mode: 'optional', providers: ['discord', 'google'] } });
  assert.doesNotMatch(text(panel.rows()), /Ask the admin to choose a player/);
});

test('optional invite sessions offer configured sign-in providers and disabled sign-in hides Account', () => {
  const menuButton = el('button'); let opened;
  const panel = createAccountPanel({ el, menuButton, openDialog: (title, node) => { opened = { title, node }; } });
  panel.setSession({ signIn: { mode: 'optional', providers: ['discord', 'google'] } }); panel.open();
  assert.equal(opened.title, 'Account');
  assert.deepEqual(walk(opened.node).filter(node => node.tag === 'a').map(node => node.href), ['/auth/discord', '/auth/google']);
  assert.doesNotMatch(text(opened.node), /Sign out/);
  panel.setSession({ signIn: { mode: 'disabled', providers: [] } }); assert.equal(menuButton.hidden, true); assert.equal(panel.available(), false);
});

test('account administration guards private admin availability before listing accounts', async () => {
  for (const session of [{ admin: false }, { admin: true, adminAvailable: false }]) {
    const calls = [], menuButton = el('button'); let content;
    const panel = createAccountsPanel({ el, button, menuButton, openDialog: (title, node) => { content = node; return 1; }, dialogCurrent: () => true, api: async path => { calls.push(path); return session; } });
    panel.setSession(session); assert.equal(menuButton.hidden, true); await panel.open();
    assert.deepEqual(calls, ['/api/session']); assert.match(text(content), /Only admins/);
  }
});

test('account administration shows provider/member metadata and confirms deletion before POST', async () => {
  const calls = [], account = { id: 'account-123456789', identities: [{ provider: 'discord', subject: 'secret-subject' }, { provider: 'google', email: 'private@example.invalid' }], memberships: [{ memberId: 'player2', role: 'player' }], lastUsedAt: '2026-10-26T14:00:00Z' };
  let content;
  const panel = createAccountsPanel({ el, button, members: () => [{ id: 'player2', name: 'Reed' }], openDialog: (title, node) => { content = node; return 1; }, dialogCurrent: () => true, api: async (path, body) => { calls.push([path, body]); if (path === '/api/session') return { admin: true }; if (path === '/api/accounts') return { accounts: [account] }; return {}; } });
  await panel.open();
  assert.match(text(content), /Discord \+ Google · account-/); assert.match(text(content), /Reed · player/);
  assert.doesNotMatch(text(content), /secret-subject|private@example/);
  await walk(content).find(node => node.textContent === 'Unlink Google').click();
  assert.deepEqual(calls.at(-1), ['/api/accounts/account-123456789/unlink', { provider: 'google' }]);
  assert.equal(walk(content).find(node => node.textContent === 'Unlink Discord').disabled, false);
  await walk(content).find(node => node.textContent === 'Revoke sessions').click();
  assert.deepEqual(calls.at(-1), ['/api/accounts/account-123456789/revoke-sessions', {}]);
  walk(content).find(node => node.textContent === 'Delete account').click();
  assert.match(text(content), /This cannot be undone/); assert.equal(calls.filter(([path]) => path.endsWith('/delete')).length, 0);
  await walk(content).filter(node => node.textContent === 'Delete account').at(-1).click();
  assert.deepEqual(calls.at(-1), ['/api/accounts/account-123456789/delete', {}]); assert.match(text(content), /No accounts yet/);
});
