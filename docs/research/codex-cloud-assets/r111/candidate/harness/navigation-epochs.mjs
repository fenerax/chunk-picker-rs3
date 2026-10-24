// Pure CDP identity reducer. Parent must enable Page before navigation and feed
// Page.getFrameTree.frameTree, Page.frameNavigated.frame and Network events.
// A Document request advances main epoch BEFORE recording its wire identity.
// A frame-first commit also advances; subsequent same-loader request reuses it.
// No inference from URL, missing loader, request-ID shape, or close intent.
export function createNavigationEpochs({ target, session, page, maxRequests = 8192, maxLoaders = 64, maxFrames = 64 } = {}) {
  if (![target, session].every(x => typeof x === 'string' && x) || !Number.isSafeInteger(page) || page < 0
    || ![maxRequests, maxLoaders, maxFrames].every(x => Number.isSafeInteger(x) && x > 0)) throw Error('EXPLICIT_FINITE_SCOPE_REQUIRED');
  const wires = new Map(), loaders = new Map(), childFrames = new Map();
  let main, current, epoch = 0, bootstrapped = false;
  const scope = x => { if (x?.target !== target || x.session !== session || x.page !== page) throw Error('WRONG_TARGET_SESSION_PAGE'); };
  const loader = x => { if (typeof x !== 'string' || !x) throw Error('EXPLICIT_LOADER_REQUIRED'); return x; };
  const frameId = x => { if (typeof x !== 'string' || !x) throw Error('EXPLICIT_FRAME_REQUIRED'); return x; };
  const result = (extra = {}) => ({ target, session, page, epoch, frameId: main, loaderId: current, ...extra });
  function rememberChild(id, record) { if (!childFrames.has(id) && childFrames.size >= maxFrames) throw Error('FRAME_CAP'); childFrames.set(id, record); }
  function advance(id, committed, url) {
    loader(id);
    if (loaders.has(id)) {
      if (id !== current) throw Error('OLD_MAIN_LOADER');
      const entry = loaders.get(id);
      if (committed) { if (entry.committed && entry.url !== url) throw Error('SAME_LOADER_DIFFERENT_DOCUMENT'); entry.committed = true; entry.url = url; }
      return false;
    }
    if (loaders.size >= maxLoaders) throw Error('LOADER_CAP');
    current = id; epoch++; loaders.set(id, { epoch, committed, url }); return true;
  }
  function bootstrap(x) {
    scope(x); if (bootstrapped) throw Error('DUPLICATE_BOOTSTRAP');
    const tree = x.frameTree, frame = tree?.frame;
    main = frameId(frame?.id); if (frame.parentId) throw Error('MAIN_FRAME_CANNOT_HAVE_PARENT');
    advance(frame.loaderId, true, frame.url); bootstrapped = true;
    const walk = node => { for (const child of node.childFrames ?? []) { const f = child.frame; if (f.parentId !== node.frame.id) throw Error('UNKNOWN_CHILD_PARENT'); rememberChild(frameId(f.id), { parentId: frameId(f.parentId), loaderId: loader(f.loaderId) }); walk(child); } };
    walk(tree); return result({ kind: 'bootstrap', aboutBlank: frame.url === 'about:blank' });
  }
  function ready(x) { scope(x); if (!bootstrapped) throw Error('BOOTSTRAP_REQUIRED'); }
  function frameNavigated(x) {
    ready(x); const f = x.frame; frameId(f?.id); loader(f.loaderId);
    if (f.parentId) {
      if (f.id === main || (f.parentId !== main && !childFrames.has(f.parentId))) throw Error('UNKNOWN_CHILD_PARENT');
      rememberChild(f.id, { parentId: f.parentId, loaderId: f.loaderId });
      return result({ kind: 'child-frame', childFrameId: f.id, childLoaderId: f.loaderId });
    }
    if (f.id !== main) throw Error('UNKNOWN_MAIN_FRAME');
    const prior = loaders.get(f.loaderId), duplicate = f.loaderId === current && prior?.committed === true;
    const advanced = advance(f.loaderId, true, f.url);
    return result({ kind: duplicate ? 'duplicate-frame' : 'main-frame', advanced, aboutBlank: f.url === 'about:blank' });
  }
  function request(x) {
    ready(x); const e = x.event; frameId(e?.frameId); loader(e.loaderId);
    if (typeof e.requestId !== 'string' || !e.requestId) throw Error('EXPLICIT_REQUEST_REQUIRED');
    if (e.frameId !== main) {
      const child = childFrames.get(e.frameId);
      if (!child || child.loaderId !== e.loaderId) throw Error('UNKNOWN_CHILD_DOCUMENT');
      // Child network still belongs in network ledger, but cannot contribute to
      // main task DOM lineage. Parent retains original IDs, no main epoch alias.
      const old = wires.get(e.requestId), redirect = Boolean(e.redirectResponse);
      if (redirect && (!old || old.kind !== 'child-request' || old.loaderId !== e.loaderId || old.frameId !== e.frameId)) throw Error('UNKNOWN_OR_OLD_REDIRECT');
      if (!redirect && old) throw Error('WIRE_REQUEST_REUSE');
      if (!old && wires.size >= maxRequests) throw Error('WIRE_CAP');
      const row = { target, session, page, kind: 'child-request', requestId: e.requestId, hop: redirect ? old.hop + 1 : 0, frameId: e.frameId, loaderId: e.loaderId, epoch: null, mainEpochAssociation: false };
      wires.set(e.requestId, row); return structuredClone(row);
    }
    const old = wires.get(e.requestId), redirect = Boolean(e.redirectResponse);
    if (redirect && (!old || old.loaderId !== e.loaderId || old.frameId !== e.frameId || old.epoch !== epoch)) throw Error('UNKNOWN_OR_OLD_REDIRECT');
    if (!redirect && old) throw Error('WIRE_REQUEST_REUSE');
    if (e.type === 'Document') advance(e.loaderId, false, undefined);
    else if (e.loaderId !== current) throw Error('UNKNOWN_OR_OLD_REQUEST_LOADER');
    if (!old && wires.size >= maxRequests) throw Error('WIRE_CAP');
    const row = result({ kind: 'main-request', requestId: e.requestId, hop: redirect ? old.hop + 1 : 0 });
    wires.set(e.requestId, row); return structuredClone(row);
  }
  function associateBody(x) {
    ready(x); const row = wires.get(x.requestId);
    if (!row || row.kind !== 'main-request' || x.hop !== row.hop || x.frameId !== row.frameId || x.loaderId !== row.loaderId || x.epoch !== row.epoch) throw Error('UNKNOWN_WIRE_DOCUMENT_HOP');
    if (row.epoch !== epoch || row.loaderId !== current) throw Error('OLD_BODY_EPOCH');
    return structuredClone(row);
  }
  return { bootstrap, frameNavigated, request, associateBody, snapshot: () => result({ bootstrapped, retainedRequests: wires.size, retainedLoaders: loaders.size }) };
}
