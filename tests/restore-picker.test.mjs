import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, symlink, realpath, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { restorePicker } from '../scripts/restore-picker.mjs';
import { openStore } from '../app/storage/store.mjs';

const exec = promisify(execFile);
const wrapper = fileURLToPath(new URL('../scripts/Restore-Picker.ps1', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/restore-picker.mjs', import.meta.url));
const daily = 'rs3-chunk-picker-2026-10-13.json';
const secret = 'synthetic-private-value-never-print';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-restore-test-'));
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), await realpath(os.tmpdir()));
    assert.match(path.basename(resolved), /^rs3-restore-test-/);
    await rm(resolved, { recursive: true });
  });
  const source = await openStore({ dataDir: path.join(root, 'source'), retention: false });
  let document;
  try {
    await source.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 0);
    document = await source.backup();
  } finally { await source.close(); }
  const backupPath = path.join(root, 'portable.json');
  const bytes = Buffer.from(JSON.stringify(document));
  await writeFile(backupPath, bytes);
  return { root, backupPath, bytes, document };
}
async function absent(target) { await assert.rejects(stat(target), { code: 'ENOENT' }); }
async function runWrapper(backupPath, targetFolder) {
  return exec('pwsh', ['-NoProfile', '-NonInteractive', '-File', wrapper, '-BackupPath', backupPath, '-TargetFolder', targetFolder], { timeout: 30000, windowsHide: true });
}
// Small stored ZIP fixture writer: deliberate duplicate/path entries stay possible.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), bytes = Buffer.from(entry.bytes ?? ''), crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6);
    index.writeUInt32LE(crc, 16); index.writeUInt32LE(bytes.length, 20); index.writeUInt32LE(entry.declaredSize ?? bytes.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE(offset, 42);
    local.push(header, name, bytes); central.push(index, name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('offline JSON and gzip recovery preserves portable history and supports command plus Undo', async t => {
  const f = await fixture(t);
  for (const compressed of [false, 'gzip', 'UPPERCASE.JSON.GZ']) {
    const input = compressed ? path.join(f.root, compressed === 'gzip' ? 'portable.json.gz' : compressed) : f.backupPath;
    if (compressed) await writeFile(input, gzipSync(f.bytes));
    const original = await readFile(input), target = path.join(f.root, compressed ? `restored-${compressed}` : 'json');
    const result = await restorePicker({ backupPath: input, targetFolder: target });
    assert.equal(result.revision, f.document.state.revision); assert.equal(result.historyEntries, f.document.state.history.length);
    assert.deepEqual(await readFile(input), original);
    const restored = await openStore({ dataDir: target, retention: false });
    try {
      assert.deepEqual(await restored.backup(), f.document);
      assert.equal(restored.getUndoEligibility().undoRevision, f.document.state.revision);
      const revision = restored.getState().revision;
      await restored.command({ type: 'set-rule', ruleId: 'access.shared', value: true }, revision);
      await restored.command({ type: 'undo' }, revision + 1);
      assert.equal(restored.getState().rules['access.shared'], false);
      assert.equal((await restored.queryHistory()).history.length >= f.document.state.history.length, true);
    } finally { await restored.close(); }
  }
});

test('existing targets are refused without changing their files or the backup', async t => {
  const f = await fixture(t), target = path.join(f.root, 'existing'); await mkdir(target);
  const marker = path.join(target, 'state.json'); await writeFile(marker, secret);
  await assert.rejects(restorePicker({ backupPath: f.backupPath, targetFolder: target }), /already exists/);
  assert.equal(await readFile(marker, 'utf8'), secret); assert.deepEqual(await readFile(f.backupPath), f.bytes);
});

test('invalid JSON, schemas and missing static/history sidecars fail before creating a target', async t => {
  const f = await fixture(t);
  const cases = [secret, { ...f.document, schemaVersion: 999 }, { ...f.document, storage: { fields: { secret } } },
    { ...f.document, state: { ...f.document.state, provenance: { historyArchive: [{ id: secret }] } } }];
  for (let i = 0; i < cases.length; i++) {
    const input = path.join(f.root, `bad-${i}.json`), target = path.join(f.root, `bad-target-${i}`);
    await writeFile(input, typeof cases[i] === 'string' ? cases[i] : JSON.stringify(cases[i]));
    await assert.rejects(restorePicker({ backupPath: input, targetFolder: target }), error => !error.message.includes(secret));
    await absent(target);
  }
  await assert.rejects(exec(process.execPath, [cli, '--backup', path.join(f.root, 'bad-0.json'), '--target', path.join(f.root, 'cli-target')], { windowsHide: true }), error => {
    assert.equal(error.code, 1); assert.equal(`${error.stdout}${error.stderr}`.includes(secret), false); return true;
  });
});

test('feedback restores separately and invalid feedback rolls back only the new target', async t => {
  const f = await fixture(t), feedbackPath = path.join(f.root, 'feedback.json');
  const feedback = { schemaVersion: 1, items: [{ id: 'fixture', kind: 'idea', text: 'Synthetic feedback', status: 'new' }] };
  await writeFile(feedbackPath, JSON.stringify(feedback));
  const target = path.join(f.root, 'feedback-target');
  assert.equal((await restorePicker({ backupPath: f.backupPath, targetFolder: target, feedbackPath })).feedbackRestored, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(target, 'feedback.json'))), feedback);
  await writeFile(feedbackPath, JSON.stringify({ schemaVersion: 1, items: [{ text: secret }] }));
  const invalidTarget = path.join(f.root, 'invalid-feedback');
  await assert.rejects(restorePicker({ backupPath: f.backupPath, targetFolder: invalidTarget, feedbackPath }), /feedback backup is invalid/);
  await absent(invalidTarget); assert.deepEqual(await readFile(f.backupPath), f.bytes);
});

test('redirected parents are refused', async t => {
  const f = await fixture(t), real = path.join(f.root, 'real'), alias = path.join(f.root, 'alias'); await mkdir(real);
  await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(restorePicker({ backupPath: f.backupPath, targetFolder: path.join(alias, 'restore') }), /symbolic link|junction/);
  await absent(path.join(real, 'restore'));
});



