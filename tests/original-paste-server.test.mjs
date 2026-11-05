import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.RS3_DATASET = 'open-starter';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN']) delete process.env[key];
const { createServer } = await import('../app/server.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { createOriginalPasteUpload } = await import('../app/web/backup-transfer.mjs');
const { createScreenDialogs } = await import('../app/web/screen-dialogs.mjs');

async function fixture(t, enabled) {
  const previous = process.env.RS3_ORIGINAL_IMPORT_PASTE;
  if (enabled) process.env.RS3_ORIGINAL_IMPORT_PASTE = '1'; else delete process.env.RS3_ORIGINAL_IMPORT_PASTE;
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-original-paste-http-'));
  // Synthetic metadata provider, with the exact legacy coordinate contract.
  const dataset = { ...selectedDataset, datasetId: 'duo-legacy', coordinateSystem: 'surface-grid-v1',
    capabilities: { ...selectedDataset.capabilities, independent: false } };
  const app = await createServer({ dataDir: path.join(root, 'data'), dataset,
    definitions: { chunks: { '12850': {}, '12594': {} }, walkableChunks: ['12850', '12594'], walkableChunksF2P: ['12850', '12594'] }, taskMap: {},
    initialState: createGroupState([{ id: 'destination', name: 'Synthetic destination' }, { id: 'other', name: 'Synthetic other' }]),
    port: 0, predictionPrewarm: false, shutdownDeadlineMs: 500 });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.RS3_ORIGINAL_IMPORT_PASTE; else process.env.RS3_ORIGINAL_IMPORT_PASTE = previous; });
  await app.listen();
  const origin = new URL(app.inviteUrl).origin;
  const response = await fetch(app.inviteUrl, { redirect: 'manual' });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const request = (route, options = {}, credential = cookie) => fetch(origin + route, { ...options,
    headers: { ...(credential ? { Cookie: credential } : {}), Origin: origin, ...options.headers } });
  const json = (route, body, credential) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, credential);
  const upload = async (route, extra = {}, credential) => {
    const payload = await createOriginalPasteUpload({ chunksText: '12850', rulesText: '{"F2P":true}', gameplayText: '{"chunkinfo":{"checkedAllTasks":{"Mining":{"t_unknown":true}}}}' },
      { memberId: 'destination', sourceMemberId: 'original_paste', ...extra });
    return request(route, await payload.toBackupRequest(), credential);
  };
  return { app, request, json, upload };
}

test('flag defaults off on the session and rejects paste on the existing import route', async t => {
  const f = await fixture(t, false);
  assert.equal((await (await f.request('/api/session')).json()).originalPasteEnabled, false);
  const response = await f.upload('/api/member-restore/preview');
  assert.equal(response.status, 404, await response.clone().text());
  assert.equal(f.app.store.getInfo().revision, 0);
});

test('flag-on HTTP preview/apply requires reviewed bytes and destination, retains evidence, and supports Undo', async t => {
  const f = await fixture(t, true);
  assert.equal((await (await f.request('/api/session')).json()).originalPasteEnabled, true);
  assert.equal((await f.upload('/api/member-restore', { expectedRevision: 0 })).status, 409);
  const response = await f.upload('/api/member-restore/preview');
  assert.equal(response.status, 200, await response.clone().text());
  const preview = await response.json();
  assert.ok(preview.previewToken);
  assert.equal(preview.transferReport.rules[0].key, 'F2P');
  const applied = await f.upload('/api/member-restore?view=play-v1', { expectedRevision: 0, previewToken: preview.previewToken });
  assert.equal(applied.status, 200, await applied.clone().text());
  assert.equal((await applied.json()).state.members[0].unlocked[0], '12850');
  assert.equal((await (await f.request('/api/backups')).json()).backups.length, 1);
  const backup = await (await f.request('/api/backup')).json();
  assert.match(backup.state.provenance.originalPasteImports[0].gameplayText, /t_unknown/);
  const undo = await f.json('/api/command?view=play-v1', { command: { type: 'undo' }, expectedRevision: 1 });
  assert.equal(undo.status, 200, await undo.clone().text());
  assert.deepEqual(f.app.store.getState().members[0].unlocked, []);
  assert.equal((await f.upload('/api/member-restore', { expectedRevision: 0, previewToken: preview.previewToken })).status, 409);
  const invite = await f.json('/api/invites', { label: 'Synthetic player invitation', memberId: 'other' });
  assert.equal(invite.status, 201, await invite.clone().text());
  const joined = await fetch((await invite.json()).link, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.upload('/api/member-restore/preview', {}, cookie)).status, 403);
});

function dialogFixture(enabled) {
  const nodes = [];
  const el = (tag, text = '') => {
    const node = { tag, text, textContent: text, id: `synthetic-node-${nodes.length}`, children: [], value: '', checked: false, hidden: false, disabled: false, listeners: {},
      append(...children) { this.children.push(...children); }, prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; }, setAttribute() {}, addEventListener(event, callback) { this.listeners[event] = callback; } };
    nodes.push(node); return node;
  };
  const c = { el, originalPasteEnabled: enabled, state: createGroupState([{ id: 'destination', name: 'Synthetic player' }]),
    sessionAdmin: true, sessionMember: 'destination', dataset: { capabilities: {} }, advanced: () => false,
    input: type => Object.assign(el('input'), { type, files: [] }),
    select: (options, value) => Object.assign(el('select'), { options, value }), field: (label, node) => Object.assign(el('label', label), { control: node, firstChild: { id: 'synthetic-label' } }),
    button: (text, click) => Object.assign(el('button', text), { click }), $: () => null, openDialog() {}, notice() {} };
  createScreenDialogs(c); c.openDialog = () => {}; c.backupDialog();
  return { c, nodes };
}
test('original entry is absent when off; flag-on UI labels fields and defaults both optional imports off', () => {
  assert.ok(!dialogFixture(false).nodes.some(node => node.tag === 'button' && node.text === 'Import from the original chunk picker'));
  const { nodes } = dialogFixture(true);
  const entry = nodes.find(node => node.tag === 'button' && node.text === 'Import from the original chunk picker');
  assert.ok(entry); entry.click();
  const labels = nodes.filter(node => node.tag === 'label');
  assert.ok(labels.some(node => node.text.startsWith('Rules JSON')));
  for (const node of labels.filter(node => node.text.startsWith('Import '))) assert.equal(node.control.checked, false);
  assert.equal(nodes.find(node => node.tag === 'input' && node.type === 'file').disabled, true);
});
