import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSignInPage } from '../app/signin-page.mjs';
import { createAccountPanel } from '../app/web/account-panel.mjs';
import { createAccountsPanel } from '../app/web/accounts-panel.mjs';

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
