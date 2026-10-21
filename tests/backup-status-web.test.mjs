import test from 'node:test';
import assert from 'node:assert/strict';
import { backupStatusText, createBackupStatus } from '../app/web/backup-status.mjs';

function harness(admin = true) {
  const node = (tag, text, className) => ({ tag, textContent: text, className, hidden: true, children: [], replaceChildren(...children) { this.children = children; } });
  const menuLine = node('p'), banner = node('div'), document = { visibilityState: 'visible' };
  let response = { result: 'success', lastRunAt: '2026-10-11T03:00:00Z', lastSuccessAt: '2026-10-11T03:00:00Z', byteSize: 8192, warning: null }, requests = 0, ticks, reviewed = 0, stopped = 0;
  const controller = createBackupStatus({ el: node, button: (text, action) => ({ textContent: text, action }), menuLine, banner, document,
    isAdmin: () => admin, api: async path => { assert.equal(path, '/api/backup-status'); requests++; if (response instanceof Error) throw response; return await response; },
    openBackup: () => reviewed++, setInterval: (action, ms) => { assert.equal(ms, 900000); ticks = action; return 1; }, clearInterval: () => stopped++ });
  return { controller, menuLine, banner, document, get requests() { return requests; }, get reviewed() { return reviewed; }, get stopped() { return stopped; }, tick: () => ticks?.(), respond: value => { response = value; } };
}

test('invite sessions have no status requests, polling, lines or notices', async () => {
  const h = harness(false);
  h.controller.start(); await h.controller.refresh(); h.tick();
  assert.equal(h.requests, 0); assert.equal(h.controller.line(), null);
  assert.equal(h.menuLine.hidden, true); assert.equal(h.banner.hidden, true);
});

test('successful admin status updates menu and dialog and clears a warning', async () => {
  const h = harness(), line = h.controller.line();
  h.respond({ result: 'failed', lastSuccessAt: '2026-10-10T03:00:00Z', warning: 'failed' });
  await h.controller.refresh();
  assert.equal(h.banner.hidden, false); assert.match(line.textContent, /Last backup:/);
  await h.banner.children[1].action(); assert.equal(h.reviewed, 1);
  h.respond({ result: 'success', lastRunAt: '2026-10-11T03:00:00Z', lastSuccessAt: '2026-10-11T03:00:00Z', byteSize: 8192, warning: null });
  await h.controller.refresh();
  assert.equal(h.banner.hidden, true); assert.match(h.menuLine.textContent, /8 KB$/);
  assert.equal(line.textContent, h.menuLine.textContent);
});

test('all actionable warnings stay visible in their own region with recovery', async () => {
  const h = harness();
  for (const warning of ['failed', 'stale', 'not-configured', 'not-run', 'unavailable']) {
    h.respond({ result: 'never', warning }); await h.controller.refresh();
    assert.equal(h.banner.hidden, false, warning);
    assert.ok(h.banner.children[0].textContent.length > 20);
    assert.equal(h.banner.children[1].textContent, 'Review backups');
  }
});

test('network failure preserves the known backup and permits a later refresh', async () => {
  const h = harness(); await h.controller.refresh(); const known = h.menuLine.textContent;
  h.respond(new Error('private path must not leak')); await h.controller.refresh();
  assert.equal(h.menuLine.textContent, known); assert.match(h.banner.children[0].textContent, /status is unavailable/);
  assert.doesNotMatch(h.banner.children[0].textContent, /private path/);
  h.respond({ result: 'success', lastSuccessAt: '2026-10-11T03:00:00Z', warning: null }); await h.controller.refresh();
  assert.equal(h.banner.hidden, true);
});

test('refresh coalesces overlapping opens and sparse polling skips hidden tabs', async () => {
  const h = harness(); let resolve;
  h.respond(new Promise(done => { resolve = done; }));
  h.controller.start(); const open = h.controller.refresh(); assert.equal(h.requests, 1);
  resolve({ result: 'never', warning: 'not-run' }); await open;
  h.document.visibilityState = 'hidden'; h.tick(); assert.equal(h.requests, 1);
  h.document.visibilityState = 'visible'; h.tick(); await h.controller.refresh(); assert.equal(h.requests, 2);
  h.controller.dispose(); assert.equal(h.stopped, 1);
});

test('last backup reports the successful run and avoids failed-run size or invalid dates', () => {
  assert.equal(backupStatusText({ result: 'never' }), 'Last backup: none yet');
  assert.equal(backupStatusText({ result: 'unknown', lastSuccessAt: 'bad' }), 'Last backup: unknown');
  const value = backupStatusText({ result: 'failed', lastSuccessAt: '2026-10-10T03:00:00Z', lastRunAt: '2026-10-11T03:00:00Z', byteSize: 12345 });
  assert.match(value, /Last backup:/); assert.doesNotMatch(value, /KB/);
});
