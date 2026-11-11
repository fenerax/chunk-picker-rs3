// Harness-only preload for the controller, calculator relay and calculator
// isolate. Optional in-process ledger observers; no protocol changes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { Session } from 'node:inspector';
import { writeHeapSnapshot, getHeapCodeStatistics } from 'node:v8';
import { isMainThread, parentPort, threadId } from 'node:worker_threads';

const directory = process.env.RS3_ACCEPTANCE_PROBE_DIR;
if (directory) {
  const write = fs.writeFileSync, append = fs.appendFileSync, rename = fs.renameSync;
  const isolate = `${process.pid}-${threadId}`;
  const filename = path.join(directory, `${isolate}.jsonl`);
  const inspector = new Session(); inspector.connect();
  const io = { fsyncAttempts: 0, fsyncs: 0, bytesWritten: 0, writeCalls: 0, baseWrites: 0 };
  let peaks = {}, sequence = 0, busy = false, failure, controlOffset = 0;
  const snapshot = () => {
    const memory = process.memoryUsage();
    for (const [key, value] of Object.entries(memory)) peaks[key] = Math.max(peaks[key] ?? 0, value);
    return { pid: process.pid, threadId, sequence, memory, peaks: { ...peaks }, cpu: process.cpuUsage(),
      maxRSSBytes: process.resourceUsage().maxRSS * 1024, io: { ...io } };
  };
  const record = () => {
    const row = snapshot();
    // Readers may hold these files open on Windows. Append complete records;
    // never replace a target being read, or retry a failed publication.
    append(filename, JSON.stringify(row) + '\n');
    return row;
  };
  const fail = error => {
    if (!failure) {
      failure = error;
      // This durable failure is checked at every barrier, not only on timeout.
      try { write(path.join(directory, `${isolate}.error`), String(error.stack), { flag: 'wx' }); }
      catch { console.error(error); process.exit(1); }
    }
    return error;
  };
  const requestAfter = () => {
    // The single controller appends requests. Read only new bytes and consume
    // complete lines, so a partial append cannot acknowledge a request early.
    const fd = fs.openSync(path.join(directory, 'control.jsonl'), 'r');
    try {
      const buffer = Buffer.alloc(fs.fstatSync(fd).size - controlOffset);
      const length = fs.readSync(fd, buffer, 0, buffer.length, controlOffset);
      const end = buffer.subarray(0, length).lastIndexOf(10);
      if (end < 0) return;
      controlOffset += end + 1;
      return JSON.parse(buffer.subarray(0, end).toString('utf8').split('\n').at(-1));
    } finally { fs.closeSync(fd); }
  };
  const under = (parent, target) => { const relative = path.relative(parent, target); return !relative || !relative.startsWith('..') && !path.isAbsolute(relative); };
  const measured = target => typeof target === 'string' && under(process.env.RS3_ACCEPTANCE_STORE_ROOT, path.resolve(target));
  const countWrite = (target, bytes) => {
    io.writeCalls++; io.bytesWritten += bytes;
    if (path.basename(String(target)).startsWith('catalogue-')) io.baseWrites++;
    snapshot();
  };
  const size = (bytes, options) => typeof bytes === 'string' ? Buffer.byteLength(bytes, typeof options === 'string' ? options : options?.encoding) : bytes.byteLength;
  for (const name of ['writeFile', 'appendFile']) {
    const original = fsp[name];
    fsp[name] = async function(target, bytes, options) {
      const result = await original.call(this, target, bytes, options);
      if (measured(target)) countWrite(target, size(bytes, options));
      return result;
    };
  }
  const open = fsp.open;
  fsp.open = async function(target, ...args) {
    const handle = await open.call(this, target, ...args);
    if (!measured(target)) return handle;
    let depth = 0;
    for (const name of ['writeFile', 'appendFile', 'write', 'writev']) {
      const original = handle[name];
      handle[name] = async function(...input) {
        const outer = depth++ === 0;
        try {
          const result = await original.apply(this, input);
          if (outer) countWrite(target, name === 'write' || name === 'writev' ? result.bytesWritten : size(input[0], input[1]));
          return result;
        } finally { depth--; }
      };
    }
    for (const name of ['sync', 'datasync']) {
      const original = handle[name];
      handle[name] = async function(...input) {
        io.fsyncAttempts++; snapshot();
        const result = await original.apply(this, input); io.fsyncs++; return result;
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
  const collect = request => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const finish = () => {
      try {
        if (request.snapshot) writeHeapSnapshot(path.join(directory, `${process.pid}-${threadId}-${request.sequence}.heapsnapshot`));
        if (request.resetPeaks) peaks = {};
        const row = { ...snapshot(), sequence: request.sequence, code: getHeapCodeStatistics(),
          ownerLedgers: request.ledgers ? globalThis[Symbol.for('rs3.acceptance.probe')].ownerLedgers?.() ?? [] : [] };
        // Each barrier has a fresh directory and immutable receipt. No reader
        // can hold the rename destination open: it does not exist yet.
        const checkpointFile = path.join(directory, 'checkpoints', String(request.sequence), `${isolate}.json`);
        write(checkpointFile + '.tmp', JSON.stringify(row), { flag: 'wx' });
        rename(checkpointFile + '.tmp', checkpointFile);
        // Acknowledge only after publication. A failure is terminal and is
        // surfaced to the controller; it cannot silently skip this sequence.
        sequence = request.sequence;
        resolve(row);
      } catch (error) { reject(fail(error)); }
    };
    if (request.gc) inspector.post('HeapProfiler.collectGarbage', error => error ? reject(fail(error)) : finish());
    else finish();
  });
  globalThis[Symbol.for('rs3.acceptance.probe')] = { collect, record };
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // The controller is itself forked with IPC, so process.send cannot
      // distinguish it from a relay. It collects explicitly; polling the same
      // request here would race its GC and overwrite the barrier sequence.
      if (isMainThread && process.pid === Number(process.env.RS3_ACCEPTANCE_CONTROLLER_PID)) { record(); return; }
      const request = requestAfter();
      if (request && request.sequence > sequence) await collect(request);
      else record();
    } catch (error) {
      if (error.code !== 'ENOENT' || failure) { fail(error); clearInterval(timer); }
    } finally { busy = false; }
  }, 25);
  timer.unref(); record();
  // Capture synchronous calculation/IPC endpoints before their garbage can be
  // collected. Timers alone miss transient allocations while JS is blocked.
  if (!isMainThread && parentPort) {
    const post = parentPort.postMessage;
    parentPort.postMessage = function(...args) { record(); return post.apply(this, args); };
    parentPort.on('message', message => {
      if (message?.type === 'cancel' && message.id === -1 && message.memoryPort)
        message.memoryPort.postMessage({ threadId, memoryUsage: process.memoryUsage() });
    });
  }
  if (isMainThread && process.send) {
    const send = process.send;
    process.send = function(...args) { record(); return send.apply(this, args); };
  }
}
