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

test('PowerShell restores the exact daily ZIP pair and leaves source archive immutable', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), input = path.join(f.root, 'daily.zip'), target = path.join(f.root, 'zip-target');
  const feedback = Buffer.from(JSON.stringify({ schemaVersion: 1, items: [] }));
  const bytes = zip([{ name: daily, bytes: f.bytes }, { name: daily.replace('.json', '-feedback.json'), bytes: feedback }]);
  await writeFile(input, bytes); const output = await runWrapper(input, target);
  assert.equal(JSON.parse(output.stdout).feedbackRestored, true); assert.deepEqual(await readFile(input), bytes);
  assert.deepEqual(await readFile(path.join(target, 'feedback.json')), feedback);
  const store = await openStore({ dataDir: target, retention: false });
  try { assert.deepEqual(await store.backup(), f.document); } finally { await store.close(); }
});

test('PowerShell rejects traversal, duplicates, credentials, extra files and oversized ZIP entries', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), valid = { name: daily, bytes: f.bytes };
  const cases = [[valid, { name: '../outside.json', bytes: secret }], [valid, valid], [valid, { name: 'access-token', bytes: secret }],
    [valid, { name: 'extra.json', bytes: secret }], [valid, { name: daily.replace('.json', '-feedback.json'), bytes: '{}', declaredSize: 256 * 1024 * 1024 + 1 }],
    [{ ...valid, declaredSize: f.bytes.length - 1 }]];
  for (let i = 0; i < cases.length; i++) {
    const input = path.join(f.root, `malicious-${i}.zip`), target = path.join(f.root, `malicious-target-${i}`), bytes = zip(cases[i]); await writeFile(input, bytes);
    await assert.rejects(runWrapper(input, target), error => { assert.equal(`${error.stdout}${error.stderr}`.includes(secret), false); return true; });
    await absent(target); assert.deepEqual(await readFile(input), bytes);
  }
  await absent(path.join(f.root, 'outside.json'));
});

test('PowerShell omitted target creates distinct scratch stores directly under this worktree local folder', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const local = path.resolve(fileURLToPath(new URL('../.local/', import.meta.url)));
  const targets = [];
  t.after(async () => {
    for (const target of targets) {
      assert.equal(path.isAbsolute(target), true);
      assert.equal(path.dirname(target).toLowerCase(), local.toLowerCase());
      assert.match(path.basename(target), /^restore-\d{8}-\d{6}-[a-f0-9]{32}$/);
      // Refuse redirected targets before recursively removing our scratch stores.
      assert.equal((await lstat(target)).isSymbolicLink(), false);
      assert.equal(path.resolve(await realpath(target)).toLowerCase(), target.toLowerCase());
      await rm(target, { recursive: true });
    }
  });
  for (let i = 0; i < 2; i++) {
    const output = await exec('pwsh', ['-NoProfile', '-NonInteractive', '-File', wrapper, '-BackupPath', f.backupPath], { timeout: 30000, windowsHide: true });
    const result = JSON.parse(output.stdout), target = result.targetFolder;
    assert.equal(path.isAbsolute(target), true);
    assert.equal(path.dirname(target).toLowerCase(), local.toLowerCase());
    assert.match(path.basename(target), /^restore-\d{8}-\d{6}-[a-f0-9]{32}$/);
    assert.notEqual(path.basename(target).toLowerCase(), 'duo');
    targets.push(target);
    const store = await openStore({ dataDir: target, retention: false });
    try { assert.deepEqual(await store.backup(), f.document); } finally { await store.close(); }
  }
  assert.notEqual(targets[0].toLowerCase(), targets[1].toLowerCase());
  assert.deepEqual(await readFile(f.backupPath), f.bytes);
});
