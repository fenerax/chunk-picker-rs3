import { randomUUID } from 'node:crypto';
import { random } from '../capacity/model.mjs';
import { pause } from '../capacity/client.mjs';
import { actionAt, stages } from './config.mjs';
import { Histogram, phaseMetrics, summarize, gates } from './metrics.mjs';
import { schedule, dispatchSchedule } from './schedule.mjs';
import { journalFor, reportPacket, observeAck } from './plugin.mjs';

const scope = client => ({ 'X-Picker-Id': client.pickerId, 'X-Character-Id': client.characterId });
function population(clients) {
  const groupFirst = [...new Map(clients.map(client => [client.group, client])).values()];
  const logins = new Map();
  for (const client of [...groupFirst, ...clients]) if (!logins.has(client.login)) logins.set(client.login, client);
  return [...logins.values()];
}
const cookies = (response, previous) => {
  const values = new Map(previous.split('; ').filter(Boolean).map(v => v.split('=')));
  for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); values.set(k, v); }
  return [...values].map(([k, v]) => `${k}=${v}`).join('; ');
};
export async function drive({ c, identity, base, control, log }) {
  const fixture = identity.fixture, clients = fixture.clients.filter(m => m.group < c.groups), rng = random(c.seed);
  // One document for each distinct login; other characters remain switch targets.
  const distinct = population(clients);
  const allDistinct = population(fixture.clients.filter(m => !fixture.groups[m.group].nearLimit && !fixture.groups[m.group].lifecycle));
  const phases = stages(c, allDistinct.length), metrics = Object.fromEntries(phases.map(p => [p.name, phaseMetrics()]));
  const isolation = [], writes = new Map(), tombstones = [], pickerTombstones = [], captures = [], restarts = [], transitions = {};
  const journals = new Map(), historyAcks = new Map(), staleKeys = [], deletedClients = [];
  const streams = new Map(), streamJobs = new Set(), seenEvents = new Map(), acknowledgements = new Map();
  let currentPhase = phases[0].name, stop = false, restarting = false, seq = 0, syncInFlight = 0, skippedSync = 0, untaggedEvents = 0;
  let productOrdinal = 0, pendingSamples = Promise.resolve(), sampling = false, lastSample, liveStreamCount = 0;
  let phaseStart = performance.now(), cgroupLimits = {}, nearLimitResult, captureResults = [];
  const pluginClients = clients.filter(m => m.key).slice(0, c['plugin-clients']);
  if (pluginClients.length < c['plugin-clients']) throw new Error('Not enough keyed synthetic characters for --plugin-clients.');
  const request = async (client, route, body, context, extra = {}) => {
    const row = metrics[context.phase], sent = performance.now(), scheduled = context.scheduledAt ?? sent;
    row.requests++;
    const accountRoute = route === '/api/characters' || route.startsWith('/auth/') || route.startsWith('/join/') || route.startsWith('/characters/');
    let response, value, status;
    try {
      response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(c['deadline-ms']),
        method: body === undefined ? 'GET' : 'POST', headers: {
          ...(extra.plugin ? { Authorization: `Bearer ${client.key}` } : { Cookie: client.cookie, ...(accountRoute ? {} : scope(client)) }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: 'https://picker.example' }),
          ...extra.headers,
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      try { value = JSON.parse(text); } catch { value = { html: true }; }
      status = response.status;
      if (status < 400 && /^\/api\/(state|session|tasks|history|pool-ranking)(?:\?|$)/.test(route) && value.pickerId && value.pickerId !== client.pickerId)
        isolation.push({ kind: 'foreign-response-picker', phase: context.phase });
      if (extra.plugin && value.player && (value.player.id !== client.memberId || ![client.name, client.runescapeName].includes(value.player.name)))
        isolation.push({ kind: 'foreign-plugin-response', phase: context.phase });
      const privateLabels = JSON.stringify(value.tasks ?? []).matchAll(/Synthetic private task (\d+)-/g);
      for (const label of privateLabels) if (Number(label[1]) !== client.group) isolation.push({ kind: 'foreign-private-task', phase: context.phase });
      if (extra.expected?.includes(status)) {
        row.intentionalRequests = (row.intentionalRequests ?? 0) + 1;
        if ([429, 503].includes(status)) row.intentionalRefusals = (row.intentionalRefusals ?? 0) + 1;
      }
      if ([429, 503].includes(status)) { row.refusals++; if (!response.headers.has('Retry-After')) row.missingRetryAfter++; }
      else if (status === 409) row.conflicts++;
      else if (status >= 400 && !extra.expected?.includes(status)) row.failures++;
      if (value.state) {
        const expected = fixture.groups.find(g => g.pickerId === client.pickerId);
        const marker = value.state.members?.find(m => m.id === expected?.members[0]?.id)?.journal;
        if (marker?.startsWith('beta-marker:') && marker !== `beta-marker:${c.seed}:${expected.index}`) isolation.push({ kind: 'foreign-response', phase: context.phase });
        const roster = new Set(expected?.members.map(m => m.id));
        if (!extra.lifecycle && expected && value.state.members?.some(m => !roster.has(m.id))) isolation.push({ kind: 'foreign-roster', phase: context.phase });
      }
      if (status >= 400 && !extra.expected?.includes(status)) throw Object.assign(new Error(`HTTP ${status}: ${value.message ?? route}`), { status });
      return { value, response };
    } catch (error) {
      if (!status) { status = error.name === 'TimeoutError' ? 'timeout' : 'network-error'; if (status === 'timeout') row.timeouts++; else row.failures++; }
      throw error;
    } finally {
      const finished = performance.now(); row.http.add(finished - sent); row.arrival.add(finished - scheduled); row.queue.add(sent - scheduled);
      const cacheClass = typeof value?.cache?.hit === 'boolean' ? value.cache.hit ? 'hit' : 'miss' : 'unreported';
      const op = `${context.action}:${route.split('?')[0]}:${cacheClass}`;
      (row.httpByOperation ??= {}); (row.httpByOperation[op] ??= new Histogram()).add(finished - scheduled);
      log({ type: 'request', phase: context.phase, action: context.action, operation: route.split('?')[0], status,
        httpMs: finished - sent, arrivalMs: finished - scheduled, dispatchDelayMs: sent - scheduled,
        cache: cacheClass });
    }
  };
  const call = async (...args) => (await request(...args)).value;
  const eventKey = (picker, revision) => `${picker}:${revision}`;
  const noteEvent = (client, id, value, receivedAt) => {
    if (value._trialOrigin && value._trialOrigin !== client.pickerId) isolation.push({ kind: 'foreign-event', event: id, phase: currentPhase });
    if (!value._trialOrigin) untaggedEvents++;
    if (id !== 'revision') return;
    const key = eventKey(client.pickerId, value.revision);
    const document = `${client.characterId}:${client.tab ?? 0}`;
    const observed = seenEvents.get(key) ?? new Map(); observed.set(document, receivedAt); seenEvents.set(key, observed);
    const ack = acknowledgements.get(key);
    if (ack && ack.receivers.includes(document)) {
      metrics[ack.phase].propagation.add(Math.max(0, receivedAt - ack.at)); acknowledgements.delete(key); seenEvents.delete(key);
    }
    // Only in-flight acknowledgements need old events. A bounded cache covers
    // events arriving before HTTP completion without growing through a soak.
    if (seenEvents.size > c['max-in-flight'] * 4) seenEvents.delete(seenEvents.keys().next().value);
  };
  const openStream = client => {
    const id = `${client.characterId}:${client.tab ?? 0}`;
    if (streams.has(id)) return;
    const controller = new AbortController(); streams.set(id, { controller, client, opened: false });
    let job;
    job = (async () => {
      let attempt = 0;
      while (!controller.signal.aborted && !stop) {
        const row = metrics[currentPhase]; let opened = false; row.streamAttempts++;
        const headerController = new AbortController(), deadline = setTimeout(() => headerController.abort(), c['deadline-ms']);
        try {
          const response = await fetch(base + '/api/events', { headers: { Cookie: client.cookie, ...scope(client) }, redirect: 'error',
            signal: AbortSignal.any([controller.signal, headerController.signal]) });
          clearTimeout(deadline);
          if (!response.ok) {
            row.streamRefused++; if ([429, 503].includes(response.status) && !response.headers.has('Retry-After')) row.missingRetryAfter++;
            await response.body?.cancel();
            await pause(Math.max(1000, Number(response.headers.get('Retry-After') ?? 1) * 1000), controller.signal); continue;
          }
          if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) throw new Error('Expected SSE.');
          opened = true; row.streamOpened++; liveStreamCount++; if (streams.get(id)?.controller === controller) streams.get(id).opened = true; attempt = 0;
          const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            pending += decoder.decode(value, { stream: true });
            if (pending.length > 65536) throw new Error('SSE frame exceeds bound.');
            let boundary;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
              const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
              const event = /^event: (.*)$/m.exec(frame)?.[1], json = /^data: (.*)$/m.exec(frame)?.[1];
              if (json) noteEvent(client, event, JSON.parse(json), performance.now());
            }
          }
        } catch {
          if (!opened && !controller.signal.aborted && !stop && !restarting) row.streamFailures++;
        }
        finally {
          clearTimeout(deadline);
          if (opened) { liveStreamCount--; if (streams.get(id)?.controller === controller) streams.get(id).opened = false; }
          if (opened && !controller.signal.aborted && !stop && !restarting) {
            metrics[currentPhase].streamEnds++; metrics[currentPhase].capacityStreamEvictions++; // Conservative upper bound.
          }
        }
        if (!controller.signal.aborted && !stop) await pause(Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + rng() * 500, controller.signal);
      }
    })().finally(() => streamJobs.delete(job)); streamJobs.add(job);
  };
  const connect = (users, tabs = 1) => {
    const population = currentPhase === 'headroom' ? allDistinct : distinct;
    const selected = population.slice(0, users);
    const logins = new Set(selected.map(m => m.login)), covered = new Set(selected.map(m => m.group));
    const eligible = currentPhase === 'headroom' ? fixture.clients.filter(m => !fixture.groups[m.group].nearLimit && !fixture.groups[m.group].lifecycle) : clients;
    for (const client of eligible) if (logins.has(client.login) && !covered.has(client.group)) { selected.push(client); covered.add(client.group); }
    const wanted = new Set(selected.flatMap(client => Array.from({ length: tabs }, (_, tab) => `${client.characterId}:${tab}`)));
    for (const [id, stream] of streams) if (!wanted.has(id)) { stream.controller.abort(); streams.delete(id); }
    for (const [key, ack] of acknowledgements) {
      ack.receivers = ack.receivers.filter(id => wanted.has(id));
      if (!ack.receivers.length) { acknowledgements.delete(key); metrics[ack.phase].unobservedAcknowledgements = (metrics[ack.phase].unobservedAcknowledgements ?? 0) + 1; }
    }
    for (const client of selected) for (let tab = 0; tab < tabs; tab++) openStream({ ...client, tab });
    return selected;
  };
  const closeStreams = () => { for (const stream of streams.values()) stream.controller.abort(); streams.clear(); };
  const command = async (client, command, revision, ctx, note) => {
    const receivers = [...streams.values()].filter(s => s.opened && s.client.pickerId === client.pickerId &&
      (s.client.characterId !== client.characterId || s.client.tab !== 0)).map(s => `${s.client.characterId}:${s.client.tab}`);
    const result = await call(client, '/api/command?view=play-v1', { expectedRevision: revision, command }, ctx);
    const at = performance.now(), next = result.state?.revision ?? result.revision;
    if (!Number.isSafeInteger(next)) throw new Error('Durable acknowledgement has no revision.');
    const revisions = historyAcks.get(client.pickerId) ?? new Set(); revisions.add(next); historyAcks.set(client.pickerId, revisions);
    metrics[ctx.phase].acknowledgement.add(at - ctx.scheduledAt);
    const proofKey = note ? `${client.pickerId}:${client.memberId}:${command.chunkId}` : client.pickerId;
    const proof = writes.get(proofKey) ?? { pickerId: client.pickerId, memberId: client.memberId, revision: 0, count: 0,
      ...(note ? { tokens: [], chunkId: command.chunkId } : {}) };
    proof.revision = Math.max(proof.revision, next); proof.count++; if (note) proof.tokens.push(Number(note.slice('beta-write-'.length)));
    writes.set(proofKey, proof);
    if (receivers.length) {
      const key = eventKey(client.pickerId, next), seen = seenEvents.get(key);
      const received = receivers.map(id => seen?.get(id)).find(at => at !== undefined);
      if (received !== undefined) { metrics[ctx.phase].propagation.add(Math.max(0, received - at)); seenEvents.delete(key); }
      else {
        const remaining = receivers.filter(id => streams.get(id)?.opened);
        if (remaining.length) acknowledgements.set(key, { phase: ctx.phase, at, receivers: remaining });
        else metrics[ctx.phase].unobservedAcknowledgements = (metrics[ctx.phase].unobservedAcknowledgements ?? 0) + 1;
      }
    }
    return result;
  };
  const task = (client, ctx, query = '') => call(client, `/api/tasks?memberId=${client.memberId}&view=play-v1${query}`, undefined, ctx);
  const state = (client, ctx) => call(client, '/api/state?view=play-v1', undefined, ctx);
  const lifecycle = async (client, ctx) => {
    const owners = clients.filter(m => fixture.groups[m.group].members[0].characterId === m.characterId && fixture.groups[m.group].size < 5);
    const owner = owners[Math.floor(rng() * owners.length)];
    if (!owner) throw new Error('No group with a vacant invitation seat.');
    const invitation = await call(owner, '/api/group-invites', {}, ctx);
    await call(owner, '/api/group-invites', { revokeId: invitation.id }, ctx);
  };
  const edit = async (client, ctx, ordinal) => {
    const snapshot = await state(client, ctx), chunkId = String(20 * 256 + 20 + ordinal % Math.min(c.chunks, 100));
    const member = snapshot.state.members.find(m => m.id === client.memberId), note = `beta-write-${ordinal}`;
    if (ordinal % 5 >= 3) {
      const list = await task(client, ctx), item = list.tasks?.[ordinal % Math.max(1, list.tasks?.length ?? 0)];
      if (!item) throw new Error('Progress edit requires a task.');
      const mutation = ordinal % 5 === 3 ? { type: 'set-task-status', memberId: client.memberId, taskId: item.id, favorite: ordinal % 2 === 0 } :
        { type: 'complete-task', memberId: client.memberId, taskId: item.id, completed: !member.completedTasks.includes(item.id) };
      await command(client, mutation, list.stateRevision, ctx); return;
    }
    await command(client, { type: 'set-note', memberId: client.memberId, chunkId, note: (member.notes?.[chunkId] ?? '') + '\n' + note }, snapshot.state.revision, ctx, note);
  };
  const expensive = async (client, ctx, ordinal) => {
    let snapshot = await state(client, ctx), op = ordinal % 10;
    if (op < 4) {
      ctx.action = 'expensive:task-miss';
      let changed = await command(client, { type: 'set-rule', ruleId: 'access.shared', value: snapshot.state.rules['access.shared'] === false }, snapshot.state.revision, ctx);
      const cell = (ordinal * 17 + client.group * 31) % c.chunks, chunkId = String((20 + Math.floor(cell / 100)) * 256 + 20 + cell % 100);
      const member = changed.state.members.find(m => m.id === client.memberId);
      if (!member.pendingRoll.includes(chunkId)) changed = await command(client, { type: 'set-chunk', memberId: client.memberId, chunkId,
        status: member.unlocked.includes(chunkId) ? 'locked' : 'unlocked' }, changed.state.revision, ctx);
      const result = await call(client, `/api/tasks?memberId=${client.memberId}`, undefined, ctx);
      ctx.action += result.cache?.hit === false ? ':miss' : result.cache?.hit === true ? ':hit' : ':unreported';
      if (result.cache?.hit !== false) throw new Error('Intended full task miss did not report a miss.');
      return;
    }
    if (!snapshot.state.members.find(m => m.id === client.memberId).unlocked.length) {
      await command(client, { type: 'set-chunk', memberId: client.memberId, chunkId: String(20 * 256 + 20), status: 'unlocked' }, snapshot.state.revision, ctx);
      snapshot = await state(client, ctx);
    }
    const pool = snapshot.pools?.[client.memberId]?.eligible ?? [], candidate = pool[ordinal % Math.max(1, pool.length)]?.id;
    if (!candidate) throw new Error('Expensive action has no eligible candidate.');
    if (op < 7) { ctx.action = 'expensive:preview'; await call(client, `/api/predict?memberId=${client.memberId}&chunkId=${candidate}`, undefined, ctx); }
    else {
      ctx.action = op < 9 ? 'expensive:roll-accept' : 'expensive:pool-undo';
      let result = await command(client, { type: 'roll', memberId: client.memberId, count: Math.min(2, pool.length) }, snapshot.state.revision, ctx);
      if (result.state.members.find(m => m.id === client.memberId).pendingRoll.length)
        result = await command(client, { type: 'pick-for-me', memberId: client.memberId }, result.state.revision, ctx);
      if (op === 9) await command(client, { type: 'undo' }, result.state.revision, ctx);
    }
  };
  let expensiveOrdinal = 0;
  const product = async (client, ctx, ordinal) => {
    if (ctx.action === 'read') {
      if (ordinal % 3 === 0) await call(client, '/api/history?limit=20', undefined, ctx);
      else if (ordinal % 3 === 1) await state(client, ctx); else await task(client, ctx);
    } else if (ctx.action === 'filter') {
      const peer = fixture.groups[client.group].members.find(m => m.id !== client.memberId);
      const snapshot = ordinal % 4 === 0 && peer ? await state(client, ctx) : null;
      const list = await task(client, ctx, snapshot ? `&lane=duo-v1&peerFor=${peer.id}&revision=${snapshot.state.revision}` : '');
      const candidates = list.tasks?.filter(task => task.id.startsWith('rs3:task:')) ?? [];
      const item = candidates[ordinal % Math.max(1, candidates.length)];
      if (item && ordinal % 3) await call(client, `/api/task-${ordinal % 2 ? 'how' : 'why'}?memberId=${client.memberId}&taskId=${encodeURIComponent(item.id)}&revision=${list.stateRevision}`, undefined, ctx);
    } else if (ctx.action === 'edit') await edit(client, ctx, ordinal);
    else if (ctx.action === 'switch') {
      const choices = clients.filter(m => m.login === client.login), selected = choices[ordinal % choices.length];
      const stable = await request(selected, `/characters/${selected.characterId}`, undefined, ctx);
      if (stable.response.status !== 303 || !stable.response.headers.get('Location')?.includes(selected.pickerId)) isolation.push({ kind: 'wrong-stable-link', phase: ctx.phase });
      ctx.action = 'switch:state-and-tasks'; await state(selected, ctx); await task(selected, ctx);
    } else if (ctx.action === 'expensive') await expensive(client, ctx, expensiveOrdinal++);
    else await lifecycle(client, ctx);
  };
  const sample = async () => {
    const at = performance.now(), phase = currentPhase, server = await control('/sample'), row = metrics[phase];
    cgroupLimits = server.tree.cgroup ?? cgroupLimits;
    row.cpuCapacity = cgroupLimits.effectiveCpuCores ?? identity.hardware.logicalCpus;
    row.memoryCapacity = cgroupLimits.effectiveMemoryBytes ?? identity.hardware.physicalRAMBytes;
    row.samples++; row.loopMaxP99Ms = Math.max(row.loopMaxP99Ms, server.eventLoopP99Ms);
    row.observedStreams = Math.max(row.observedStreams ?? 0, liveStreamCount);
    row.treeSupported &&= server.tree.supported && server.tree.availability === 'available' && cgroupLimits.version === 2;
    row.rssPeak = Math.max(row.rssPeak, server.tree.rssBytes ?? server.httpRSS); row.swapPeak = Math.max(row.swapPeak, server.tree.swapBytes ?? 0);
    if (lastSample?.phase === phase && lastSample.generation === server.generation && server.tree.cpuSeconds !== null) {
      row.cpuSeconds += Math.max(0, server.tree.cpuSeconds - lastSample.cpu); row.sampledSeconds += (at - lastSample.at) / 1000;
    }
    lastSample = { at, phase, cpu: server.tree.cpuSeconds, generation: server.generation };
    log({ type: 'sample', phase, elapsedMs: at - phaseStart, ...server,
      generator: { cpu: process.cpuUsage(), rss: process.memoryUsage().rss, liveStreams: liveStreamCount } });
    for (const event of server.admissions) {
      const key = `${phase}:${event.event}`; const aggregate = transitions[key] ??= { count: 0, maxPending: 0, wait: new Histogram(), service: new Histogram() };
      aggregate.count++; aggregate.maxPending = Math.max(aggregate.maxPending, event.pending ?? 0); aggregate.wait.add(event.waitMs); aggregate.service.add(event.serviceMs);
    }
  };
  const cohorts = phases.map(phase => (phase.name === 'headroom' ? allDistinct : distinct).slice(0, phase.users));
  const events = schedule(c, phases, cohorts, pluginClients.length);
  let active = distinct.slice(0, phases[0].users), restartPromise, lifecyclePromise, controlWork = Promise.resolve();
  const lifecycleTrial = async ctx => {
    const group = fixture.groups.find(g => g.lifecycle), owner = fixture.clients.find(m => m.characterId === group?.members[0].characterId);
    if (!owner) throw new Error('Lifecycle phase requires a group of at least three.');
    const player = fixture.clients.find(m => m.characterId === group.members.at(-1).characterId);
    const issued = await call(player, '/api/game-plugin/keys', { memberId: player.memberId, label: 'Synthetic lifecycle key' }, ctx);
    staleKeys.push({ ...player, key: issued.key });
    const review = await call(player, '/api/group-departure', undefined, ctx);
    await call(player, '/api/group-departure', { confirmed: true, requestId: randomUUID(), characterId: player.characterId, revision: review.revision }, ctx);
    const invitation = await call(owner, '/api/group-invites', {}, ctx);
    const opened = await request(player, new URL(invitation.link).pathname, undefined, ctx);
    const pending = { ...player, cookie: cookies(opened.response, player.cookie) };
    const joinReview = await call(pending, '/auth/group-invite/review', undefined, ctx);
    await call(pending, '/auth/group-invite/accept', { confirmed: true, reviewToken: joinReview.reviewToken, characterId: player.characterId }, ctx);
    const chars = await call(player, '/api/characters', undefined, ctx), joined = chars.characters.find(ch => ch.id === player.characterId);
    player.memberId = joined.placement.memberId;
    group.members = group.members.filter(m => m.characterId !== player.characterId).concat({ ...player, id: player.memberId });
    const target = fixture.clients.find(m => m.characterId === group.members[1].characterId);
    const handover = await call(owner, '/api/group-handover', { action: 'propose', confirmed: true, requestId: randomUUID(), targetCharacterId: target.characterId }, ctx);
    await call(target, '/api/group-handover', { action: 'accept', confirmed: true, id: handover.id }, ctx);
    const back = await call(target, '/api/group-handover', { action: 'propose', confirmed: true, requestId: randomUUID(), targetCharacterId: owner.characterId }, ctx);
    await call(owner, '/api/group-handover', { action: 'accept', confirmed: true, id: back.id }, ctx);
    const added = await call(owner, '/api/characters', { requestId: randomUUID() }, ctx);
    const deletion = `/api/deletion?kind=character&character=${added.character.id}&picker=${added.character.placement.pickerId}&deleteGroup=true`;
    const deleteReview = await call(owner, deletion, undefined, ctx, { headers: { 'X-Picker-Id': added.character.placement.pickerId, 'X-Character-Id': added.character.id } });
    await call(owner, deletion, { confirmed: true, finalGroupConfirmed: true, requestId: randomUUID(), reviewToken: deleteReview.reviewToken }, ctx,
      { headers: { 'X-Picker-Id': added.character.placement.pickerId, 'X-Character-Id': added.character.id } });
    tombstones.push(added.character.id);
    pickerTombstones.push(added.character.placement.pickerId);
    deletedClients.push({ ...owner, characterId: added.character.id, pickerId: added.character.placement.pickerId });
    await call({ ...owner, characterId: added.character.id, pickerId: added.character.placement.pickerId }, '/api/state', undefined, ctx, { expected: [403, 404, 410] });
    return { passed: true, leaveRejoin: 1, handovers: 2, deletedCharacters: 1, deletedGroups: 1, revokedKeys: 1 };
  };
  const started = performance.now(), generatorStart = process.cpuUsage(); phaseStart = started;
  const timer = setInterval(() => {
    if (sampling) { metrics[currentPhase].skippedSamples = (metrics[currentPhase].skippedSamples ?? 0) + 1; return; }
    sampling = true;
    pendingSamples = sample().catch(error => { metrics[currentPhase].sampleErrors = (metrics[currentPhase].sampleErrors ?? 0) + 1;
      log({ type: 'sample-error', phase: currentPhase, error: error.message }); }).finally(() => { sampling = false; });
  }, c['sample-ms']);
  try {
    await dispatchSchedule(events, async event => {
      const phase = phases[event.stage], row = metrics[phase.name], ctx = { phase: phase.name, scheduledAt: event.scheduledAt, action: event.kind };
      if (event.kind === 'phase') {
        currentPhase = phase.name; active = connect(phase.users, phase.name === 'extra-tabs' ? 2 : 1);
        row.onlineLogins = new Set(active.map(m => m.login)).size; row.documents = active.length; row.activeGroups = new Set(active.map(m => m.group)).size;
        log({ type: 'cohort', phase: phase.name, onlineLogins: row.onlineLogins, documents: row.documents, activeGroups: row.activeGroups });
        if (phase.name === 'cold' || phase.name === 'restart') {
          restarting = true; closeStreams();
          restartPromise = controlWork = controlWork.then(() => control('/restart')).then(async result => {
            if (!result.processChanged) throw new Error('Restart did not replace the HTTP process.');
            restarts.push({ phase: phase.name, generation: result.generation, processChanged: result.processChanged, runtimeSettings: result.runtimeSettings,
              scheduledArrivalToReadyMs: performance.now() - ctx.scheduledAt });
            base = new URL(base); base.port = result.port; base = base.origin;
            restarting = false; active = connect(phase.users);
            const ready = [...new Map(active.map(client => [client.group, client])).values()];
            await Promise.all(ready.map(async client => {
              const context = { ...ctx, action: 'cold:readiness' };
              try { await state(client, context); await call(client, `/api/tasks?memberId=${client.memberId}`, undefined, context); }
              catch (error) { log({ type: 'cold-readiness-error', phase: phase.name, error: error.message }); }
              finally { (row.operations['cold:readiness'] ??= new Histogram()).add(performance.now() - ctx.scheduledAt); }
            }));
            return result;
          }).catch(error => { restarting = false; throw error; });
          restartPromise.catch(() => {});
        }
        if (phase.name === 'backup') {
          const capture = controlWork = controlWork.then(() => control('/backup'));
          captures.push(capture.then(value => ({ phase: phase.name, ...value })).catch(error => ({ phase: phase.name, error: error.message })));
        }
        if (phase.name === 'lifecycle') { lifecyclePromise = controlWork = controlWork.then(() => lifecycleTrial(ctx)).catch(error => ({ passed: false, error: error.message })); }
        log({ type: 'phase', name: phase.name, users: active.length, offeredActionsPerSecond: phase.actions, pluginRequestsPerSecond: phase.plugins }); return;
      }
      row.offered++;
      const client = { ...(event.kind === 'session' ? cohorts[event.stage][event.clientIndex] : active[Math.floor(rng() * active.length)]) }, ordinal = seq++, arrival = performance.now();
      if (event.kind === 'product') ctx.action = actionAt(productOrdinal++, c.seed);
      try {
        if (event.kind === 'product') { row.actions[ctx.action] = (row.actions[ctx.action] ?? 0) + 1; await product(client, ctx, ordinal); }
        else if (event.kind === 'session') await call(client, '/api/session', undefined, ctx);
        else if (event.kind === 'isolation') {
          const foreign = clients.find(m => m.accountId !== client.accountId && m.pickerId !== client.pickerId);
          const result = await request(client, '/api/state?view=play-v1', undefined, ctx, { headers: scope(foreign), expected: [403] });
          if (result.response.status !== 403) isolation.push({ kind: 'foreign-scope-accepted', phase: ctx.phase });
        }
        else if (event.kind === 'sync') {
          if (syncInFlight >= 2) { skippedSync++; return; } syncInFlight++;
          try { await call(client, '/api/runemetrics/preview', { memberId: client.memberId }, ctx, { expected: [400, 403, 404, 413, 422, 502, 504] }); } finally { syncInFlight--; }
        } else {
          const plugin = pluginClients[event.ordinal % pluginClients.length];
          if (event.kind === 'pluginReport') {
            const journal = journals.get(plugin.characterId) ?? journalFor(plugin, c.seed);
            journals.set(plugin.characterId, journal);
            const items = journal.reports++ % 2 === 0;
            const burst = ['cold', 'restart'].includes(ctx.phase) && journal.burstPhase !== ctx.phase;
            journal.burstPhase = ctx.phase;
            for (const sendItems of burst ? [items, !items] : [items]) {
              const result = await call(plugin, '/api/plugin/v1/report', reportPacket(journal, plugin, c.seed, sendItems), ctx, { plugin: true });
              if (sendItems && observeAck(journal, result)) {
                metrics[ctx.phase].acknowledgement.add(performance.now() - ctx.scheduledAt);
              }
            }
          }
          else await call(plugin, event.kind === 'pluginStatus' ? '/api/plugin/v1/status' : '/api/plugin/v1/tasks', undefined, ctx, { plugin: true });
        }
      } catch (error) {
        if (!error.status) row.actionFailures = (row.actionFailures ?? 0) + 1;
        log({ type: 'action-error', phase: ctx.phase, action: ctx.action, status: error.status, error: error.message });
      }
      finally {
        row.completed++; const key = ctx.action === 'expensive' ? 'expensive:prerequisite' : ctx.action;
        (row.operations[key] ??= new Histogram()).add(performance.now() - event.scheduledAt);
        row.queue.add(arrival - event.scheduledAt);
      }
    }, { startAt: started, maxInFlight: c['max-in-flight'], onDrop: event => {
      const row = metrics[phases[event.stage].name]; row.offered++; row.drops++; log({ type: 'generator-drop', phase: phases[event.stage].name, kind: event.kind });
    } });
    if (restartPromise) await restartPromise;
    if (lifecyclePromise) await lifecyclePromise;
    captureResults = await Promise.all(captures);
    await pendingSamples; await sample();
    // Allow last acknowledged writes to reach already-connected observers.
    if (acknowledgements.size) await pause(Math.min(5000, c['deadline-ms']));
    closeStreams(); await Promise.allSettled(streamJobs);
    currentPhase = 'near-limit'; metrics[currentPhase] = phaseMetrics();
    const near = fixture.clients.find(m => fixture.groups[m.group].nearLimit), ctx = { phase: currentPhase, scheduledAt: performance.now(), action: 'cold:near-limit' };
    const begin = performance.now();
    for (const stale of staleKeys) {
      const value = await request(stale, '/api/plugin/v1/status', undefined, ctx, { plugin: true, expected: [401, 403] });
      if (![401, 403].includes(value.response.status)) isolation.push({ kind: 'revived-plugin-key' });
    }
    for (const deleted of deletedClients) {
      const value = await request(deleted, '/api/state', undefined, ctx, { expected: [403, 404, 410] });
      if (![403, 404, 410].includes(value.response.status)) isolation.push({ kind: 'revived-character-access' });
    }
    try { await state(near, ctx); await task(near, ctx); nearLimitResult = { passed: true, elapsedMs: performance.now() - begin }; }
    catch (error) { nearLimitResult = { passed: false, error: error.message, elapsedMs: performance.now() - begin }; }
    metrics[currentPhase].operations['cold:near-limit'] = new Histogram(); metrics[currentPhase].operations['cold:near-limit'].add(performance.now() - begin);
    await sample();
  } finally { clearInterval(timer); stop = true; closeStreams(); await Promise.allSettled(streamJobs); await pendingSamples; }
  const lifecycleResult = lifecyclePromise ? await lifecyclePromise : null;
  const audit = await control('/audit', { writes: [...writes.values()], tombstones, pickerTombstones,
    historyAcks: Object.fromEntries([...historyAcks].map(([key, value]) => [key, [...value]])), journals: [...journals.values()].map(({ pending, ...journal }) => journal) });
  const cpu = process.cpuUsage(generatorStart);
  const resultGates = gates(metrics, isolation, audit, acknowledgements.size, identity.hardware, c);
  const capturePause = new Histogram();
  for (const capture of captureResults) {
    capturePause.add(capture.heldMs); capturePause.add(capture.maxRequestWaitMs);
    for (const barrier of capture.pickerBarriers ?? []) capturePause.add(barrier.heldMs);
  }
  const pauseBudget = capturePause.json();
  resultGates.backupCapturePause = !captureResults.length ? 'unmeasured' : captureResults.some(c => c.error) || !pauseBudget.count ? 'fail' :
    pauseBudget.p95Ms <= 1000 && pauseBudget.maxMs <= 5000 ? 'pass' : 'fail';
  return { stages: phases, phaseMetrics: Object.fromEntries(Object.entries(metrics).map(([name, row]) => [name, summarize(row)])),
    gates: resultGates, audit, isolation, pendingAcknowledgementEvents: acknowledgements.size, untaggedEvents, skippedSync,
    lifecycle: lifecycleResult, nearLimit: nearLimitResult, restarts, captures: captureResults, capturePause: pauseBudget, cgroupLimits,
    admission: Object.fromEntries(Object.entries(transitions).map(([key, value]) => [key, { ...value, wait: value.wait.json(), service: value.service.json() }])),
    generator: { elapsedSeconds: (performance.now() - started) / 1000, cpuSeconds: (cpu.user + cpu.system) / 1e6, rssBytes: process.memoryUsage().rss },
    measurement: { http: 'dispatch to complete body', arrival: 'scheduled arrival to complete body, includes action prerequisite and dispatch queue',
      acknowledgement: 'scheduled action arrival to successful durable command response body',
      propagation: 'HTTP acknowledgement body to first other authorized character stream; receipt before acknowledgement is zero',
      streamEvictions: 'conservative upper bound: every unplanned established stream termination outside restart/shutdown',
      percentiles: 'conservative logarithmic histograms, 1% bucket growth for (milliseconds + 1)', browserRendering: false } };
}
