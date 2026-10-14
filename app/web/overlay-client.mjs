export function overlayOptions(location) {
  const widget = location.pathname.split('/').at(-1);
  const query = new URLSearchParams(location.search);
  const selectedWidget = ['goals', 'roll', 'count'].includes(widget) ? widget : 'goals';
  return {
    widget: selectedWidget,
    player: query.get('player') || 'duo',
    variant: query.get('variant') === 'compact' ? 'compact' : 'full',
    size: ['small', 'medium', 'large'].includes(query.get('size')) ? query.get('size') : 'medium',
    ...(selectedWidget === 'goals' ? { goals: ['group', 'both'].includes(query.get('goals')) ? query.get('goals') : 'personal' } : {}),
  };
}

export const reconnectDelay = attempts => Math.min(60000, 2000 * 2 ** Math.min(5, Math.max(0, attempts)));

// SSE comments are activity too. Keep a partial record across network chunks.
export function revisionParser(onRevision) {
  let pending = '';
  return bytes => {
    pending = (pending + bytes).replaceAll('\r\n', '\n');
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const record = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      if (!/^event: revision$/m.test(record)) continue;
      try {
        const value = JSON.parse(/^data: (.+)$/m.exec(record)?.[1]);
        if (Number.isSafeInteger(value.revision)) onRevision(value.revision);
      } catch { /* A malformed event cannot alter the current widget. */ }
    }
    if (pending.length > 8192) pending = '';
  };
}

export function renderOverlay(document, host, data) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const nodes = [el('h1', data.heading)];
  if (data.widget === 'goals') {
    if (data.groupGoals) {
      const section = el('section', undefined, 'overlay-player');
      section.append(el('h2', 'Group goals'));
      if (data.groupGoals.length) {
        const list = el('ul', undefined, 'overlay-goals');
        for (const goal of data.groupGoals) {
          const row = el('li'); row.append(el('span', goal.label));
          if (goal.players) {
            const ticks = el('p', undefined, 'overlay-goal-ticks');
            for (const player of goal.players) {
              const tick = el('span', `${player.done ? '☑' : '☐'} ${player.name}`);
              tick.setAttribute('aria-label', `${player.name}: ${player.done ? 'done' : 'not done'}`); ticks.append(tick);
            }
            row.append(ticks);
          }
          list.append(row);
        }
        section.append(list);
      } else section.append(el('p', 'No open group goals', 'overlay-empty'));
      nodes.push(section);
    }
    for (const player of data.players ?? []) {
      const section = el('section', undefined, 'overlay-player');
      section.append(el('h2', player.name));
      if (player.goals.length) {
        const list = el('ul', undefined, 'overlay-goals');
        list.append(...player.goals.map(goal => el('li', goal.label))); section.append(list);
      } else section.append(el('p', 'No pinned goals', 'overlay-empty'));
      nodes.push(section);
    }
  } else if (data.widget === 'roll') {
    if (!data.roll) nodes.push(el('p', 'No rolls yet', 'overlay-empty'));
    else {
      nodes.push(el('h2', data.roll.player));
      for (const chunk of data.roll.chunks) {
        const row = el('p', undefined, 'overlay-roll');
        row.append(el('span', chunk.name, 'overlay-roll-name'), el('span', `Chunk ${chunk.id}`, 'overlay-chunk-id')); nodes.push(row);
      }
      nodes.push(el('p', data.roll.phase === 'offered' ? 'Choose your chunk' : 'Unlocked', 'overlay-detail'));
    }
  } else if (data.widget === 'count') {
    nodes.push(el('p', `${data.unlocked.toLocaleString()} / ${data.total.toLocaleString()}`, 'overlay-count'));
  }
  host.replaceChildren(...nodes);
}

export function startOverlay({ document, location, fetch = globalThis.fetch, timers = globalThis, random = Math.random }) {
  const options = overlayOptions(location), host = document.getElementById('overlay'), status = document.getElementById('overlay-status');
  document.body.dataset.variant = options.variant; document.body.dataset.size = options.size;
  // The fragment is never sent to the server, rendered, or stored by this page.
  let key = new URLSearchParams(location.hash.slice(1)).get('key');
  let stopped = false, retry, watchdog, stream, request, attempts = 0, revision = -1, wanted = -1, loading;
  const query = new URLSearchParams({ widget: options.widget, player: options.player, variant: options.variant,
    ...(options.widget === 'goals' ? { goals: options.goals } : {}),
  }).toString();
  const stop = () => { stopped = true; key = undefined; timers.clearTimeout(retry); timers.clearTimeout(watchdog); stream?.abort(); request?.abort(); };
  const expired = () => { stop(); host.replaceChildren(); status.textContent = 'Overlay access ended. Create a new link in the picker.'; };
  const auth = () => ({ Authorization: `Bearer ${key}` });
  async function refresh(followups = 1) {
    if (stopped) return;
    if (loading) return loading;
    request = new AbortController();
    const deadline = timers.setTimeout(() => request?.abort(), 15000);
    loading = (async () => {
      try {
        const response = await fetch(`/overlay/data?${query}`, { headers: auth(), credentials: 'omit', cache: 'no-store', signal: request.signal });
        if ([401, 403].includes(response.status)) { expired(); return; }
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (!stopped) { renderOverlay(document, host, data); revision = data.revision; status.textContent = ''; }
      } finally { timers.clearTimeout(deadline); loading = undefined; request = undefined; }
    })();
    await loading;
    if (!stopped && wanted > revision) {
      if (followups) await refresh(followups - 1);
      else stream?.abort();
    }
  }
  const active = () => {
    timers.clearTimeout(watchdog);
    watchdog = timers.setTimeout(() => stream?.abort(), 50000);
  };
  async function connect() {
    if (stopped) return;
    stream = new AbortController();
    try {
      await refresh();
      if (stopped) return;
      active();
      const response = await fetch(`/overlay/events?${query}`, { headers: auth(), credentials: 'omit', cache: 'no-store', signal: stream.signal });
      if ([401, 403].includes(response.status)) { expired(); return; }
      if (!response.ok || !response.body) throw new Error('Unavailable');
      const parse = revisionParser(value => {
        wanted = Math.max(wanted, value);
        if (value > revision) void refresh().catch(() => stream?.abort());
      });
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        attempts = 0; active(); parse(decoder.decode(value, { stream: true }));
      }
    } catch { /* Keep displayed content during a short connection outage. */ }
    finally { timers.clearTimeout(watchdog); stream?.abort(); }
    if (!stopped) {
      status.textContent = 'Reconnecting…';
      const delay = reconnectDelay(attempts++) + Math.floor(random() * 500);
      retry = timers.setTimeout(() => void connect(), delay);
    }
  }
  if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    status.textContent = 'Open an overlay link created in the picker.'; stop();
  } else void connect();
  return { stop };
}

if (typeof document !== 'undefined') {
  const controller = startOverlay({ document, location: globalThis.location });
  globalThis.addEventListener('pagehide', controller.stop, { once: true });
}
