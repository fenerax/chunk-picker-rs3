// Sections are loaded on demand; closing Helper releases their data and requests.
export const helperSections = Object.freeze([
  { id: 'training', label: 'Grind planner', module: './helper-training.mjs', render: 'renderTraining' },
  { id: 'goals', label: 'Our chunk goals', module: './helper-goals.mjs', render: 'renderGoals' },
  { id: 'drops', label: 'Drop chances', module: './helper-drops.mjs', render: 'renderDrops' },
  { id: 'utilities', label: 'XP & combat', module: './helper-utilities.mjs', render: 'renderUtilities' },
  { id: 'progress', label: 'Progress', module: './helper-progress.mjs', render: 'renderProgress' },
]);
export function createHelperView({ api, getState, getMemberId, getResult, getPreferences = () => ({}), canWrite = () => false, command, usage, document = globalThis.document }) {
  const launch = document.getElementById('helper-open'); if (!launch) return;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  let page, host, selector, nav, active = 'training', owner, generation = 0, dispose, timer, scope, lastResult, requestedTarget, renderedKey, countedSection;
  const drafts = new Map();
  const picker = document.querySelector('.workspace');
  const currentMember = () => getState()?.members.find(member => member.id === owner);
  const matchingResult = () => { const result = getResult(owner); return result?.stateRevision === getState()?.revision ? result : undefined; };
  function close() { generation++; dispose?.(); dispose = undefined; clearTimeout(timer); host?.replaceChildren(); drafts.clear(); lastResult = scope = requestedTarget = renderedKey = countedSection = undefined; if (page) page.hidden = true; picker.hidden = false; launch.setAttribute('aria-pressed', 'false'); launch.focus(); }
  async function render() {
    const request = ++generation; if (renderedKey && dispose?.getDraft) drafts.set(renderedKey, dispose.getDraft()); dispose?.(); dispose = undefined; const member = currentMember(); if (!member) return;
    if (countedSection !== active) { usage?.pageOpened(`helper:${active}`); countedSection = active; }
    scope = `${owner}:${getState().revision}`; lastResult = matchingResult();
    for (const button of nav.children) button.setAttribute('aria-current', button.dataset.section === active ? 'page' : 'false');
    host.setAttribute('aria-busy', 'true'); host.replaceChildren(el('p', 'Opening tool…', 'helper-note'));
    const section = helperSections.find(section => section.id === active);
    try {
      const module = await import(section.module); if (generation !== request || page.hidden) return;
      host.replaceChildren(); renderedKey = `${owner}:${active}`; dispose = module[section.render](host, { document, api, member, command, canWrite, getState, getPreferences: () => getPreferences(member.id), advanced: canWrite() && getPreferences(member.id).advanced === true, partner: getState().members.find(other => other.id !== member.id), stateRevision: getState().revision, getResult: matchingResult, target: requestedTarget, draft: drafts.get(renderedKey),
        isCurrent: () => generation === request && !page.hidden && getState()?.revision === Number(scope.split(':').at(-1)),
        onPlan: (skill, level) => { requestedTarget = { skill, level }; active = 'training'; void render(); } });
      requestedTarget = undefined;
    } catch (error) { if (generation === request) { const retry = el('button', 'Try again'); retry.addEventListener('click', render); host.replaceChildren(el('p', `Could not open this tool. ${error.message}`, 'helper-error'), retry); } }
    finally { if (generation === request) host.setAttribute('aria-busy', 'false'); }
  }
  function watch() {
    if (page.hidden) return;
    if (getMemberId() !== owner) { owner = getMemberId(); selector.value = owner; }
    const result = matchingResult(), nextScope = `${owner}:${getState()?.revision}`;
    if (scope !== nextScope || (active === 'goals' && result !== lastResult)) void render();
    else if (result !== lastResult) { lastResult = result; dispose?.refreshResult?.(); }
    timer = setTimeout(watch, 400);
  }
  function open() {
    if (!getState()) return;
    usage?.pageOpened('dom:helper-page');
    if (!page) {
      const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = '/helper.css'; document.head.append(sheet);
      page = el('main', undefined, 'helper-page'); page.id = 'helper-page'; page.setAttribute('aria-labelledby', 'helper-title');
      const header = el('header', undefined, 'helper-header'), title = el('h1', 'RuneScape Helper'); title.id = 'helper-title'; title.tabIndex = -1;
      const back = el('button', 'Back to picker'); back.type = 'button'; back.dataset.usage = 'helper:back'; back.addEventListener('click', close);
      selector = el('select'); selector.id = 'helper-player'; const label = el('label', 'Player'); label.htmlFor = selector.id; label.append(selector);
      header.append(title, label, back); nav = el('nav', undefined, 'helper-nav'); nav.setAttribute('aria-label', 'Helper sections');
      for (const section of helperSections) { const button = el('button', section.label); button.type = 'button'; button.dataset.section = section.id; button.dataset.usage = `helper:tab:${section.id}`; button.addEventListener('click', () => { active = section.id; void render(); }); nav.append(button); }
      host = el('div', undefined, 'helper-content'); host.id = 'helper-content';
      const layout = el('div', undefined, 'helper-layout'); layout.append(nav, host); page.append(header, el('p', canWrite() ? 'F2P · Ironman · Your chunks and saved progress. Gathering estimate settings are saved for each player.' : 'F2P · Ironman · Your chunks and saved progress. Read-only view.', 'helper-context'), layout); picker.after(page);
      selector.addEventListener('change', () => { owner = selector.value; const mapSelect = document.getElementById('member'); if (mapSelect && mapSelect.value !== owner) { mapSelect.value = owner; mapSelect.dispatchEvent(new Event('change')); } void render(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && !page.hidden && !document.getElementById('tool-dialog')?.open) { event.preventDefault(); close(); } });
    }
    owner = getMemberId(); selector.replaceChildren();
    for (const member of getState().members) { const option = el('option', member.name); option.value = member.id; selector.append(option); } selector.value = owner;
    picker.hidden = true; page.hidden = false; launch.setAttribute('aria-pressed', 'true'); document.getElementById('helper-title').focus(); void render(); clearTimeout(timer); watch();
  }
  launch.addEventListener('click', () => page && !page.hidden ? close() : open()); launch.setAttribute('aria-controls', 'helper-page'); launch.setAttribute('aria-pressed', 'false');
  return { open, close };
}
