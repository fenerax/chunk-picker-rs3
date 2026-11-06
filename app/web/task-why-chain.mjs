import { replaceView, paintExplanationPreview } from './browser-state.mjs';
// A lazy, read-only disclosure shared by task details and Slayer assignments.
export function renderWhyChain(c, chain, { advanced = false } = {}) {
  function render(value, root = false) {
    const children = value.children ?? [];
    if (value.kind === 'group' && children.length === 1 && value.required === 1) return render(children[0], root);
    if (value.kind === 'location' && children.length === 1 && value.label === children[0].label) return render(children[0], root);
    if (value.kind === 'cut') return c.el('p', `… ${value.detail}`, 'status-detail');
    const box = c.el(root ? 'div' : 'li', undefined, 'why-chain-node');
    const content = c.el('div', undefined, 'why-chain-content');
    if (value.detail) content.append(c.el('p', value.detail, 'status-detail'));
    if (advanced && value.technical && value.technical !== value.label) content.append(c.el('p', value.technical, 'status-detail'));
    if (children.length) {
      if (children.length > 1 || value.mode === 'any' && value.required > 1) content.append(c.el('p', value.mode === 'examples' ? 'Some training methods to inspect:' : value.mode === 'any'
        ? value.required > 1 ? `Need ${value.required} of these alternatives:` : 'Either route / source:' : 'All needed:', 'status-detail'));
      const list = c.el('ul', undefined, 'why-chain-list');
      list.append(...children.map(child => render(child)));
      content.append(list);
      const disclosure = c.details(value.label, content);
      disclosure.open = root;
      box.append(disclosure);
    } else box.append(c.el('p', value.label), content);
    return box;
  }
  const node = c.el('div', undefined, 'why-chain');
  node.append(render(chain.root, true));
  return node;
}

export async function loadWhyChain(c, selector, { memberId, revision, current = () => true, result, definitions, loadFull } = {}) {
  let chain;
  if (result) chain = (await import('../tasks/why-chain.mjs')).buildWhyChain(result, definitions ?? {}, selector);
  else {
    try {
      chain = await c.api(`/api/task-why?${new URLSearchParams({ memberId, revision: String(revision), ...selector })}`);
    } catch (error) {
      if (!loadFull || !current() || !(error.code === 'TASK_WHY_UNAVAILABLE' || [400, 404, 503].includes(error.status))) throw error;
      const full = await loadFull();
      if (!current() || full.result?.memberId !== memberId || full.result?.stateRevision !== revision || full.result?.format === 'play-v1')
        throw new Error('Saved details changed. Open Why not? again.');
      chain = { ...(await import('../tasks/why-chain.mjs')).buildWhyChain(full.result, full.definitions ?? {}, selector), memberId, stateRevision: revision };
    }
    if (chain.memberId !== memberId || chain.stateRevision !== revision) throw new Error('Saved details changed. Open Why not? again.');
  }
  if (!current()) throw new Error('Saved details changed. Open Why not? again.');
  return chain;
}

export function createWhyChainDisclosure(c, selector, { memberId, revision, current = () => true, advanced = () => false, result, definitions, loadFull } = {}) {
  const body = c.el('div', undefined, 'why-chain-body');
  const disclosure = c.details('Why not?', body);
  let pending = false, loaded = false, version = 0;
  const load = async () => {
    if (loaded || pending || !current()) return;
    pending = true; const request = ++version;
    body.setAttribute('aria-busy', 'true');
    const token = c.viewCache?.token(), key = JSON.stringify([memberId, selector]);
    paintExplanationPreview(body, { cache: result ? undefined : c.viewCache, view: 'why-chain', key, revision,
      status: c.el('p', undefined, 'status-detail'), checking: 'Checking all requirements…', lastKnown: 'requirements',
      render: value => renderWhyChain(c, value, { advanced: advanced() }) });
    try {
      // Sandbox evidence belongs to its preview, never to the saved-map endpoint.
      const chain = await loadWhyChain(c, selector, { memberId, revision, current, result, definitions, loadFull });
      if (request !== version) return;
      if (!current() || c.viewCache && !c.viewCache.current(token)) { body.replaceChildren(); return; }
      if (!result && (chain.memberId !== memberId || chain.stateRevision !== revision)) throw new Error('Saved details changed. Open Why not? again.');
      if (!result) c.viewCache?.remember('why-chain', key, revision, chain);
      replaceView(body, () => body.replaceChildren(renderWhyChain(c, chain, { advanced: advanced() })));
      loaded = true;
    } catch (error) {
      if (request !== version) return;
      if (current() && (!c.viewCache || c.viewCache.current(token))) body.replaceChildren(c.el('p', error.message || 'The explanation could not be loaded.', 'error'), c.button('Retry Why not?', load));
      else body.replaceChildren();
    } finally { if (request === version) { pending = false; body.setAttribute('aria-busy', 'false'); } }
  };
  disclosure.addEventListener('toggle', () => {
    if (disclosure.open) return load();
    version++; pending = loaded = false; body.replaceChildren(); body.setAttribute('aria-busy', 'false');
  });
  return disclosure;
}
