import { settingDefinitions } from '../data/settings.mjs';
import { SETUP_GUIDE_PREFERENCE, SETUP_START, setupGuideDismissed, shouldOfferSetupGuide, membersNeedingStart, setupStartPools } from '../core/setup-guide.mjs';

const STEPS = Object.freeze(['roll', 'theme', 'start', 'tour']);
const THEME_LABELS = Object.freeze({ light: 'Light', dark: 'Dark', gray: 'Gray', terminal: 'Terminal', neon: 'Neon', pumpkin: 'Pumpkin', mono: 'Monochrome', winter: 'Winter', autumn: 'Autumn', voyage: 'Voyage' });
const ROLL_CHOICES = Object.freeze([
  { value: false, label: 'Roll 1', help: 'Each roll unlocks one new chunk.' },
  { value: true, label: 'Roll 1 or Roll 2', help: 'Also show Roll 2: roll two chunks and keep one.' },
]);
const TOUR = Object.freeze([
  { id: 'pick', label: 'Roll', help: 'Unlock a new chunk next to your map.' },
  { id: 'roll-two', label: 'Roll two choices', help: 'Roll two chunks, then keep one.' },
  { id: 'undo', label: 'Undo', help: 'Take back the last change.' },
  { id: 'search-open', label: 'Search', help: 'Find a chunk, task or place.' },
  { id: 'helper-open', label: 'Helper', help: 'Plan training and goals.' },
  { id: 'history-open', label: 'Info → History', help: 'See every change and undo older ones.' },
  { id: 'settings-open', label: 'More → Settings', help: 'Change these choices later and reopen this guide.' },
]);

// A short walkthrough for a new group. Every choice saves through the normal
// set-preference, set-chunk and set-starting-chunk commands, so History and Undo apply.
export function createSetupGuide(ctx) {
  const { el, button, input } = ctx;
  let root, settled = true, memberId;
  const definition = id => (ctx.settingDefinitions ?? settingDefinitions).find(item => item.id === id);
  const allowed = () => ctx.canWrite() && !ctx.sandboxActive?.();
  const member = () => ctx.state().members.find(item => item.id === memberId);
  const chunkName = id => {
    const name = ctx.world?.()?.chunks?.get(String(id))?.name, plain = name ? (ctx.plain?.(name) ?? name) : '';
    return ctx.advanced?.() ? `${plain || 'Chunk'} (${id})` : plain || `Chunk ${id}`;
  };
  const bankName = bank => ctx.advanced?.() ? `${bank.bankName ?? bank.bank ?? bank.place} (${bank.chunkId})` : bank.bankName ?? bank.bank ?? bank.place;

  ctx.dialog?.addEventListener?.('close', () => {
    // Closing the guide with × or Escape counts as skipping it. A close queued
    // by the dialog this guide replaced arrives while the guide is open.
    if (!settled && root && !ctx.isDialogOpen?.() && ctx.dialogContent?.()?.contains?.(root)) void dismiss('skipped', false);
  });

  async function savePreference(preferenceId, value) {
    if (!allowed() || ctx.preferences(memberId)[preferenceId] === value) return;
    await ctx.command({ type: 'set-preference', memberId, preferenceId, value });
  }

  async function dismiss(value, close = true) {
    settled = true;
    // Skipping a reopened guide keeps the earlier dismissal; finishing records it.
    const keep = value === 'skipped' && setupGuideDismissed(ctx.preferences(memberId));
    try { if (!keep) await savePreference(SETUP_GUIDE_PREFERENCE, value); }
    catch (error) { ctx.showError?.(error); }
    if (close) ctx.closeDialog?.();
  }

  function choice(name, label, help, checked, change) {
    const control = input('radio'); control.name = name; control.checked = checked;
    const row = el('label', undefined, 'setup-guide-choice'), copy = el('span');
    copy.append(el('strong', label)); if (help) copy.append(el('span', help, 'field-help'));
    row.append(control, copy); control.addEventListener('change', () => { if (control.checked) change(control); });
    return row;
  }

  function preferenceChoices(name, legend, preferenceId, options) {
    const group = el('fieldset', undefined, 'setup-guide-group'), status = el('p', undefined, 'setup-guide-status');
    status.setAttribute('role', 'status'); group.append(el('legend', legend));
    const current = ctx.preferences(memberId)[preferenceId];
    for (const option of options) group.append(choice(name, option.label, option.help, option.value === current, async control => {
      const controls = group.querySelectorAll?.('input') ?? [];
      for (const node of controls) node.disabled = true;
      status.textContent = 'Saving…';
      try { await savePreference(preferenceId, option.value); status.textContent = 'Saved.'; }
      catch (error) { control.checked = false; status.textContent = error.message; }
      finally { for (const node of controls) node.disabled = false; }
    }));
    group.append(status); return group;
  }

  function rollStep(body) {
    body.append(el('h3', 'How do you want to roll?'), el('p', 'Roll 1 unlocks one chunk. Roll 2 shows two chunks and you keep one. You can change this later in Settings.', 'section-intro'));
    if (!definition('roll2')) { body.append(el('p', 'This game has no roll style setting.', 'field-help')); return; }
    body.append(preferenceChoices('setup-guide-roll', 'Roll style', 'roll2', ROLL_CHOICES));
  }

  function themeStep(body) {
    body.append(el('h3', 'Pick a theme'), el('p', 'Choose the colours for your picker. Your partner keeps their own theme.', 'section-intro'));
    const theme = definition('theme');
    if (!theme?.options?.length) { body.append(el('p', 'This game has no theme setting.', 'field-help')); return; }
    body.append(preferenceChoices('setup-guide-theme', 'Theme', 'theme', theme.options.map(value => ({ value, label: THEME_LABELS[value] ?? value }))));
  }

  function startResults(body, rows) {
    const list = el('ul', undefined, 'setup-guide-starts');
    for (const row of rows) list.append(el('li', `${row.name}: ${row.place}`));
    body.append(list);
  }

  async function startStep(body, current) {
    body.append(el('h3', 'Your starting chunk'), el('p', 'Your start is always a bank. Rolling picks one from the reviewed F2P banks, with different banks for each of you where possible.', 'section-intro'));
    const state = ctx.state(), waiting = membersNeedingStart(state);
    if (!waiting.length) {
      body.append(el('p', 'Everyone already has a starting chunk.'));
      startResults(body, state.members.map(owner => ({ name: owner.name, place: chunkName(owner.preferences?.startingChunk || owner.unlocked[0]) })));
      return;
    }
    const status = el('p', 'Loading starting banks…', 'setup-guide-status'); status.setAttribute('role', 'status'); body.append(status);
    let data;
    try { data = ctx.supportsFeature?.('rsCatalogues') === false ? {} : (await ctx.api('/api/members-start')).data; }
    catch { data = {}; }
    if (!current()) return;
    const pools = setupStartPools(data, state), banks = pools[0]?.banks ?? [];
    if (!banks.length) { status.textContent = 'This game has no starting-bank list yet, so there is nothing to roll. You can skip this step.'; return; }
    status.textContent = '';
    body.append(el('p', `Rolls for: ${waiting.map(owner => owner.name).join(' and ')}.`));
    const list = el('details', undefined, 'setup-guide-banks'), names = el('ul');
    list.append(el('summary', `${banks.length} ${banks.length === 1 ? 'bank' : 'banks'} in the pool`));
    for (const bank of banks) names.append(el('li', bankName(bank)));
    list.append(names); body.append(list);
    const roll = button(waiting.length === 1 ? 'Roll a starting bank' : 'Roll starting banks', async () => {
      if (!allowed() || !current()) return;
      const latest = ctx.state(), latestPools = setupStartPools(data, latest);
      if (latestPools.map(pool => pool.memberId).join() !== pools.map(pool => pool.memberId).join()) { status.textContent = 'The maps changed. Go Back and open this step again.'; roll.disabled = true; return; }
      roll.disabled = true; status.textContent = 'Saving your start…';
      try {
        // One setup-start command rolls every waiting map on the server: one History entry, one Undo.
        const response = await ctx.command({ type: SETUP_START }, latest.revision);
        if (!current()) return;
        const saved = response?.state ?? ctx.state(), event = [...(saved.history ?? [])].reverse().find(row => row.type === SETUP_START);
        const starts = event?.command?.starts ?? [];
        if (!starts.length) throw new Error('The starts were saved, but could not be shown. Check History.');
        const shown = starts.find(start => start.memberId === memberId) ?? starts[0];
        ctx.centerOnChunk?.(shown.chunkId);
        status.textContent = 'Saved. Use Undo or History to change it.';
        startResults(body, starts.map(start => ({ name: latest.members.find(owner => owner.id === start.memberId)?.name ?? start.memberId,
          place: bankName(banks.find(bank => bank.chunkId === start.chunkId) ?? { place: start.place, chunkId: start.chunkId }) })));
      } catch (error) { if (current()) { status.textContent = error.message; roll.disabled = false; } }
    }, 'primary-action');
    body.append(roll);
  }

  function tourStep(body) {
    body.append(el('h3', 'Main buttons'));
    const list = el('dl', undefined, 'setup-guide-tour');
    for (const item of TOUR) {
      const node = ctx.control?.(item.id);
      if (ctx.control && (!node || node.hidden)) continue;
      list.append(el('dt', item.label), el('dd', item.help));
    }
    list.append(el('dt', 'The map'), el('dd', 'Click or tap a chunk to see its details and tasks.'));
    if (ctx.isPhone?.()) list.append(el('dt', 'Map, Tasks, More'), el('dd', 'On a phone, switch views with the tabs at the bottom.'));
    body.append(list, el('h3', 'Invite your partner'));
    if (ctx.isAdmin?.()) {
      body.append(el('p', 'Make a player link for them in Admin → Invite links. Each link is private: send it only to them.'));
      body.append(button('Finish and open invite links', async () => { await dismiss('finished', false); ctx.openInvites?.(); }));
    } else body.append(el('p', 'Ask whoever runs the picker to send them a player link from Admin → Invite links.'));
  }

  function render(index) {
    if (!allowed()) return;
    const step = STEPS[index], node = el('div', undefined, 'setup-guide'), body = el('div', undefined, 'setup-guide-body');
    node.dataset.step = step;
    node.append(el('p', `Step ${index + 1} of ${STEPS.length} · For ${member()?.name ?? 'you'}`, 'setup-guide-progress'), body);
    const actions = el('div', undefined, 'setup-guide-actions');
    actions.append(button('Skip setup', () => dismiss('skipped'), 'setup-guide-skip'));
    if (index > 0) actions.append(button('Back', () => render(index - 1)));
    actions.append(index < STEPS.length - 1 ? button('Next', () => render(index + 1), 'primary-action') : button('Finish', () => dismiss('finished'), 'primary-action'));
    node.append(actions);
    root = node; settled = false;
    const generation = ctx.openDialog('Setup guide', node);
    const current = () => root === node && (ctx.dialogCurrent?.(generation) ?? true);
    if (step === 'roll') rollStep(body);
    else if (step === 'theme') themeStep(body);
    else if (step === 'start') return startStep(body, current);
    else tourStep(body);
  }

  function open() {
    if (!allowed()) return;
    memberId = ctx.memberId();
    return render(0);
  }

  function offer() {
    const id = ctx.memberId();
    if (ctx.isDialogOpen?.() || !shouldOfferSetupGuide({ state: ctx.state(), canWrite: ctx.canWrite(), sandbox: ctx.sandboxActive?.(), preferences: ctx.preferences(id) })) return false;
    void open(); return true;
  }

  return { open, offer, dismissed: () => setupGuideDismissed(ctx.preferences(ctx.memberId())) };
}

// Wires the guide to the main screen: offered once startup has the save and
// session, and reopened from Settings.
export function createScreenSetupGuide(c) {
  const guide = createSetupGuide({
    el: c.el, button: c.button, input: c.input, openDialog: c.openDialog, closeDialog: c.closeDialog, dialogCurrent: c.dialogCurrent,
    isDialogOpen: () => c.$('tool-dialog').open, dialog: c.$('tool-dialog'), dialogContent: () => c.$('dialog-content'),
    command: c.command, api: c.api, state: () => c.state, memberId: () => c.memberId, preferences: c.preferences,
    canWrite: c.canWrite, sandboxActive: () => !!c.sandbox?.active, advanced: c.advanced, supportsFeature: c.supportsFeature,
    world: () => c.world, plain: c.plain, centerOnChunk: id => c.map?.centerOnChunk(id), showError: c.showError,
    control: id => c.$(id), isPhone: () => !c.$('phone-tabs')?.hidden, isAdmin: () => c.sessionAdmin,
    openInvites: () => c.$('invites-open')?.click(),
  });
  c.setupGuide = guide;
  if (c.panelContext) c.panelContext.setupGuide = guide.open;
  const start = c.start;
  c.start = async (...args) => { const result = await start(...args); guide.offer(); return result; };
}
