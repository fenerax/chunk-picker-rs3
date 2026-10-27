import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSignInPage } from '../app/signin-page.mjs';
import { createAccountPanel } from '../app/web/account-panel.mjs';
import { createAccountsPanel } from '../app/web/accounts-panel.mjs';

class Node {
  constructor(tag, text = '', className = '') { this.tag = tag; this.textContent = text ?? ''; this.className = className; this.children = []; this.attributes = {}; this.hidden = false; this.disabled = false; this.classList = { add: name => { this.className += ` ${name}`; } }; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { this.focused = true; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}
const el = (...args) => new Node(...args);
const button = (text, click) => Object.assign(el('button', text), { click });
const walk = node => [node, ...node.children.flatMap(walk)];
const text = node => walk(node).map(item => item.textContent).join(' ');

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
  panel.setSession({ signIn: { providers: ['google', 'toString', '<bad>'] }, account: { provider: 'toString', providers: ['<bad>'] } });
  assert.doesNotMatch(text(panel.rows()), /function|<bad>/);
  assert.deepEqual(walk(panel.rows()).filter(node => node.tag === 'a').map(node => node.href), ['/auth/link/google']);
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
