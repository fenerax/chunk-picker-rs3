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

export function createWhyChainDisclosure(c, selector, { memberId, revision, current = () => true, advanced = () => false, result, definitions } = {}) {
  const body = c.el('div', undefined, 'why-chain-body');
  const disclosure = c.details('Why not?', body);
  let pending = false, loaded = false;
  const load = async () => {
    if (loaded || pending || !current()) return;
    pending = true;
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(c.el('p', 'Checking all requirements…', 'status-detail'));
    try {
      const query = new URLSearchParams({ memberId, revision: String(revision), ...selector });
      // Sandbox evidence belongs to its preview, never to the saved-map endpoint.
      const chain = result ? (await import('../tasks/why-chain.mjs')).buildWhyChain(result, definitions ?? {}, selector)
        : await c.api(`/api/task-why?${query}`);
      if (!current()) return;
      if (!result && (chain.memberId !== memberId || chain.stateRevision !== revision)) throw new Error('Saved details changed. Open Why not? again.');
      body.replaceChildren(renderWhyChain(c, chain, { advanced: advanced() }));
      loaded = true;
    } catch (error) {
      if (current()) body.replaceChildren(c.el('p', error.message || 'The explanation could not be loaded.', 'error'), c.button('Retry Why not?', load));
    } finally { pending = false; body.setAttribute('aria-busy', 'false'); }
  };
  disclosure.addEventListener('toggle', () => { if (disclosure.open) return load(); });
  return disclosure;
}
