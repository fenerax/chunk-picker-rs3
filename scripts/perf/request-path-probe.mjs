// Diagnostic preload for request-path.mjs; never loaded by normal application runs.
import { createRequire, registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';
import { isMainThread, threadId, parentPort } from 'node:worker_threads';
const now = () => performance.timeOrigin + performance.now();
globalThis.__requestPath = (stage, details = {}) => {
  if (process.env.RS3_REQUEST_PATH_LOG) appendFileSync(process.env.RS3_REQUEST_PATH_LOG,
    JSON.stringify({ stage, at: now(), pid: process.pid, threadId, ...details }) + '\n');
};
globalThis.__requestTimed = (stage, operation) => {
  const start = now(); try { return operation(); } finally { globalThis.__requestPath(stage, { ms: now() - start }); }
};
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('.mjs') || !url.includes('/app/tasks/')) return result;
  let source = String(result.source);
  if (url.endsWith('/process-worker-transport.mjs')) {
    for (const name of ['encodeProcessMessage', 'decodeReceivedProcessMessage']) {
      source = source.replace(`export function ${name}(`, `function original_${name}(`);
      source += `\nexport function ${name}(...args) { return globalThis.__requestTimed('${name}', () => original_${name}(...args)); }\n`;
    }
  }
  if (url.endsWith('/worker.mjs')) source = source.replace("JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateJSON))", "globalThis.__requestTimed('stateJSONParse', () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateJSON)))");
  if (url.endsWith('/scheduler.mjs')) source = source.replace('active = entry; entry.startedAt = idleClock.now(); entry.id = ++sequence;', "active = entry; entry.startedAt = idleClock.now(); entry.id = ++sequence; globalThis.__requestPath('schedulerDispatch', { id: entry.id, type: entry.type, queueMs: entry.startedAt - entry.queuedAt });");
  if (url.endsWith('/process-worker.mjs')) source = source.replace("this.#child.on('message', message => {", "globalThis.__requestPath('childSpawned', { childPid: this.#child.pid }); this.#child.on('message', message => {").replace('this.#child.send(message,', "globalThis.__requestTimed('ipcSerialize', () => this.#child.send(message,")
    .replace('this.#fail(error); }); }', 'this.#fail(error); })); }');
  if (url.endsWith('/process-worker-host.mjs')) {
    source = source.replace("if (stopping) return;\n  try {", "if (stopping) return;\n  globalThis.__requestPath('hostReceived', { kind: message.kind, id: message.payload?.data?.id });\n  try {");
    source = source.replace('worker.postMessage(request);', "globalThis.__requestPath('hostDispatch', { id: request.id }); globalThis.__requestTimed('threadSerialize', () => worker.postMessage(request));");
  }
  return { ...result, source };
} });
if (parentPort) parentPort.on('message', message => {
  if (message.memoryPort) { message.memoryPort.postMessage({ threadId, memoryUsage: process.memoryUsage(), maxRSS: process.resourceUsage().maxRSS * 1024 }); message.memoryPort.close(); }
  if (message.id !== undefined && message.type !== 'cancel') globalThis.__requestPath('workerReceived', { id: message.id });
});

const clone = globalThis.structuredClone;
globalThis.structuredClone = function(value, ...args) {
  if (value?.schemaVersion === 1 && Array.isArray(value.members)) return globalThis.__requestTimed('stateClone', () => clone(value, ...args));
  return clone(value, ...args);
};

// Node 24 builds can use a native IPC codec that bypasses node:v8 classes.
// --expose-internals is diagnostic-only: wrap the channel codec actually in use.
// The parser timing includes final buffer reassembly and native deserialization;
// the write hook observes the exact serialized buffer, without serializing twice.
if (isMainThread) {
  const { advanced } = createRequire(import.meta.url)('internal/child_process/serialization');
  const write = advanced.writeChannelMessage;
  const { kChannelHandle } = createRequire(import.meta.url)('internal/child_process');
  const channel = process[kChannelHandle];
  if (channel) {
    const read = channel.onread; let lastRead;
    channel.onread = function(...args) {
      const start = now();
      try { return read.apply(this, args); }
      finally { lastRead = { at: now(), ms: now() - start }; }
    };
    // Forked children capture their parser before --import preloads run. The
    // channel read is the observable boundary around reassembly/deserialization;
    // Node schedules the message callback on nextTick after this read returns.
    process.prependListener('message', value => {
      if (lastRead && ['init', 'post'].includes(value?.kind)) globalThis.__requestPath('ipcDeserialize', {
        ...lastRead, kind: value.kind, id: value.payload?.data?.id });
    });
  }
  advanced.writeChannelMessage = function(channel, req, value, handle) {
    const start = now(), own = Object.getOwnPropertyDescriptor(channel, 'writeBuffer'), writeBuffer = channel.writeBuffer;
    let serializedAt, bytes;
    channel.writeBuffer = function(...args) {
      serializedAt = now(); bytes = args[1].byteLength - 4;
      return writeBuffer.apply(this, args);
    };
    try { return write.call(this, channel, req, value, handle); }
    finally {
      if (own) Object.defineProperty(channel, 'writeBuffer', own); else delete channel.writeBuffer;
      if (serializedAt !== undefined && ['init', 'post', 'message'].includes(value?.kind)) globalThis.__requestPath('ipcNativeSerialize', {
        ms: serializedAt - start, bytes, kind: value.kind, id: value.payload?.data?.id });
    }
  };
}
