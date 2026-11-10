import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { channel } from 'node:diagnostics_channel';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Test-only observation. Do not change scheduling, await resources on behalf of
// the tool, or turn a failed rename into a successful operation.
export function auditInflater(journal, { inspectFailure } = {}) {
  const original = { open: promises.open, readFile: promises.readFile, rename: promises.rename, stream: fs.createReadStream };
  const normalize = file => typeof file === 'string' ? path.resolve(file).toLowerCase() : '';
  const target = normalize(journal), matches = file => normalize(file) === target || normalize(file).startsWith(target + '.');
  const active = new Map(), children = [], workers = [], renames = [];
  let sequence = 0;
  const enter = (operation, file) => { const id = ++sequence; active.set(id, { operation, file: path.basename(file) }); return id; };
  const child = ({ process: processChild }) => {
    const row = { pid: null, closed: false }; children.push(row);
    processChild.once('spawn', () => { row.pid = processChild.pid; });
    processChild.once('close', () => { row.closed = true; });
  };
  const worker = ({ worker: thread }) => {
    const row = { threadId: thread.threadId, exited: false }; workers.push(row);
    thread.once('exit', () => { row.exited = true; });
  };
  channel('child_process').subscribe(child); channel('worker_threads').subscribe(worker);
  promises.open = async function(file, ...args) {
    const handle = await original.open.call(this, file, ...args);
    if (matches(file)) {
      const id = enter('FileHandle', file), close = handle.close.bind(handle);
      handle.close = async () => { await close(); active.delete(id); };
    }
    return handle;
  };
  promises.readFile = async function(file, ...args) {
    if (!matches(file)) return original.readFile.call(this, file, ...args);
    const id = enter('readFile (includes close)', file);
    try { return await original.readFile.call(this, file, ...args); }
    finally { active.delete(id); }
  };
  fs.createReadStream = function(file, ...args) {
    const stream = original.stream.call(this, file, ...args);
    if (matches(file)) { const id = enter('ReadStream', file); stream.once('close', () => active.delete(id)); }
    return stream;
  };
  const snapshot = () => ({ active: [...active.values()], children: structuredClone(children), workers: structuredClone(workers), renames: structuredClone(renames) });
  promises.rename = async function(from, to) {
    if (!matches(to)) return original.rename.call(this, from, to);
    const row = { active: [...active.values()], succeeded: false }; renames.push(row);
    try { const result = await original.rename.call(this, from, to); row.succeeded = true; return result; }
    catch (error) {
      error.inflaterAudit = snapshot();
      if (inspectFailure) {
        try { error.fileUsers = await inspectFailure([from, to]); }
        catch (probeError) { error.fileUsers = { probeError: probeError.message }; }
      }
      throw error;
    }
  };
  syncBuiltinESMExports();
  return { snapshot, restore() {
    Object.assign(promises, { open: original.open, readFile: original.readFile, rename: original.rename });
    fs.createReadStream = original.stream;
    channel('child_process').unsubscribe(child); channel('worker_threads').unsubscribe(worker);
    syncBuiltinESMExports();
  } };
}

// Restart Manager inspects only the named synthetic files, without a global
// handle walk, elevation, process termination, or scanner configuration changes.
export async function windowsFileUsers() {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    fileURLToPath(new URL('./owned-inflater-file-users.ps1', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const closed = once(child, 'close'), lines = createInterface({ input: child.stdout });
  const pending = [];
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  lines.on('line', line => {
    const waiter = pending.shift();
    try { const reply = JSON.parse(line); if (reply.error) throw Error(reply.error); waiter?.resolve(reply); }
    catch (error) { waiter?.reject(error); }
  });
  child.once('error', error => { for (const waiter of pending.splice(0)) waiter.reject(error); });
  child.once('close', () => { for (const waiter of pending.splice(0)) waiter.reject(Error('File-users probe closed: ' + stderr)); });
  const request = message => new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify(message) + '\n'); });
  await request({ operation: 'ready' });
  return { pid: child.pid, inspect: files => request({ operation: 'inspect', files }),
    hold: file => request({ operation: 'hold', file }), release: () => request({ operation: 'release' }),
    async close() { child.stdin.end(); const [code] = await closed; lines.close(); if (code !== 0) throw Error('File-users probe failed: ' + stderr); } };
}
