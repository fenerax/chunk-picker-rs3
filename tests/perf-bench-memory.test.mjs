import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { serverMemorySample, recordServerMemory, sanitizeMemoryTelemetry, safeDiagnostic, safeStderrTail, DIAGNOSTIC_PREFIX } from '../scripts/perf/diagnostics.mjs';

test('server memory samples retain numeric process fields and the actual V8 heap limit', () => {
  const sample = serverMemorySample({ rss: 100, heapUsed: 50, heapTotal: 80, external: 9, arrayBuffers: 3,
    private: 'fixture-private' }, 1536 * 1048576, 12345);
  assert.deepEqual(sample, { sampledAtEpochMs: 12345, rssBytes: 100, heapUsedBytes: 50,
    heapTotalBytes: 80, externalBytes: 9, arrayBuffersBytes: 3, heapSizeLimitBytes: 1536 * 1048576 });
  assert.deepEqual(serverMemorySample({ rss: '100', heapUsed: Infinity, heapTotal: -1, external: NaN }, '1536', null),
    Object.fromEntries(Object.keys(sample).map(key => [key, null])));
});

test('retained memory keeps the last sample and independent sampled peaks across GC', () => {
  const first = recordServerMemory(null, serverMemorySample({ rss: 200, heapUsed: 180, heapTotal: 190, external: 5 }, 1600, 100));
  const next = recordServerMemory(first, serverMemorySample({ rss: 220, heapUsed: 80, heapTotal: 100, arrayBuffers: 8 }, 1600, 200));
  assert.equal(first.samples, 1);
  assert.equal(next.samples, 2);
  assert.equal(next.sampleIntervalMs, 1000);
  assert.equal(next.last.sampledAtEpochMs, 200);
  assert.equal(next.last.heapUsedBytes, 80);
  assert.deepEqual(next.peak, { rssBytes: 220, heapUsedBytes: 180, heapTotalBytes: 190, externalBytes: 5, arrayBuffersBytes: 8 });
  assert.deepEqual(recordServerMemory(next, { sampledAtEpochMs: 'private' }), next);
});

test('IPC memory telemetry uses a numeric allowlist and discards arbitrary text', () => {
  const telemetry = sanitizeMemoryTelemetry({ samples: 'private', sampleIntervalMs: 'private',
    last: { sampledAtEpochMs: 100, rssBytes: 50, heapUsedBytes: 'private', externalBytes: Infinity, secret: 'fixture-private' },
    peak: { rssBytes: 70, heapUsedBytes: -1, secret: 'fixture-private' }, private: 'fixture-private' });
  assert.equal(telemetry.samples, null);
  assert.equal(telemetry.last.heapUsedBytes, null);
  assert.equal(telemetry.last.externalBytes, null);
  assert.equal(telemetry.peak.heapUsedBytes, null);
  assert.equal(telemetry.peak.rssBytes, 70);
  assert.equal(sanitizeMemoryTelemetry({ last: { sampledAtEpochMs: Infinity } }), null);
  assert.doesNotMatch(JSON.stringify(telemetry), /private|secret|Infinity/);
});

test('V8 fatal heap variants emit only a fixed message and withhold paths and payloads', () => {
  for (const fatal of ['Reached heap limit Allocation failed', 'Ineffective mark-compacts near heap limit',
    'CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory',
    'NewSpace::Rebalance Allocation failed - process out of memory']) {
    assert.deepEqual(safeStderrTail(`private payload\nFATAL ERROR: ${fatal} /private/save.json fixture-private\nprivate stack`), ['Node heap limit reached.']);
  }
  assert.deepEqual(safeStderrTail('private JavaScript heap out of memory /private/save.json'), []);
});

test('startup crash retains the last sanitized sample received before ready without starting a server', async () => {
  const filename = new URL('../scripts/perf/page-load.mjs', import.meta.url);
  const source = await readFile(filename, 'utf8');
  const start = source.indexOf('async function startServer('), end = source.indexOf('\nasync function authenticate(', start);
  const child = new EventEmitter();
  child.exitCode = null; child.signalCode = null;
  const telemetry = recordServerMemory(null, serverMemorySample({ rss: 1400, heapUsed: 1300 }, 1536, 100));
  const context = vm.createContext({ path, performance, URL, setTimeout, clearTimeout,
    process: { env: {}, execArgv: [] }, ROOT: path.resolve('synthetic-harness'), options: { timeout: 1000 },
    safeDiagnostic, safeStderrTail, sanitizeMemoryTelemetry, DIAGNOSTIC_PREFIX, diagnosticContext: {}, console: { error() {} },
    fork: () => {
      queueMicrotask(() => {
        child.emit('message', { type: 'memory', memoryTelemetry: { ...telemetry, secret: 'fixture-private' } });
        child.signalCode = 'SIGTRAP'; child.emit('exit', null, 'SIGTRAP');
      });
      return child;
    }, stopChild: async () => {} });
  vm.runInContext(source.slice(start, end).replaceAll('import.meta.url', JSON.stringify(filename.href)) + '\nglobalThis.start = startServer;', context);
  await assert.rejects(context.start(path.resolve('synthetic-scratch')), error => {
    assert.equal(error.message, 'Scratch server exited during startup.');
    assert.equal(error.serverExit.signal, 'SIGTRAP');
    assert.equal(error.serverMemoryTelemetry.last.heapSizeLimitBytes, 1536);
    assert.equal(error.serverMemoryTelemetry.last.heapUsedBytes, 1300);
    assert.doesNotMatch(JSON.stringify(error.serverMemoryTelemetry), /fixture-private|secret/);
    return true;
  });
});
