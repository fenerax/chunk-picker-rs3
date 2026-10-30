import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { frames, writer, stringify, unpackParts } from '../../calculator/reference/codec.mjs';

// Shell-style quoting without invoking a shell. Commands cannot execute shell
// expansion, redirection or pipelines; use a wrapper executable for those.
export function commandWords(command) {
  const words = []; let word = '', quote = '', escaped = false, started = false;
  for (const c of command) {
    if (escaped) { word += c; escaped = false; started = true; }
    else if (c === '\\' && quote !== "'") escaped = true;
    else if (quote) { if (c === quote) quote = ''; else word += c; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) { words.push(word); word = ''; started = false; } }
    else { word += c; started = true; }
  }
  if (quote || escaped) throw new TypeError('invalid');
  if (started) words.push(word);
  if (!words.length) throw new TypeError('invalid');
  return words;
}
export class Calculator {
  constructor(command, { timeoutMs = 180000, env = process.env } = {}) {
    const [program, ...args] = commandWords(command);
    this.child = spawn(program, [...args, '--protocol', '1'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    this.child.stderr.resume(); // Candidate logs are never copied into reports.
    this.send = writer(this.child.stdin);
    this.sentRequests = {}; this.pending = new Map(); this.nextId = 0; this.timeoutMs = timeoutMs; this.peakRSSBytes = 0; this.stderrBytes = 0;
    this.child.stderr.on('data', bytes => { this.stderrBytes += bytes.length; });
    this.exited = new Promise(resolve => this.child.once('close', (code, signal) => { this.exit = { code, signal }; resolve(this.exit); }));
    this.child.on('error', () => this.fail());
    this.child.stdin.on('error', () => this.fail());
    this.ready = new Promise((resolve, reject) => { this.onReady = resolve; this.readyReject = reject; });
    this.ready.catch(() => {}); // A failure before init() awaits it is reported there, not as an unhandled rejection.
    this.reading = this.read().catch(() => this.fail());
    this.memoryTimer = setInterval(() => { void this.sampleMemory(); }, 25); this.memoryTimer.unref();
  }
  fail() {
    const error = new Error('failed');
    this.readyReject?.(error); this.readyReject = undefined;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  async sampleMemory() {
    if (!this.child.pid || this.samplingMemory) return;
    this.samplingMemory = true;
    try {
      const pid = this.child.pid;
      if (performance.now() >= (this.nextProcessScan ?? 0)) {
        this.nextProcessScan = performance.now() + 1000;
        // Some Linux sandboxes omit /proc/PID/task/TID/children. PPid in
        // status/stat still identifies wrapper descendants without ps(1).
        const rows = await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(async name => {
          try {
            const stat = await readFile(`/proc/${name}/stat`, 'utf8');
            return [Number(name), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])];
          } catch { return []; }
        }));
        const parents = new Set([pid]);
        for (let changed = true; changed;) {
          changed = false;
          for (const [child, parent] of rows) if (parents.has(parent) && !parents.has(child)) { parents.add(child); changed = true; }
        }
        this.memoryPids = [...parents];
      }
      const sizes = await Promise.all((this.memoryPids ?? [pid]).map(async current => {
        try {
          const status = await readFile(`/proc/${current}/status`, 'utf8');
          if (current === pid) this.peakRSSBytes = Math.max(this.peakRSSBytes, Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024);
          return Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
        } catch { return 0; }
      }));
      this.peakRSSBytes = Math.max(this.peakRSSBytes, sizes.reduce((a,b) => a+b, 0));
    } catch {} finally { this.samplingMemory = false; }
  }
  async read() {
    for await (const { header, body } of frames(this.child.stdout)) {
      if (header.v !== 1) throw new TypeError('invalid');
      if (header.type === 'ready') { this.onReady({ header, parts: unpackParts(header, body) }); this.readyReject = undefined; continue; }
      const entry = this.pending.get(header.id);
      if (!entry) throw new TypeError('invalid');
      if (header.type === 'progress') { entry.arm(); continue; }
      if (header.type === 'prediction-prepared') { entry.prepared.push({ header: { memberId: header.memberId, taskInputKey: header.taskInputKey, sourceRevision: header.sourceRevision, priority: header.priority }, parts: unpackParts(header, body) }); entry.arm(); continue; }
      if (!['error', 'result'].includes(header.type)) throw new TypeError('invalid');
      // Decode while the entry is still pending, so a malformed part rejects it through fail().
      const parts = unpackParts(header, body);
      this.pending.delete(header.id); clearTimeout(entry.timer);
      entry.resolve({ header, parts, prepared: entry.prepared });
    }
    if (this.pending.size || this.readyReject) this.fail();
  }
  async init(bundle) {
    // The watchdog also covers the write: a candidate that never reads stdin
    // would otherwise hold send() waiting for drain past the timeout.
    let timeout;
    const expired = new Promise((_, reject) => { timeout = setTimeout(() => { this.fail(); this.child.kill('SIGKILL'); reject(new Error('failed')); }, this.timeoutMs); });
    try {
      const ready = await Promise.race([this.send({ v: 1, type: 'init' }, Buffer.from(stringify(bundle))).then(() => this.ready), expired]);
      // Fast calculators can finish before the next periodic descendant scan.
      // Sample at ready while wrapper children are guaranteed to be alive.
      while (this.samplingMemory) await new Promise(resolve => setImmediate(resolve));
      this.nextProcessScan = 0;
      await this.sampleMemory();
      return ready;
    }
    finally { clearTimeout(timeout); }
  }
  async control(header) { await this.send({ v: 1, ...header }); }
  request(header, state) {
    const id = ++this.nextId;
    this.sentRequests[header.type] = (this.sentRequests[header.type] ?? 0) + 1;
    const promise = new Promise((resolve, reject) => {
      const entry = { resolve, reject, prepared: [], arm: () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => { this.pending.delete(id); reject(new Error('failed')); }, this.timeoutMs);
      } };
      this.pending.set(id, entry); entry.arm();
      void this.send({ v: 1, ...header, id }, state === undefined ? undefined : Buffer.from(JSON.stringify(state))).catch(() => this.fail());
    });
    return { id, promise };
  }
  async close() {
    this.child.stdin.end();
    const kill = setTimeout(() => this.child.kill('SIGKILL'), 5000);
    try { await this.exited; await this.reading; await this.sampleMemory(); }
    finally { clearTimeout(kill); clearInterval(this.memoryTimer); }
  }
}
