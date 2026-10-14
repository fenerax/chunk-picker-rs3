import { buildPartnerSupplyModel, formatPartnerSupplySummary } from './partner-supply-model.mjs';

const suppliers = request => [...new Map(request.items.flatMap(item => item.sources)
  .map(source => [source.memberId, source.memberName])).values()];
const itemLabel = item => `${item.quantity == null ? '' : `${item.quantity} × `}${item.name}`;

export function renderPartnerSupply(c, model) {
  const root = c.el('div', undefined, 'partner-supply-content');
  root.append(c.el('p', 'Supplies for your unfinished tasks that come from your partner’s chunks. Check your bank before gathering.', 'partner-supply-intro'));
  for (const member of model.members) {
    const section = c.el('section', undefined, 'partner-supply-member'); section.dataset.member = member.id;
    section.append(c.el('h2', member.name));
    if (!member.ready) section.append(c.el('p', 'Saved task details are still loading. Refresh to try again.', 'status-detail'));
    else if (!member.requests.length) section.append(c.el('p', 'No partner supplies needed for the current tasks.', 'partner-supply-note'));
    else {
      const list = c.el('ul', undefined, 'partner-supply-list');
      for (const request of member.requests) {
        const row = c.el('li', undefined, 'partner-supply-row');
        const names = suppliers(request).join(' or ');
        const choices = request.items.map(itemLabel).join(' or ');
        row.append(c.el('strong', `Ask ${names} for: ${request.choiceCount ? `choose ${request.choiceCount} of ` : ''}${choices}`));
        const needs = c.el('ul', undefined, 'partner-supply-needs');
        for (const need of request.needs) needs.append(c.el('li', `For ${need.label}${need.quantity == null ? '' : ` · ${need.quantity} needed`}${need.status === 'blocked' ? ' · other requirements remain' : ''}`));
        row.append(needs);
        const details = c.el('details', undefined, 'partner-supply-sources');
        details.append(c.el('summary', 'Where to gather'));
        const locations = c.el('ul');
        const seen = new Set();
        for (const item of request.items) for (const source of item.sources) {
          const places = [...new Set([...(source.locations ?? []), ...(source.location ? [source.location] : [])])]
            .map(id => (c.world?.chunks.get(id) ?? c.world?.areas.get(id) ?? c.world?.chunks.get(id.split('-')[0]))?.name
              ?? (c.advanced?.() ? id : null)).filter(Boolean).map(name => c.plain?.(name) ?? name);
          const text = `${source.memberName}: ${item.name} · ${c.plain?.(source.source ?? source.name ?? source.task ?? source.kind) ?? source.kind}${places.length ? ` · ${places.join(', ')}` : ''}`;
          if (!seen.has(text)) { seen.add(text); locations.append(c.el('li', text)); }
        }
        details.append(locations); row.append(details); list.append(row);
      }
      section.append(list);
    }
    root.append(section);
  }
  if (model.members.some(member => member.requests?.length)) {
    root.append(c.el('p', 'Amounts appear only when the task records them. Choices are alternatives, and the same supply may be useful for several tasks.', 'partner-supply-note partner-supply-footnote'));
  }
  return root;
}

export function createPartnerSupplyCopy(c, model, getClipboard = () => globalThis.navigator?.clipboard) {
  const root = c.el('div', undefined, 'partner-supply-copy');
  const status = c.el('output', '', 'list-copy-status'); status.setAttribute('role', 'status');
  const fallback = c.el('div', undefined, 'list-copy-fallback'); fallback.hidden = true;
  const text = c.el('textarea'); text.id = 'partner-supply-copy-text'; text.readOnly = true; text.rows = 7;
  const label = c.el('label', 'Clipboard unavailable. Copy the selected text below.'); label.htmlFor = text.id;
  const select = () => { text.focus(); text.select(); };
  const copy = c.button('Copy for Discord', async () => {
    copy.disabled = true; fallback.hidden = true; status.textContent = '';
    const summary = formatPartnerSupplySummary(model);
    try {
      const clipboard = getClipboard(); if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(summary); status.textContent = 'Copied';
    } catch { text.value = summary; fallback.hidden = false; status.textContent = 'Select text to copy'; select(); }
    finally { copy.disabled = false; }
  }, 'list-copy-button');
  copy.disabled = model.members.some(member => !member.ready);
  const actions = c.el('div', undefined, 'list-copy-actions');
  actions.append(c.button('Select all', select), c.button('Close', () => { fallback.hidden = true; copy.focus(); }));
  fallback.append(label, text, actions); root.append(copy, status, fallback); return root;
}

export function createPartnerSupplyView(c) {
  let active, sequence = 0, loading;
  const current = run => active && run === sequence && c.dialogCurrent(active.generation);
  function load(force = false) {
    if (!active || !c.dialogCurrent(active.generation)) return Promise.resolve();
    const signature = `${active.generation}:${c.state.revision}:${c.memberId}`;
    if (loading?.signature === signature) return loading.promise;
    if (!force && active.rendered === signature) return Promise.resolve();
    const run = ++sequence, revision = c.state.revision;
    active.revision = revision; active.content.setAttribute('aria-busy', 'true');
    // Remove an old copy button while the save is changing.
    active.content.replaceChildren(c.el('p', 'Loading partner supplies…', 'status-detail'));
    const promise = (async () => {
      try {
        if (c.sandbox?.active) throw new Error('Exit Sandbox to view saved partner supplies.');
        const results = new Map();
        for (const member of c.state.members) results.set(member.id, await c.ensureDuoDetails(member.id, false, false));
        if (!current(run)) return;
        if (revision !== c.state.revision) return load();
        const model = buildPartnerSupplyModel(c.state, results, c.registry);
        const toolbar = c.el('div', undefined, 'partner-supply-toolbar');
        toolbar.append(createPartnerSupplyCopy(c, model), c.button('Refresh', () => load(true)));
        if (!c.canWrite()) toolbar.append(c.el('span', 'View only', 'partner-supply-note'));
        active.content.replaceChildren(toolbar, renderPartnerSupply(c, model)); active.rendered = signature;
      } catch (error) {
        if (!current(run)) return;
        active.rendered = undefined;
        active.content.replaceChildren(c.el('p', error.code === 'TASK_RESULTS_UNAVAILABLE' ? 'Saved task details are still loading. Refresh to try again.' : 'Partner supplies could not be loaded. Refresh to try again.', 'status-detail'), c.button('Refresh partner supplies', () => load(true)));
      } finally { if (current(run)) active.content.setAttribute('aria-busy', 'false'); }
    })();
    loading = { signature, promise }; promise.finally(() => { if (loading?.promise === promise) loading = undefined; }); return promise;
  }
  async function open() {
    c.closeTopMenus?.();
    if (c.sandbox?.active) { c.openDialog('Ask your partner', c.el('p', 'Exit Sandbox to view saved partner supplies.', 'status-detail')); return; }
    const root = c.el('div', undefined, 'partner-supply-panel'), content = c.el('div'); root.append(content);
    active = { content, generation: c.openDialog('Ask your partner', root), revision: c.state.revision }; await load();
  }
  function refresh() { if (active && c.dialogCurrent(active.generation) && active.revision !== c.state.revision) void load(); }
  c.$('partner-supply-open')?.addEventListener('click', () => open().catch(c.showError));
  const view = { open, refresh }; c.partnerSupply = view; return view;
}
