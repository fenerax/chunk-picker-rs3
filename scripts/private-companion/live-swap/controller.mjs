import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Journal, acquireOperation, latestCheckpoint, failure, atomicJSON } from './journal.mjs';

const terminal = new Set(['admitted', 'rolled-back']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const required = (object, names) => { for (const key of names) if (typeof object?.[key] !== 'function') throw failure(`LIVE_SWAP_ADAPTER_${key}`); };
function checkpointMatches(a, b) { return a?.revision === b?.revision && a?.sha256 === b?.sha256 && a?.schemaVersion === b?.schemaVersion; }
function knownFloor(state) {
  let floor;
  for (const value of [state?.revisionFloor, state?.checkpoint, state?.recoveryCheckpoint]) {
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value?.revision) || value.revision < 0 || !Number.isInteger(value?.schemaVersion) || value.schemaVersion < 1) throw failure('LIVE_SWAP_REVISION_FLOOR_INVALID');
    if (floor && floor.schemaVersion !== value.schemaVersion) throw failure('LIVE_SWAP_SCHEMA_REGRESSION');
    if (!floor || value.revision > floor.revision) floor = { revision: value.revision, schemaVersion: value.schemaVersion };
  }
  return floor;
}
function assertFloor(checkpoint, floor) {
  if (!floor) return;
  if (checkpoint.schemaVersion !== floor.schemaVersion) throw failure('LIVE_SWAP_SCHEMA_REGRESSION');
  if (checkpoint.revision < floor.revision) throw failure('LIVE_SWAP_REVISION_REGRESSION');
}

// No production entry point is installed. The caller supplies an exact owned
// process manager and the managed operator lock/pause/pointer transaction.
export class SwapController {
  constructor({ journal, dataDir, old, next, frontDoor, managed, policy = { mode: 'automatic' }, onPhase = async () => {}, onBoundary = async () => {} }) {
    this.journal = new Journal(journal); Object.assign(this, { dataDir, old, next, frontDoor, managed, policy, onPhase, onBoundary });
    required(frontDoor, ['freeze', 'route', 'probe', 'resume', 'status', 'drain']);
    required(managed, ['acquire', 'assertHeld', 'pause', 'assertStoreReleased', 'commit', 'unpause']);
    for (const instance of [old, next]) required(instance, ['observe', 'standby', 'freeze', 'close', 'activate', 'verify']);
    if (!old.identity || !next.identity || same(old.identity, next.identity)) throw failure('LIVE_SWAP_IDENTITIES');
  }
  async budgetAdmission() {
    if (this.policy.mode === 'verification') return;
    if (this.policy.mode !== 'automatic') throw failure('LIVE_SWAP_POLICY');
    try { await stat(`${this.journal.file}.budget-blocked.json`); throw failure('LIVE_SWAP_BUDGET_BLOCKED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const evidence = this.policy.freezeBudgetEvidence, size = (await stat(path.join(this.dataDir, 'state.json'))).size;
    if (!evidence || evidence.schemaVersion !== 1 || evidence.representative !== true || evidence.liveSwapProtocol !== 2 || evidence.actionReceiptFormat !== 2
      || !same(evidence.old, this.old.identity) || !same(evidence.next, this.next.identity) || !Number.isFinite(evidence.maxFreezeMs)
      || evidence.maxFreezeMs < 0 || evidence.maxFreezeMs > 150 || !Number.isSafeInteger(evidence.maxSaveBytes) || evidence.maxSaveBytes < size) throw failure('LIVE_SWAP_BUDGET_EVIDENCE');
  }
  async budgetResult() {
    const door = await this.frontDoor.status();
    if (door.frozen) throw failure('LIVE_SWAP_DOOR_FROZEN_AFTER_RESUME');
    const freezeMs = Number.isFinite(door.lastFreezeMs) ? door.lastFreezeMs : performance.now() - this.freezeStarted, budgetOverrun = freezeMs > 150;
    if (budgetOverrun) await atomicJSON(`${this.journal.file}.budget-blocked.json`, { schemaVersion: 1, transaction: this.state.transaction, freezeMs, budgetMs: 150, automaticDisabled: true });
    return { freezeMs, budgetMs: 150, budgetOverrun, verificationOnly: this.policy.mode === 'verification' };
  }
  async phase(name, fields = {}, { durable = true } = {}) {
    const started = performance.now();
    await this.managed.assertHeld();
    const next = { ...this.state, ...fields, phase: name };
    this.state = durable ? await this.journal.write(next) : structuredClone(next);
    const elapsed = performance.now() - started;
    if (durable) { this.timings.journalMs += elapsed; this.timings.journals[name] = (this.timings.journals[name] ?? 0) + elapsed; }
    await this.onPhase(name, structuredClone(this.state));
  }
  async measure(name, action) {
    const started = performance.now();
    try { return await action(); } finally { this.timings[name] = (this.timings[name] ?? 0) + performance.now() - started; }
  }
  async verify(instance, standby, checkpoint) {
    const observed = await instance.observe();
    if (observed.state !== 'owned' || observed.standby !== standby || !observed.processIdentity) throw failure('LIVE_SWAP_OWNERSHIP');
    const health = await instance.verify();
    if (!health.ready || health.standby !== standby || health.savesReady !== !standby
      || health.liveSwapProtocol !== 2 || health.actionReceiptFormat !== 2 || health.version !== instance.identity.version
      || (checkpoint && health.revision !== checkpoint.revision)) throw failure('LIVE_SWAP_READINESS');
    return health;
  }
  async closed(instance) {
    const observed = await instance.observe();
    if (!['owned', 'stopped', 'dead'].includes(observed.state)) throw failure('LIVE_SWAP_OWNERSHIP_UNCERTAIN');
    if (observed.state === 'owned') await instance.close();
    const after = await instance.observe();
    if (!['stopped', 'dead'].includes(after.state)) throw failure('LIVE_SWAP_RELEASE_UNCERTAIN');
  }
  async routed(instance, checkpoint) {
    await this.frontDoor.route(instance.identity);
    const result = await this.frontDoor.probe();
    if (!result.ready || result.standby || result.version !== instance.identity.version || result.revision !== checkpoint.revision
      || result.liveSwapProtocol !== 2 || result.actionReceiptFormat !== 2) throw failure('LIVE_SWAP_ROUTE_PROBE');
    const status = await this.frontDoor.status();
    if (!status.frozen || !same(status.target, instance.identity)) throw failure('LIVE_SWAP_ROUTE_CHANGED');
  }
  async deferBusy(code) {
    // Core guarantees these two errors leave old admission unfrozen. No writer
    // release occurred; its existing in-flight request may finish normally.
    await this.closed(this.next); await this.verify(this.old, false);
    await this.frontDoor.route(this.old.identity); const health = await this.frontDoor.probe();
    if (!health.ready || health.standby || health.version !== this.old.identity.version || health.liveSwapProtocol !== 2 || health.actionReceiptFormat !== 2) throw failure('LIVE_SWAP_DEFER_PROBE');
    const observedFloor = { revision: health.revision, schemaVersion: health.saveSchemaVersion };
    assertFloor(observedFloor, knownFloor(this.state));
    await this.managed.commit(this.old.identity);
    await this.phase('rolled-back', { deferred: true, deferredCode: code, preferred: 'old', revisionFloor: knownFloor({ revisionFloor: observedFloor }) });
    await this.managed.unpause(); await this.frontDoor.resume(this.old.identity);
    await this.phase('rolled-back', await this.budgetResult()); return this.state;
  }
  async transact(action) {
    this.state = undefined; this.mustFreeze = false; this.freezeStarted = undefined; this.timings = { journalMs: 0, journals: {} };
    const releaseOperation = await acquireOperation(this.journal.file);
    let releaseManaged;
    try {
      releaseManaged = await this.managed.acquire();
      if (typeof releaseManaged !== 'function') throw failure('LIVE_SWAP_MANAGED_LOCK');
      await this.managed.assertHeld();
      return await action();
    } catch (error) {
      if (this.state?.phase === 'freeze-intent' && ['LIVE_SWAP_BUSY', 'LIVE_SWAP_DRAIN_TIMEOUT'].includes(error.code)) {
        try { return await this.deferBusy(error.code); } catch { /* Uncertain defer stays frozen below. */ }
      }
      // Freeze is independent of journal writes. A failed/corrupt disk must
      // never make ingress usable. Watchdog pause remains set on all errors.
      if (this.mustFreeze) await this.frontDoor.freeze().catch(() => {});
      if (releaseManaged && this.mustFreeze) await this.managed.pause().catch(() => {});
      if (this.state) await this.phase('recovery-required', { failure: error.code ?? 'LIVE_SWAP_FAILED' }).catch(() => {});
      throw error;
    } finally { try { await releaseManaged?.(); } finally { await releaseOperation(); } }
  }
  async swap() {
    return this.transact(async () => {
      await this.budgetAdmission(); this.mustFreeze = true;
      const previous = await this.journal.read({ optional: true });
      if (previous && !terminal.has(previous.phase)) throw failure('LIVE_SWAP_RECOVERY_REQUIRED');
      const canonical = await realpath(this.dataDir);
      if (previous && previous.dataDir !== canonical) throw failure('LIVE_SWAP_RECOVERY_IDENTITY');
      this.state = { transaction: randomUUID(), old: structuredClone(this.old.identity), next: structuredClone(this.next.identity), dataDir: canonical, preferred: 'old', revisionFloor: knownFloor(previous) };
      await this.managed.pause();
      await this.phase('prepared');
      const oldHealth = await this.verify(this.old, false);
      const observedFloor = { revision: oldHealth.revision, schemaVersion: oldHealth.saveSchemaVersion };
      assertFloor(observedFloor, this.state.revisionFloor);
      await this.phase('standby-intent', { revisionFloor: knownFloor({ revisionFloor: observedFloor }) }); await this.measure('standbyMs', () => this.next.standby());
      const nextHealth = await this.verify(this.next, true);
      if (!Number.isInteger(oldHealth.saveSchemaVersion) || oldHealth.saveSchemaVersion !== nextHealth.saveSchemaVersion) throw failure('LIVE_SWAP_SCHEMA');
      await this.phase('freeze-intent'); this.freezeStarted = performance.now(); await this.measure('doorFreezeMs', () => this.frontDoor.freeze());
      const freezeOptions = { requireIdle: true };
      // Core checks its latest committed byte count atomically before freezing.
      // A pre-warm stat alone cannot bound an import accepted during warmup.
      if (this.policy.mode === 'automatic') freezeOptions.maxSaveBytes = this.policy.freezeBudgetEvidence.maxSaveBytes;
      const checkpoint = await this.measure('oldFreezeMs', () => this.old.freeze(freezeOptions));
      await this.measure('doorDrainMs', () => this.frontDoor.drain());
      assertFloor(checkpoint, knownFloor(this.state));
      if (!checkpointMatches(checkpoint, await latestCheckpoint(this.dataDir))) throw failure('LIVE_SWAP_CHECKPOINT');
      // freeze-intent already durably names both immutable versions and old
      // recovery preference. Recovery never trusts these progress checkpoints:
      // it closes verified owners and re-reads the latest authoritative save.
      await this.phase('frozen', { checkpoint }, { durable: false });
      await this.phase('release-intent', {}, { durable: false }); await this.measure('oldCloseMs', () => this.closed(this.old));
      await this.managed.assertStoreReleased(); await this.phase('released', {}, { durable: false });
      await this.phase('activate-intent', {}, { durable: false }); await this.measure('nextActivateMs', () => this.next.activate(checkpoint));
      await this.onBoundary('after-activate', structuredClone(this.state));
      await this.verify(this.next, false, checkpoint);
      if (!checkpointMatches(checkpoint, await latestCheckpoint(this.dataDir))) throw failure('LIVE_SWAP_STARTUP_WRITE');
      await this.phase('acquired', {}, { durable: false }); await this.measure('routedMs', () => this.routed(this.next, checkpoint));
      // After commit-intent recovery always selects new, even if power fails
      // between pointer replacement and the following phase record.
      await this.phase('commit-intent', { preferred: 'next' });
      await this.measure('commitMs', () => this.managed.commit(this.next.identity)); await this.onBoundary('after-commit', structuredClone(this.state)); await this.phase('committed', {}, { durable: false });
      await this.managed.unpause(); await this.measure('doorResumeMs', () => this.frontDoor.resume(this.next.identity));
      await this.onBoundary('after-resume', structuredClone(this.state));
      await this.phase('admitted', { ...await this.budgetResult(), timings: structuredClone(this.timings) }); return { ...this.state, timings: structuredClone(this.timings) };
    });
  }
  async recover() {
    return this.transact(async () => {
      this.mustFreeze = true;
      this.freezeStarted = performance.now(); await this.frontDoor.freeze(); await this.managed.pause();
      this.state = await this.journal.read();
      if (!same(this.state.old, this.old.identity) || !same(this.state.next, this.next.identity)
        || this.state.dataDir !== await realpath(this.dataDir) || !['old', 'next'].includes(this.state.preferred)) throw failure('LIVE_SWAP_RECOVERY_IDENTITY');
      // A terminal transaction may have accepted later actions. Always stop
      // verified writers, then re-read the latest save, including its receipts.
      await this.phase('recovery-stopping');
      await this.closed(this.next); await this.closed(this.old);
      await this.managed.assertStoreReleased();
      const checkpoint = await latestCheckpoint(this.dataDir);
      // ACK-only metadata can change bytes at the same gameplay revision, and
      // later accepted actions can advance it. Neither permits a known durable
      // revision/schema floor to regress. Never restore a journaled snapshot.
      assertFloor(checkpoint, knownFloor(this.state));
      await this.phase('recovery-released', { recoveryCheckpoint: checkpoint });
      const selected = this.state.preferred === 'next' ? this.next : this.old;
      await selected.activate(checkpoint); await this.verify(selected, false, checkpoint);
      await this.onBoundary('recovery-after-activate', structuredClone(this.state));
      if (!checkpointMatches(checkpoint, await latestCheckpoint(this.dataDir))) throw failure('LIVE_SWAP_RECOVERY_WRITE');
      await this.phase('recovery-acquired'); await this.routed(selected, checkpoint);
      await this.managed.commit(selected.identity); await this.onBoundary('recovery-after-commit', structuredClone(this.state)); await this.phase('recovery-committed');
      await this.managed.unpause(); await this.frontDoor.resume(selected.identity);
      await this.onBoundary('recovery-after-resume', structuredClone(this.state));
      await this.phase(this.state.preferred === 'next' ? 'admitted' : 'rolled-back', await this.budgetResult());
      return this.state;
    });
  }
}
