// Test-only instrumentation. Importing this module neither starts nor imports the app.
// Controller owns source/hash provenance, input ownership, independent oracle and timing.
export const MAIN_ATTACH_ANCHOR = 'screen.start().catch';
export function instrumentMainSource(source) {
  if (typeof source !== 'string' || source.split(MAIN_ATTACH_ANCHOR).length !== 2
      || source.includes('window.__r116Attach(screen)')) throw new Error('R116_MAIN_ANCHOR_NOT_UNIQUE');
  return source.replace(MAIN_ATTACH_ANCHOR, 'window.__r116Attach(screen);\n' + MAIN_ATTACH_ANCHOR);
}

// Deliberately projects DOM text/classes, never inferred task IDs or availability.
export function projectSnapshot(snapshot) {
  return {
    rows: (snapshot.pageRows ?? snapshot.rows ?? []).map(row => ({
      label: row.label, meta: row.meta, blocked: row.blocked, category: row.category,
    })),
    counts: snapshot.counts ?? { shown: snapshot.shown, matching: snapshot.matching, total: snapshot.total },
    searchValue: snapshot.searchValue, showMoreHidden: snapshot.showMoreHidden,
  };
}
export function compareProjection(snapshot, expected) {
  if (!expected || !Array.isArray(expected.rows ?? expected.pageRows)) return { matches: false, reason: 'expected-rows-missing' };
  const actualRows = snapshot.pageRows ?? snapshot.rows ?? [], wanted = expected.rows ?? expected.pageRows;
  if (actualRows.length !== wanted.length) return { matches: false, reason: 'row-count' };
  for (let i = 0; i < wanted.length; i++) {
    for (const key of ['label', 'meta', 'blocked']) {
      if (actualRows[i][key] !== wanted[i][key]) return { matches: false, reason: `row-${i}-${key}` };
    }
    if ('category' in wanted[i] && actualRows[i].category !== wanted[i].category) return { matches: false, reason: `row-${i}-category` };
  }
  for (const key of ['shown', 'matching', 'total']) {
    const value = Object.hasOwn(expected.counts ?? {}, key) ? expected.counts[key] : expected[key];
    const actual = Object.hasOwn(snapshot.counts ?? {}, key) ? snapshot.counts[key] : snapshot[key];
    if (value === undefined || actual !== value) return { matches: false, reason: `count-${key}` };
  }
  for (const key of ['searchValue', 'showMoreHidden']) {
    if (key in expected && snapshot[key] !== expected[key]) return { matches: false, reason: key };
  }
  return { matches: true, reason: null };
}

/**
 * page.addInitScript(installAdapter, {memberId, group:false, redactTokens:[]}) BEFORE navigation.
 * Route ONLY frozen /main.mjs through instrumentMainSource; controller records both hashes.
 * Browser APIs (all serializable):
 *   __r116Snap() => actual screen scope, exact shipping pane/list refs + complete pageRows.
 *   __r116OpenChunk(chunkId) => SETUP ONLY, outside any armed episode: close an open shipping
 *     tool dialog, set the existing chunkTab='contents', call existing screen.showChunk(String(id)),
 *     then return a passive snapshot. It creates no pane, tasks, filters or synthetic UI.
 *   __r116ArmOpening({token,scope,expectedByFilter}) => BEFORE native Tasks tab click;
 *     same __r116Transition(token) query. Captures nativeTasks, optional nativeExpansion
 *     summary click, actual expansionToggles, first matching initial filter DOM + two rAFs.
 *   __r116MapTaskIds(chunkId) => REFERENCE SETUP ONLY, with no pending episode. Returns
 *     {taskIds,memberId,chunkId,revision,group,methodMayRefresh:true,sourceMethod,...}.
 *     Existing mapTaskCounts.at calls source-owned refresh(); this is NOT a passive lookup.
 *   __r116ArmAll({token,scope:{memberId,chunkId,revision,group:false},expected?})
 *     => immutable contrasting-view before snapshot, before.token/preconditionToken.
 *   __r116Transition(token) => pending/correct/blocked + native, dom, frames (two rAFs).
 *   __r116Drain(at) => finite requests crossing at, unresolved IDs, proven SSE IDs.
 *   __r116Read({includeBodies:false}) => ledger/errors/transitions; true also returns PRIVATE
 *     complete bodyText for tasks/planning. Never publish this private result raw.
 * Expected: {rows:[{label,meta,blocked,category?}],counts:{shown,matching,total},
 *            searchValue?:'',showMoreHidden?:boolean}; this only gates capture. The controller
 * independently validates the frozen HTTP reference; this adapter is not the task oracle.
 * The observer wraps/calls/awaits no app loader/render/result function. Only the explicit
 * outside-episode setup helper invokes existing UI methods closeDialog/showChunk.
 */
export function installAdapter({ memberId = null, group = false, redactTokens = [] } = {}) {
  const now = () => performance.now(), copy = value => JSON.parse(JSON.stringify(value));
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value); for (const child of Object.values(value)) freeze(child);
    } return value;
  };
  const p = { version: 'r116-browser-observer-v1', installedAt: now(), attachedAt: null,
    ledger: [], bodies: [], errors: [], nativeInputs: [], filterInputs: [], mapTaskReads: [], transitions: [] };
  let c, sequence = 0, generation = 0;
  const refs = new WeakMap(), responses = new WeakMap(), transitions = new Map();
  const ref = node => {
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return null;
    if (!refs.has(node)) refs.set(node, `r116-node-${++sequence}`); return refs.get(node);
  };
  const safe = text => {
    let out = String(text ?? '');
    for (const secret of redactTokens) if (typeof secret === 'string' && secret) out = out.split(secret).join('[REDACTED]');
    return out.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/((?:token|secret|authorization|password|api[_-]?key)[=:]\s*)[^\s&#]+/gi, '$1[REDACTED]')
      .replace(/https?:\/\/[^\s]+/gi, '[URL]');
  };
  const errorName = error => /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(error?.name ?? '') ? error.name : 'UnknownError';
  const describeURL = input => {
    try {
      const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      // No credentials, fragment, arbitrary query values or headers are retained.
      // Every POST still has its exact nonsecret API route for external classification.
      const path = safe(u.pathname).replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/[REDACTED]');
      const query = {};
      for (const key of ['memberId', 'chunkId', 'revision', 'view', 'projection', 'lane', 'peerFor']) {
        if (u.searchParams.has(key)) query[key] = safe(u.searchParams.get(key));
      }
      return { path, query };
    } catch { return { path: '[invalid-url]', query: {} }; }
  };
  const visible = node => {
    if (!node || !node.isConnected || node.hidden || node.closest('[hidden]')) return false;
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  };
  const viewport = node => {
    if (!visible(node)) return false;
    const box = node.getBoundingClientRect();
    return box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  };
  const scope = () => ({ memberId: c?.memberId ?? null, revision: c?.state?.revision ?? null,
    chunkId: c?.chunkId == null ? null : String(c.chunkId), group: typeof c?.duoEnabled === 'function' ? c.duoEnabled() : null });
  const locate = () => {
    const content = document.getElementById('chunk-content');
    const panes = [...(content?.querySelectorAll('details') ?? [])].filter(node =>
      [...node.children].find(child => child.tagName === 'SUMMARY')?.textContent === 'Possible Tasks');
    const pane = panes.length === 1 ? panes[0] : null;
    const bars = [...(pane?.querySelectorAll('.task-filter-bar') ?? [])];
    const bar = bars.length === 1 ? bars[0] : null, list = bar?.nextElementSibling ?? null;
    const chips = [...(bar?.children ?? [])];
    const allChips = chips.filter(node => /^All(?:\s+\d+)?$/.test(node.textContent ?? ''));
    return { content, pane, bar, list, all: allChips.length === 1 ? allChips[0] : null,
      paneCount: panes.length, barCount: bars.length, chips };
  };
  const snapshot = window.__r116Snap = () => {
    const loc = locate(), { pane, bar, list, all } = loc;
    const paged = list?.children.length === 1 && list.firstElementChild?.classList.contains('info-list') ? list.firstElementChild : null;
    const search = paged?.children[0], counter = paged?.children[1], body = paged?.children[2], more = paged?.children[3];
    const pageRows = [...(body?.children ?? [])].filter(node => node.classList.contains('linked-task')).map(node => {
      const meta = node.querySelector('.linked-task-meta')?.textContent ?? '';
      return { label: node.querySelector('.linked-task-label')?.textContent ?? '', meta,
        category: meta.includes(' · ') ? meta.slice(0, meta.indexOf(' · ')) : null,
        blocked: node.classList.contains('is-blocked'), doableClass: node.classList.contains('is-doable'),
        inViewport: viewport(node), ref: ref(node), id: null };
    });
    const countText = counter?.textContent ?? null;
    const match = /^(\d+) shown · (\d+) matching · (\d+) total tasks$/.exec(countText ?? '');
    const counts = { shown: match ? Number(match[1]) : null, matching: match ? Number(match[2]) : null, total: match ? Number(match[3]) : null };
    const selectedFilter = loc.chips.find(node => node.getAttribute('aria-pressed') === 'true')?.textContent ?? null;
    const selectedFilterKey = ({ 'On the map': 'map', 'Highest level': 'highest', Doable: 'doable',
      Blocked: 'blocked', All: 'all', 'If unlocked': 'unlock' })[selectedFilter?.replace(/\s+\d+$/, '')] ?? null;
    const s = { at: now(), attached: !!c, ...scope(), nativeMemberValue: document.getElementById('member')?.value ?? null,
      nativeGroupChecked: document.getElementById('group-view')?.checked ?? null,
      paneSummary: pane ? [...pane.children].find(child => child.tagName === 'SUMMARY')?.textContent ?? null : null,
      paneCount: loc.paneCount, barCount: loc.barCount, paneOpen: pane?.open ?? false,
      paneVisible: !!pane?.open && visible(pane), chunkInfoHidden: document.getElementById('chunk-info')?.hidden ?? null,
      refs: { content: ref(loc.content), pane: ref(pane), bar: ref(bar), list: ref(list), all: ref(all),
        paged: ref(paged), body: ref(body), search: ref(search), more: ref(more) },
      connected: { pane: pane?.isConnected ?? false, list: list?.isConnected ?? false },
      allSelected: all?.getAttribute('aria-pressed') === 'true', allLabel: all?.textContent ?? null,
      selectedFilter, selectedFilterKey,
      chips: loc.chips.map(node => ({ ref: ref(node), text: node.textContent, selected: node.getAttribute('aria-pressed') === 'true' })),
      countText, counts, ...counts, searchValue: search?.tagName === 'INPUT' ? search.value : '',
      showMoreHidden: more?.hidden ?? null, showMoreText: more?.textContent ?? null,
      pageRows, rows: pageRows, rowIdentity: 'label/meta/blocked only; shipping DOM has no task IDs',
      renderGeneration: c?.taskRenderGeneration ?? null,
      evidence: 'DOM state and geometry; no physical paint observation' };
    // A deterministic serialization, not a cryptographic hash; controller can hash it separately.
    s.projectionFingerprint = JSON.stringify({ pageRows: pageRows.map(({ label, meta, category, blocked }) => ({ label, meta, category, blocked })), counts,
      searchValue: s.searchValue, showMoreHidden: s.showMoreHidden, allSelected: s.allSelected, selectedFilter: s.selectedFilter });
    s.paneFingerprint = JSON.stringify({ scope: scope(), refs: { pane: s.refs.pane, bar: s.refs.bar, list: s.refs.list, all: s.refs.all }, projection: s.projectionFingerprint });
    return s;
  };
  const scopeMatches = (s, expected) => ['memberId', 'revision', 'chunkId', 'group'].every(key =>
    s[key] === (key === 'chunkId' ? String(expected[key]) : expected[key]))
    && s.nativeMemberValue === expected.memberId && s.nativeGroupChecked === expected.group;
  const sameHost = (s, before) => ['content', 'pane', 'bar', 'list', 'all'].every(key => s.refs[key] === before.refs[key])
    && s.connected.pane && s.connected.list && s.paneVisible && !s.chunkInfoHidden;
  const expectedMatches = (s, expected) => {
    if (!expected) return true;
    const rows = expected.rows ?? expected.pageRows;
    if (!Array.isArray(rows) || s.pageRows.length !== rows.length) return false;
    if (!rows.every((row, index) => ['label', 'meta', 'blocked'].every(key => s.pageRows[index][key] === row[key])
      && (!('category' in row) || s.pageRows[index].category === row.category))) return false;
    if (!['shown', 'matching', 'total'].every(key => (Object.hasOwn(expected.counts ?? {}, key) ? expected.counts[key] : expected[key]) === s.counts[key])) return false;
    return ['searchValue', 'showMoreHidden'].every(key => !(key in expected) || s[key] === expected[key]);
  };
  const publicTransition = t => copy({ kind: t.kind ?? 'all', token: t.token, status: t.status, generation: t.generation,
    preconditionToken: t.preconditionToken, before: t.before, contrastNative: t.contrastNative, native: t.native, dom: t.dom, frames: t.frames,
    nativeTasks: t.nativeTasks, nativeExpansion: t.nativeExpansion, expansionToggles: t.expansionToggles,
    blockedReason: t.blockedReason, observedMutations: t.observedMutations, expectedProvided: !!(t.expected || t.expectedByFilter),
    validation: t.expected || t.expectedByFilter ? 'Capture predicate only; independent controller oracle required' : 'Scope and DOM stability only; independent controller oracle required' });
  const block = (t, reason) => { t.status = 'blocked'; t.blockedReason = reason; t.observer.disconnect(); };
  const tasksTab = content => {
    const tabs = [...(content?.querySelectorAll('[role="tab"][data-tab="tasks"]') ?? [])];
    return tabs.length === 1 ? tabs[0] : null;
  };
  window.__r116ArmOpening = ({ token, scope: requested, expectedByFilter } = {}) => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(token) || transitions.has(token)) throw new Error('R116_BAD_OR_REUSED_TOKEN');
    if (!requested || requested.group !== false || !Number.isSafeInteger(requested.revision)
        || typeof requested.memberId !== 'string' || requested.chunkId == null || !expectedByFilter
        || typeof expectedByFilter !== 'object') throw new Error('R116_BAD_OPENING_SCOPE_OR_EXPECTED');
    const before = snapshot(), content = document.getElementById('chunk-content'), tab = tasksTab(content);
    if (!c || !content || !tab || !scopeMatches(before, requested) || before.chunkInfoHidden
        || tab.getAttribute('aria-selected') === 'true' || before.paneCount !== 0) throw new Error('R116_OPENING_PRECONDITION_FAILED');
    const preconditionToken = `${token}:before:${++generation}`; before.token = preconditionToken;
    const t = { kind: 'opening', token, preconditionToken, generation, scope: freeze(copy(requested)),
      expectedByFilter: freeze(copy(expectedByFilter)), status: 'pending', before: freeze(before),
      native: null, nativeTasks: null, nativeExpansion: null, expansionToggles: [], dom: null, frames: [],
      blockedReason: null, observedMutations: 0, content, tasksTab: tab, checkingFrames: false };
    const checkHost = s => scopeMatches(s, t.scope) && s.refs.content === ref(content)
      && content.isConnected && !s.chunkInfoHidden && tasksTab(content) === tab;
    const captureFrames = () => {
      if (t.checkingFrames) return; t.checkingFrames = true;
      const frame = number => requestAnimationFrame(at => {
        if (t.status !== 'pending') return;
        const s = snapshot();
        if (!checkHost(s) || !sameHost(s, t.dom) || tab.getAttribute('aria-selected') !== 'true') return block(t, 'opening-scope-or-pane-changed-at-frame');
        if (s.projectionFingerprint !== t.dom.projectionFingerprint) return block(t, 'opening-projection-changed-at-frame');
        t.frames.push(freeze({ ...s, at, capturedAt: s.at, token, frame: number, samePaneAndList: true,
          evidence: 'requestAnimationFrame opportunity; no physical paint claim' }));
        if (number === 1) frame(2); else { t.status = 'correct'; t.observer.disconnect(); }
      });
      frame(1);
    };
    t.observer = new MutationObserver(records => {
      if (t.status !== 'pending' || !t.nativeTasks || !records.length) return;
      t.observedMutations += records.length;
      const s = snapshot();
      if (!checkHost(s)) return block(t, 'opening-scope-or-content-changed');
      if (!s.paneVisible || tab.getAttribute('aria-selected') !== 'true' || !s.selectedFilterKey) return;
      const expected = t.expectedByFilter[s.selectedFilterKey];
      if (!expected) return block(t, 'opening-selected-filter-oracle-missing');
      if (!expectedMatches(s, expected) || s.searchValue !== '') return;
      if (!t.dom) t.dom = freeze({ ...s, token, initialFilterKey: s.selectedFilterKey,
        observedChunkContentMutation: true, samePaneAndList: true, mutationRoot: ref(content),
        observedMutationCount: records.length, trigger: t.nativeExpansion ? 'native-summary-expansion' : 'native-tasks-tab',
        evidence: 'First matching shipping initial-filter projection after trusted Tasks click and observed chunk-content mutation; MutationObserver delivery bound' });
      captureFrames();
    });
    t.observer.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-selected'] });
    transitions.set(token, t); p.transitions.push(t); return publicTransition(t);
  };
  window.__r116ArmAll = ({ token, scope: requested, expected = null } = {}) => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(token) || transitions.has(token)) throw new Error('R116_BAD_OR_REUSED_TOKEN');
    if (!requested || requested.group !== false || !Number.isSafeInteger(requested.revision)
        || typeof requested.memberId !== 'string' || requested.chunkId == null) throw new Error('R116_BAD_SCOPE');
    const loc = locate(), before = snapshot(), preconditionToken = `${token}:before:${++generation}`;
    if (!c || !loc.all || !loc.list || before.paneCount !== 1 || before.barCount !== 1
        || !scopeMatches(before, requested) || !before.paneVisible || before.chunkInfoHidden
        || before.allSelected || !before.selectedFilter || before.searchValue !== '') throw new Error('R116_ALL_PRECONDITION_FAILED');
    const contrast = p.filterInputs.at(-1);
    if (!contrast?.trusted || contrast.isAllChip || !contrast.after || !scopeMatches(contrast.after, requested)
        || !sameHost(contrast.after, before) || contrast.after.paneFingerprint !== before.paneFingerprint
        || contrast.label !== before.selectedFilter) throw new Error('R116_NATIVE_CONTRAST_REQUIRED');
    before.token = preconditionToken;
    const t = { token, preconditionToken, generation, scope: freeze(copy(requested)), expected: expected ? freeze(copy(expected)) : null,
      status: 'pending', before: freeze(before), contrastNative: freeze(copy(contrast)), native: null, dom: null, frames: [], blockedReason: null,
      observedMutations: 0, loc, candidate: null, checkingFrames: false };
    const checkFrames = () => {
      if (t.status !== 'pending' || t.checkingFrames || !t.dom) return;
      t.checkingFrames = true;
      requestAnimationFrame(at => {
        if (t.status !== 'pending') return;
        const s = snapshot();
        if (!scopeMatches(s, t.scope) || !sameHost(s, t.before)) return block(t, 'scope-or-pane-changed-before-first-frame');
        if (!s.allSelected || s.projectionFingerprint !== t.dom.projectionFingerprint) return block(t, 'projection-changed-before-first-frame');
        t.frames.push(freeze({ ...s, at, capturedAt: s.at, token, frame: 1, samePaneAndList: true, evidence: 'requestAnimationFrame opportunity; no physical paint claim' }));
        requestAnimationFrame(at2 => {
          if (t.status !== 'pending') return;
          const s2 = snapshot();
          if (!scopeMatches(s2, t.scope) || !sameHost(s2, t.before)) return block(t, 'scope-or-pane-changed-before-second-frame');
          if (!s2.allSelected || s2.projectionFingerprint !== t.dom.projectionFingerprint) return block(t, 'projection-changed-before-second-frame');
          t.frames.push(freeze({ ...s2, at: at2, capturedAt: s2.at, token, frame: 2, samePaneAndList: true, evidence: 'requestAnimationFrame opportunity; no physical paint claim' }));
          t.status = 'correct'; t.observer.disconnect();
        });
      });
    };
    t.observer = new MutationObserver(records => {
      if (t.status !== 'pending' || !t.native) return;
      const own = records.filter(record => record.type === 'childList' && record.target === t.loc.list);
      if (!own.length) return;
      t.observedMutations += own.length;
      const s = snapshot();
      if (!scopeMatches(s, t.scope) || !sameHost(s, t.before)) return block(t, 'scope-or-pane-changed-at-mutation');
      if (!s.allSelected || !expectedMatches(s, t.expected) || s.searchValue !== '') return;
      if (!t.dom) t.dom = freeze({ ...s, token, observedExactListMutation: true, samePaneAndList: true,
        listMutationCount: own.length, mutationTarget: ref(t.loc.list), addedNodeRefs: own.flatMap(record => [...record.addedNodes].map(ref)),
        evidence: 'First matching exact-list childList observation after this trusted All click; MutationObserver delivery bound' });
      checkFrames();
    });
    t.observer.observe(loc.list, { childList: true });
    transitions.set(token, t); p.transitions.push(t);
    return publicTransition(t);
  };
  window.__r116Transition = token => {
    const t = transitions.get(token); if (!t) return { token, status: 'blocked', blockedReason: 'unknown-token' };
    if (t.status === 'pending') {
      const s = snapshot();
      if (t.kind === 'opening') {
        if (!scopeMatches(s, t.scope) || s.refs.content !== ref(t.content) || !t.content.isConnected
            || s.chunkInfoHidden || tasksTab(t.content) !== t.tasksTab || t.dom && !sameHost(s, t.dom)) block(t, 'opening-scope-or-pane-changed');
      } else if (!scopeMatches(s, t.scope) || !sameHost(s, t.before)) block(t, 'scope-or-pane-changed');
    }
    return publicTransition(t);
  };
  document.addEventListener('click', event => {
    const path = event.composedPath();
    const loc = locate(), chip = loc.chips.find(node => path.includes(node));
    if (event.isTrusted && chip && c) {
      const input = { trusted: true, capturedAt: now(), eventAt: event.timeStamp, label: chip.textContent,
        isAllChip: chip === loc.all, targetIsExactFilterChip: true, targetRef: ref(event.target), chipRef: ref(chip),
        preHandler: freeze(snapshot()), after: null };
      p.filterInputs.push(input);
      queueMicrotask(() => { input.after = freeze(snapshot()); freeze(input); });
    }
    for (const t of transitions.values()) {
      if (t.kind === 'opening') {
        if (t.status !== 'pending' || !event.isTrusted) continue;
        if (!t.nativeTasks && path.includes(t.tasksTab)) {
          t.observer.takeRecords();
          const s = snapshot();
          if (event.target !== t.tasksTab || !scopeMatches(s, t.scope) || s.refs.content !== ref(t.content)
              || t.tasksTab.getAttribute('aria-selected') === 'true') { block(t, 'opening-native-tasks-precondition-changed'); continue; }
          t.nativeTasks = freeze({ token: t.token, preconditionToken: t.preconditionToken, generation: t.generation,
            trusted: true, capturedAt: now(), eventAt: event.timeStamp, label: t.tasksTab.textContent,
            targetIsExactTasksTab: event.target === t.tasksTab, composedPathIncludesExactTasksTab: true,
            targetRef: ref(event.target), tasksTabRef: ref(t.tasksTab),
            composedPath: path.map(node => ({ ref: ref(node), tag: node.tagName ?? null, id: safe(node.id ?? ''), isExactTasksTab: node === t.tasksTab })),
            preHandler: freeze(s) });
          t.native = t.nativeTasks; p.nativeInputs.push(t.nativeTasks);
        } else if (t.nativeTasks && !t.nativeExpansion && loc.pane) {
          const summary = [...loc.pane.children].find(node => node.tagName === 'SUMMARY');
          if (summary && path.includes(summary) && !loc.pane.open) {
            const s = snapshot();
            if (event.target !== summary || !scopeMatches(s, t.scope) || s.refs.content !== ref(t.content)) { block(t, 'opening-native-summary-target-or-scope-changed'); continue; }
            t.nativeExpansion = freeze({ token: t.token, preconditionToken: t.preconditionToken,
              trusted: true, capturedAt: now(), eventAt: event.timeStamp, label: summary.textContent,
              targetIsExactPossibleTasksSummary: true, targetRef: ref(summary), paneRef: ref(loc.pane),
              composedPath: path.map(node => ({ ref: ref(node), tag: node.tagName ?? null, id: safe(node.id ?? ''), isExactPossibleTasksSummary: node === summary })),
              preHandler: freeze(s) });
            p.nativeInputs.push(t.nativeExpansion);
          }
        }
        continue;
      }
      if (t.status !== 'pending' || t.native || !path.includes(t.loc.all) || !event.isTrusted) continue;
      t.observer.takeRecords(); // Discard any direct-list mutations queued before this exact click.
      const s = snapshot();
      if (!scopeMatches(s, t.scope) || !sameHost(s, t.before) || s.allSelected
          || s.paneFingerprint !== t.before.paneFingerprint) { block(t, 'precondition-changed-before-native-click'); continue; }
      if (event.target !== t.loc.all) { block(t, 'native-click-target-not-exact-all-chip'); continue; }
      t.native = freeze({ token: t.token, preconditionToken: t.preconditionToken, generation: t.generation,
        trusted: event.isTrusted, capturedAt: now(), eventAt: event.timeStamp, label: t.loc.all.textContent,
        targetIsExactAllChip: event.target === t.loc.all, composedPathIncludesExactAllChip: path.includes(t.loc.all), targetRef: ref(event.target), allChipRef: ref(t.loc.all),
        composedPath: path.map(node => ({ ref: ref(node), tag: node.tagName ?? null,
          id: safe(node.id ?? ''), isExactAllChip: node === t.loc.all })), preHandler: freeze(s) });
      p.nativeInputs.push(t.native);
    }
  }, true);
  document.addEventListener('toggle', event => {
    const loc = locate();
    if (!loc.pane || event.target !== loc.pane) return;
    for (const t of transitions.values()) if (t.kind === 'opening' && t.status === 'pending' && t.nativeTasks) {
      t.expansionToggles.push(freeze({ token: t.token, capturedAt: now(), eventAt: event.timeStamp,
        trusted: event.isTrusted, open: loc.pane.open, paneRef: ref(loc.pane), summary: 'Possible Tasks',
        evidence: 'Actual details toggle event; isTrusted toggle is not proof of user input. Native clicks recorded separately.' }));
    }
  }, true);
  window.__r116Attach = context => {
    if (c && c !== context) throw new Error('R116_MULTIPLE_SCREEN_CONTEXTS');
    c = context; p.attachedAt = now(); return { attached: true, at: p.attachedAt };
  };
  window.__r116OpenChunk = chunkId => {
    if (!c || typeof c.showChunk !== 'function' || typeof c.closeDialog !== 'function') throw new Error('R116_SETUP_SCREEN_UNAVAILABLE');
    if ([...transitions.values()].some(t => t.status === 'pending')) throw new Error('R116_SETUP_DURING_ARMED_EPISODE');
    if (document.getElementById('tool-dialog')?.open) c.closeDialog();
    c.chunkTab = 'contents'; c.showChunk(String(chunkId));
    return snapshot();
  };
  window.__r116MapTaskIds = chunkId => {
    if (!c || typeof c.mapTaskCounts?.at !== 'function') throw new Error('R116_MAP_TASK_AT_UNAVAILABLE');
    if ([...transitions.values()].some(t => t.status === 'pending')) throw new Error('R116_MAP_TASK_READ_DURING_ARMED_EPISODE');
    const id = String(chunkId), before = scope(), entries = c.mapTaskCounts.at(id);
    if (!Array.isArray(entries)) throw new Error('R116_MAP_TASK_ENTRIES_NOT_ARRAY');
    const taskIds = entries.filter(entry => Array.isArray(entry.memberIds) && entry.memberIds.includes(c.memberId))
      .map(entry => entry.taskIdByMember?.[c.memberId]);
    if (taskIds.some(taskId => typeof taskId !== 'string')) throw new Error('R116_MAP_TASK_ID_MISSING');
    const record = freeze({ at: now(), ...before, chunkId: id, taskIds, entryCount: entries.length,
      sourceMethod: 'screen.mapTaskCounts.at(chunkId)', methodMayRefresh: true,
      evidence: 'Existing source-owned at() calls refresh(); reference setup only, outside armed episodes. No replacement map algorithm.' });
    p.mapTaskReads.push(record); return copy(record);
  };

  const originalFetch = window.fetch, nativeArrayBuffer = Response.prototype.arrayBuffer;
  const nativeText = Response.prototype.text, nativeJSON = Response.prototype.json, nativeClone = Response.prototype.clone;
  window.fetch = async function(input, options) {
    const url = describeURL(input), method = String(options?.method ?? (typeof input === 'object' ? input.method : null) ?? 'GET').toUpperCase();
    const entry = { id: p.ledger.length, ...url, method, started: now(), requestContext: scope(),
      requestMember: url.query.memberId ?? null, requestChunk: url.query.chunkId ?? null, requestRevision: url.query.revision ?? null,
      status: 'pending', complete: false, bodyComplete: false, sseProven: false, finished: null };
    p.ledger.push(entry);
    try {
      const response = await originalFetch.call(this, input, options);
      entry.headersAt = now(); entry.httpStatus = response.status;
      entry.sseProven = /^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
      entry.status = entry.sseProven ? 'open-sse-content-type-proven' : 'headers-only';
      responses.set(response, entry); return response;
    } catch (error) {
      entry.finished = now(); entry.status = error.name === 'AbortError' ? 'aborted' : 'fetch-failed'; entry.error = errorName(error); throw error;
    }
  };
  Response.prototype.clone = function(...args) {
    const response = nativeClone.apply(this, args), entry = responses.get(this);
    if (entry) responses.set(response, entry); return response;
  };
  const retainBody = (entry, bodyText, consumedAt, bytes) => {
    if (!['/api/chunk-planning', '/api/tasks'].includes(entry.path)) return null;
    const record = { ledgerId: entry.id, path: entry.path, query: copy(entry.query), complete: true,
      consumedAt, bodyConsumedAt: consumedAt, parsedAt: null, parseStarted: null, bytes,
      bodyText, memberId: null, chunkId: null, revision: null,
      requestContext: copy(entry.requestContext) };
    p.bodies.push(record); return record;
  };
  const finish = (entry, bytes, started) => {
    const consumedAt = now();
    if (entry) { entry.consumeStarted = started; entry.bodyConsumedAt = consumedAt; entry.consumedAt = consumedAt;
      entry.bytes = bytes; entry.bodyComplete = true; entry.complete = true; entry.finished = consumedAt; entry.status = 'body-consumed'; }
    return consumedAt;
  };
  const parsed = (entry, record, value, parseStarted, parsedAt) => {
    if (entry) { entry.parseStarted = parseStarted; entry.parsedAt = parsedAt; }
    if (record) Object.assign(record, { parseStarted, parsedAt,
      memberId: value?.memberId ?? null, chunkId: value?.chunkId == null ? null : String(value.chunkId), revision: value?.stateRevision ?? null });
  };
  const failed = (entry, error) => {
    if (entry) { entry.finished = now(); entry.status = error.name === 'AbortError' ? 'aborted' : entry.bodyComplete ? 'parse-failed' : 'body-failed'; entry.error = errorName(error); }
  };
  const retainNonJSON = (entry, bytes, consumedAt) => {
    if (!entry || !['/api/chunk-planning', '/api/tasks'].includes(entry.path)) return;
    const bodyText = new TextDecoder().decode(bytes), record = retainBody(entry, bodyText, consumedAt, bytes.byteLength), parseStarted = now();
    try { parsed(null, record, JSON.parse(bodyText), parseStarted, now()); }
    catch (error) { record.parseError = errorName(error); }
  };
  Response.prototype.arrayBuffer = async function(...args) {
    const entry = responses.get(this), started = now();
    try { const bytes = await nativeArrayBuffer.apply(this, args); const at = finish(entry, bytes.byteLength, started); retainNonJSON(entry, bytes, at); return bytes; }
    catch (error) { failed(entry, error); throw error; }
  };
  Response.prototype.text = async function(...args) {
    const entry = responses.get(this), started = now();
    if (!entry) return nativeText.apply(this, args);
    try { const bytes = await nativeArrayBuffer.call(this), at = finish(entry, bytes.byteLength, started);
      const value = new TextDecoder().decode(bytes); retainNonJSON(entry, bytes, at); return value; }
    catch (error) { failed(entry, error); throw error; }
  };
  Response.prototype.json = async function(...args) {
    const entry = responses.get(this); if (!entry) return nativeJSON.apply(this, args);
    const started = now();
    try {
      const bytes = await nativeArrayBuffer.call(this), consumedAt = finish(entry, bytes.byteLength, started);
      // Mark complete consumption before UTF-8 decode or JSON parse starts.
      const bodyText = new TextDecoder().decode(bytes), record = retainBody(entry, bodyText, consumedAt, bytes.byteLength), parseStarted = now();
      const value = JSON.parse(bodyText); parsed(entry, record, value, parseStarted, now()); return value;
    } catch (error) { failed(entry, error); throw error; }
  };
  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url, options) {
        super(url, options);
        const entry = { id: p.ledger.length, ...describeURL(url), method: 'GET', started: now(),
          requestContext: scope(), status: 'eventsource-connecting', complete: false, bodyComplete: false, sseProven: false, finished: null };
        p.ledger.push(entry);
        this.addEventListener('open', () => { entry.sseProven = true; entry.headersAt = now(); entry.status = 'open-sse-browser-mime-validated'; });
        this.addEventListener('error', () => { if (this.readyState === NativeEventSource.CLOSED) { entry.finished = now(); entry.status = 'eventsource-closed'; } });
        const close = this.close;
        this.close = () => { close.call(this); entry.finished = now(); entry.status = 'eventsource-closed'; };
      }
    };
  }
  window.__r116Drain = at => {
    if (!Number.isFinite(at)) throw new Error('R116_DRAIN_TIME_REQUIRED');
    const crossing = p.ledger.filter(entry => entry.started <= at && (entry.finished === null || entry.finished >= at));
    const finite = crossing.filter(entry => !entry.sseProven), unresolved = finite.filter(entry => entry.finished === null);
    return { inputAt: at, at: now(), ids: crossing.map(entry => entry.id), provenSSE: crossing.filter(entry => entry.sseProven).map(entry => entry.id),
      unresolved: unresolved.map(entry => entry.id), drainedAt: unresolved.length ? null : Math.max(at, ...finite.map(entry => entry.finished)),
      limitation: 'Fetch consumption and browser-validated SSE only; headers-only/body streams remain unresolved. Non-fetch resources require controller network ledger.' };
  };
  window.__r116Read = ({ includeBodies = false } = {}) => ({ version: p.version, installedAt: p.installedAt, attachedAt: p.attachedAt,
    ledger: copy(p.ledger), nativeInputs: copy(p.nativeInputs), filterInputs: copy(p.filterInputs), mapTaskReads: copy(p.mapTaskReads), transitions: p.transitions.map(publicTransition), errors: copy(p.errors),
    ...(includeBodies ? { bodies: copy(p.bodies), privateBodies: true } : {}) });
  window.addEventListener('error', event => p.errors.push({ at: now(), type: 'error', name: errorName(event.error) }));
  window.addEventListener('unhandledrejection', event => p.errors.push({ at: now(), type: 'unhandledrejection', name: errorName(event.reason) }));
  // Established public UI preference keys; no request, provider, hidden calculation or startup.
  localStorage.setItem('rs3:task-view', JSON.stringify({ groupView: group, showAll: false, showBlocked: false }));
  if (memberId !== null) localStorage.setItem('duo-member', memberId);
}
