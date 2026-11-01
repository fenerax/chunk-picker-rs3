import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { EXIT } from './semantic.mjs';
export class Failure extends Error {
  constructor(kind, detail = {}) { super(kind); this.kind = kind; this.code = EXIT[kind]; this.detail = detail; }
}
export class Client {
  constructor(root, mode, scratch, limits, observe = () => {}) {
    this.limits = limits; this.peakRSSBytes = 0; this.currentRSSBytes = 0; this.durations = [];
    this.child = fork(fileURLToPath(new URL('./bridge.mjs', import.meta.url)), [root, mode, scratch], {
      cwd: scratch, execArgv: ['--max-old-space-size=256'], serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    this.closed = new Promise(resolve => this.child.once('close', resolve));
    this.child.on('message', message => {
      if (!this.pending) return;
      if (message.bridgeError) this.fail(new Failure('invalid', { bridge: true }));
      else { const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.resolve(message); }
    });
    this.child.on('error', () => this.fail(new Failure('crash')));
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      if (!this.retiring || signal !== 'SIGKILL') this.fail(new Failure('crash', { code, signal }));
    });
    this.monitor = setInterval(() => { this.sample(); observe(); }, 20);
  }
  sample() {
    try {
      const status = readFileSync(`/proc/${this.child.pid}/status`, 'utf8');
      this.currentRSSBytes = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
      this.peakRSSBytes = Math.max(this.peakRSSBytes, Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0) * 1024);
      if (this.peakRSSBytes > this.limits.rssBytes) this.fail(new Failure('memory'));
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') this.fail(new Failure('invalid', { monitor: true })); }
  }
  fail(error) {
    this.failure ??= error;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    if (!this.exited) this.child.kill('SIGKILL');
  }
  async send(message, deadline, timeout = this.limits.requestMs) {
    if (this.failure) throw this.failure;
    if (this.exited) throw new Failure('crash');
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Failure('budget');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Failure(remaining < timeout ? 'budget' : 'timeout')), Math.min(timeout, remaining));
      this.pending = { resolve, reject, timer };
      this.child.send(message, error => { if (error) this.fail(new Failure('crash')); });
    });
  }
  async request(state, request, deadline, fault) {
    const began = performance.now();
    const reply = await this.send({ state, request, fault }, deadline);
    this.sample();
    if (this.failure) throw this.failure;
    this.durations.push(performance.now() - began);
    return reply.response;
  }
  async close() {
    this.sample(); clearInterval(this.monitor);
    if (!this.exited) { this.retiring = true; this.child.kill('SIGKILL'); }
    await this.closed;
    this.currentRSSBytes = 0;
    return this.failure;
  }
}
