export const streamSafeKey = 'picker.stream-safe';
export const editLinkWarning = 'This link gives edit access. Anyone who sees it can change your save.';
const tokenParameter = /^(?:token|access[_-]?token|invite[_-]?token|master[_-]?token)$/i;

// Joining establishes an HttpOnly cookie and redirects to /. Only clean a leftover
// address after /api/session succeeds; API calls never authenticate from this URL.
export function nonTokenUrl(address) {
  const url = new URL(address);
  if (/(?:\/|%2f)join(?:\/|%2f)[^/?#]+/i.test(url.pathname)) url.pathname = '/';
  for (const key of [...url.searchParams.keys()]) if (tokenParameter.test(key)) url.searchParams.delete(key);
  if (/(?:\/|%2f)join(?:\/|%2f)|(?:^#|[?&])(?:token|access[_-]?token|invite[_-]?token|master[_-]?token)=/i.test(url.hash)) url.hash = '';
  return `${url.pathname}${url.search}${url.hash}`;
}

export function maskLinkText(value) {
  return String(value ?? '').replace(/(?:\/|%2f)join(?:\/|%2f)[^\s"'<>?#\\]*/gi, '/join/[hidden]')
    .replace(/([?&#](?:token|access[_-]?token|invite[_-]?token|master[_-]?token)=)[^\s&#"'<>]*/gi, '$1[hidden]');
}

export function createStreamSafe({ el, button, input, storage, location = globalThis.location, history = globalThis.history, indicator, menuButton, eventTarget = globalThis } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  let on = false, authenticated = false;
  try { on = storage?.getItem(streamSafeKey) === 'true'; } catch { /* The switch still works without storage. */ }
  const listeners = new Set();
  function cleanAddress() {
    if (!on || !authenticated || !location?.href) return;
    const clean = nonTokenUrl(location.href), url = new URL(location.href);
    if (clean !== `${url.pathname}${url.search}${url.hash}`) history?.replaceState(history.state, '', clean);
  }
  function refresh() {
    if (indicator) indicator.hidden = !on;
    menuButton?.setAttribute('aria-checked', String(on));
    cleanAddress();
  }
  function set(value) {
    on = value === true;
    try { storage?.setItem(streamSafeKey, String(on)); } catch { /* Keep the current page usable. */ }
    refresh();
    for (const listener of listeners) listener(on);
  }
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  function refreshFromStorage(fallback = String(on)) {
    let value = fallback;
    try { if (storage) value = storage.getItem(streamSafeKey); } catch { /* Use the current tab state when storage is blocked. */ }
    on = value === 'true'; refresh();
    for (const listener of listeners) listener(on);
  }
  menuButton?.setAttribute('role', 'switch');
  menuButton?.addEventListener('click', () => set(!on));
  eventTarget?.addEventListener?.('storage', event => {
    if (event.key !== streamSafeKey && event.key !== null) return;
    // Another tab's queued event may predate this tab's latest switch change.
    refreshFromStorage(event.newValue);
  });
  refresh();
  function settingsRow() {
    const row = el('div', undefined, 'rule-row setting-row settings-option');
    const copy = el('div', undefined, 'field-copy');
    const control = input('checkbox'); control.id = 'setting-stream-safe'; control.checked = on;
    control.setAttribute('role', 'switch'); control.setAttribute('aria-label', 'Stream-safe mode');
    const label = el('label', undefined, 'setting-title'); label.htmlFor = control.id; label.append(el('strong', 'Stream-safe mode'));
    const help = el('p', 'Hide private links and feedback names in this browser.', 'field-help'); help.id = 'setting-stream-safe-help';
    control.setAttribute('aria-describedby', help.id); copy.append(label, help);
    control.addEventListener('change', () => set(control.checked));
    const unsubscribe = subscribe(value => { control.checked = value; });
    row.append(copy, control); row.dispose = unsubscribe;
    return row;
  }
  return { enabled: () => on, set, subscribe, settingsRow, refreshFromStorage, safeText: value => on ? maskLinkText(value) : String(value ?? ''),
    sessionReady() { authenticated = true; cleanAddress(); } };
}

// The raw link stays in a closure while masked, never in a value, attribute or
// hidden child. A mode change remasks an already revealed link immediately.
export function createPrivateLink({ value, el, button, input, field, streamSafe, viewer = false, current = () => true }) {
  let raw = value, revealed = false;
  const node = el('div', undefined, 'private-link');
  const link = input('text'); link.readOnly = true; link.setAttribute('aria-label', field ? 'Invite link' : 'Private link');
  const controls = el('div', undefined, 'form-actions private-link-actions');
  const confirmation = el('div', undefined, 'form-stack private-link-confirmation'); confirmation.hidden = true;
  const warning = viewer ? 'Anyone who sees this link can view your save.' : editLinkWarning;
  const show = button('Show', () => { if (!current()) return; confirmation.hidden = false; show.hidden = true; cancel.focus?.(); });
  const cancel = button('Cancel', () => { confirmation.hidden = true; show.hidden = false; show.focus?.(); });
  const confirm = button('Show link', () => { if (!current()) return; revealed = true; render(); link.focus?.(); link.select?.(); });
  confirmation.append(el('p', warning, 'warning'), cancel, confirm);
  controls.append(show); node.append(field ? field('Invite link', link) : link, controls, confirmation);
  function render() {
    const masked = streamSafe?.enabled() === true && !revealed;
    link.value = masked ? '•••••••• (link hidden)' : raw;
    show.hidden = !masked; controls.hidden = !masked; confirmation.hidden = true;
  }
  const unsubscribe = streamSafe?.subscribe(() => { revealed = false; render(); });
  render();
  return { node, input: link, value: () => raw, masked: () => streamSafe?.enabled() === true && !revealed,
    clear() { raw = ''; link.value = ''; unsubscribe?.(); node.remove(); } };
}
