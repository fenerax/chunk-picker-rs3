import { normalizeMembersStartOptions, membersStartPools } from '../core/members-start.mjs';

const poolNames = { optionA: 'Any bank you can reach after F2P', optionB: 'Havenhythe' };

// This review applies to the whole group, whichever player opened Settings.
export function createMembersStart(ctx) {
  const { el, input, button } = ctx;
  function allowed() { return ctx.canWrite?.() !== false; }
  function bankLabel(place, chunkId) { return ctx.advanced?.() ? `${place} (${chunkId})` : place; }
  function check(label, checked, change, help) {
    const control = input('checkbox'); control.checked = checked;
    control.setAttribute('data-members-key', label);
    const row = el('label', undefined, 'members-start-choice'), copy = el('span');
    copy.append(el('strong', label)); if (help) copy.append(el('span', help, 'field-help'));
    row.append(control, copy); control.addEventListener('change', () => change(control.checked));
    return row;
  }
  function radio(label, value, selected, change, name) {
    const control = input('radio'); control.name = name; control.value = value; control.checked = value === selected;
    control.setAttribute('data-members-key', `${name}-${value}`);
    const row = el('label', undefined, 'members-start-choice'); row.append(control, el('strong', label));
    control.addEventListener('change', () => { if (control.checked) change(value); }); return row;
  }
  function group(title) { const node = el('fieldset', undefined, 'members-start-group'); node.append(el('legend', title)); return node; }
  function summary(state) {
    const node = el('section', undefined, 'members-start-summary');
    node.append(el('h3', 'What changes for everyone'), el('p', 'Each player gets one starting bank chunk and a new starting flag. Their previous F2P map is kept as a read-only snapshot.'));
    const list = el('ul');
    for (const member of state.members) list.append(el('li', `${member.name}: replace ${member.unlocked.length} unlocked chunks; clear ${member.selected.length} chunks added to the roll pool by hand and ${member.pendingRoll.length} pending roll choices.`));
    node.append(list, el('p', 'Keep skills and XP, quests and achievements, completed tasks, equipment, notes and journal, backlogs, custom tasks, RuneMetrics name, stickers, never-roll list, travel and transport settings, access overrides, Slayer lock and other preferences. Starting sections open for the new chunk.'));
    return node;
  }
  function preview(data, state, options) {
    const pools = membersStartPools(data, state.members, options), node = el('section', undefined, 'members-start-preview');
    node.setAttribute('aria-live', 'polite'); node.append(el('h3', 'Eligible starting banks'));
    for (const pool of pools) {
      const name = state.members.find(member => member.id === pool.memberId)?.name ?? pool.memberId;
      const disclosure = el('details'), banks = el('ul', undefined, 'members-start-banks');
      disclosure.append(el('summary', `${name}: ${pool.banks.length} ${pool.banks.length === 1 ? 'bank' : 'banks'}`));
      for (const bank of pool.banks) { const row = el('li'); row.append(el('strong', bankLabel(bank.place, bank.chunkId)), el('p', bank.requirementsNote, 'field-help')); banks.append(row); }
      disclosure.append(banks); node.append(disclosure);
    }
    return { node, pools, single: new Set(pools.flatMap(pool => pool.banks.map(bank => bank.chunkId))).size === 1 };
  }
  function choices(data, options) {
    if (!allowed()) return;
    const dialog = ctx.$?.('tool-dialog'), body = ctx.$?.('dialog-content');
    const focusKey = dialog?.querySelector?.(':focus')?.getAttribute('data-members-key');
    const scrollTop = body?.scrollTop ?? 0, dialogTop = dialog?.scrollTop ?? 0;
    const state = ctx.state(), content = el('div', undefined, 'members-start');
    content.append(el('p', 'Choose a starting-bank pool for the whole group. Review the reset before any maps change.', 'section-intro'), summary(state));
    const pool = group('Starting-bank pool');
    for (const [value, label] of Object.entries(poolNames)) {
      const sizes = membersStartPools(data, state.members, { ...options, pool: value });
      const count = sizes[0].banks.length, sameSize = sizes.every(row => row.banks.length === count);
      const sizeText = sameSize ? `${count} ${count === 1 ? 'bank' : 'banks'} for each player`
        : sizes.map(row => `${state.members.find(member => member.id === row.memberId).name}: ${row.banks.length} ${row.banks.length === 1 ? 'bank' : 'banks'}`).join('; ');
      pool.append(radio(label, value, options.pool, value => choices(data, { ...options, pool: value }), 'members-start-pool'), el('p', sizeText, 'field-help members-start-pool-size'));
    }
    content.append(pool);
    if (options.pool === 'optionA') {
      const extra = group('Optional banks');
      extra.append(check('Include conditional banks', options.includeConditional, value => choices(data, { ...options, includeConditional: value }), 'By checking this, you confirm every listed requirement, payment and access route for every player. Open the bank list below to review the requirements.'), check('Include F2P banks', options.includeF2P, value => choices(data, { ...options, includeF2P: value }), 'Add the researched F2P bank chunks to the pool.'));
      content.append(extra);
    } else {
      const trader = group('Trader Woes completed');
      trader.append(el('p', 'Wendlewick is available after Visions of Havenhythe. Add Dalia’s Tree Nursery only for players who have completed Trader Woes.', 'field-help'));
      for (const member of state.members) trader.append(check(`${member.name}: I have done Trader Woes`, options.traderWoes?.[member.id] === true, value => choices(data, { ...options, traderWoes: { ...options.traderWoes, [member.id]: value } })));
      content.append(trader, el('p', 'Havenhythe progression has unverified island-only training gaps, including Construction 20–30 and Slayer 5–28. Settle your progression and supply rules before rolling.', 'field-help'));
    }
    const currentOptions = normalizeMembersStartOptions(options, state.members.map(member => member.id)), banks = preview(data, state, currentOptions);
    content.append(banks.node);
    if (state.members.length > 1 && !banks.single) {
      const pairing = group('How to roll for the group');
      pairing.append(radio('Different banks', 'different', options.pairing, value => choices(data, { ...options, pairing: value }), 'members-start-pairing'), radio('Fully random (you might share one)', 'independent', options.pairing, value => choices(data, { ...options, pairing: value }), 'members-start-pairing')); content.append(pairing);
    } else if (banks.single) content.append(el('p', `${state.members.length === 2 ? 'Both players' : 'All players'} start at Wendlewick. There is only one eligible bank.`, 'members-start-notice'));
    content.append(check('Switch the group to members rules', options.switchToMembers, value => choices(data, { ...options, switchToMembers: value }), 'Turn off the group’s F2P-only restriction. Other house rules stay as they are.'));
    const actions = el('div', undefined, 'members-start-actions');
    const review = button('Review members start', () => confirm(data, currentOptions), 'primary'); review.disabled = banks.pools.some(pool => !pool.banks.length);
    actions.append(button('Cancel', () => ctx.closeDialog()), review); content.append(actions); ctx.openDialog('Ready for members', content);
    if (body) body.scrollTop = scrollTop;
    if (dialog) {
      dialog.scrollTop = dialogTop;
      if (focusKey) [...dialog.querySelectorAll('[data-members-key]')].find(control => control.getAttribute('data-members-key') === focusKey)?.focus({ preventScroll: true });
    }
  }
  function confirm(data, options) {
    if (!allowed()) return;
    const state = ctx.state(), revision = state.revision, content = el('div', undefined, 'members-start');
    content.append(el('p', 'Review the members start for the whole group.', 'section-intro'), summary(state), el('p', `Pool: ${poolNames[options.pool]}. ${options.pairing === 'different' ? 'Different banks where possible.' : 'Independent random rolls; players may share a bank.'} ${options.switchToMembers ? 'Members rules will be enabled.' : 'The current F2P-only rule will be kept.'}`), preview(data, state, options).node);
    content.append(el('p', 'A full backup named “Before going members” is saved first. One Undo in History restores this change.'));
    const typed = input('text'); typed.autocomplete = 'off'; typed.spellcheck = false;
    const label = el('label', 'Type members to confirm resetting everyone’s maps', 'members-start-confirm'); label.append(typed); content.append(label);
    const status = el('p', undefined, 'members-start-status'); status.setAttribute('role', 'status');
    let generation, saving = false;
    const current = () => allowed() && (ctx.dialogCurrent?.(generation) ?? true);
    const back = button('Back', () => choices(data, options));
    const apply = button('Reset group maps and roll starting banks', async () => {
      if (saving || !current() || typed.value.trim().toLowerCase() !== 'members') return;
      if (ctx.state().revision !== revision) { status.textContent = 'The saved maps changed. Go Back and review the latest maps before starting.'; apply.disabled = true; return; }
      saving = true; apply.disabled = true; back.disabled = true; typed.disabled = true; status.textContent = 'Saving members starts…';
      try {
        const response = await ctx.command({ type: 'go-members', options }, revision, undefined, () => current() && ctx.state().revision === revision);
        if (!current()) return;
        const saved = response.state ?? ctx.state(), event = [...(saved.history ?? [])].reverse().find(event => event.type === 'go-members');
        const starts = event?.command?.starts ?? [];
        const shownStart = starts.find(start => start.memberId === ctx.memberId?.()) ?? starts[0];
        if (shownStart) ctx.centerOnChunk?.(shownStart.chunkId);
        const result = el('div', undefined, 'members-start'); result.append(el('p', 'Your members starts are saved.', 'section-intro'));
        const list = el('ul', undefined, 'members-start-results');
        for (const member of saved.members) { const start = starts.find(row => row.memberId === member.id), chunkId = start?.chunkId ?? member.preferences?.startingChunk ?? member.unlocked[0]; const bank = membersStartPools(data, state.members, options).find(pool => pool.memberId === member.id)?.banks.find(bank => bank.chunkId === chunkId); list.append(el('li', `${member.name}: ${bankLabel(start?.place ?? bank?.place ?? 'starting bank', chunkId)}`)); }
        result.append(list, el('p', 'Your previous F2P maps are kept as read-only snapshots. Use Undo in History to reverse this group start.'), button('Done', () => ctx.closeDialog(), 'primary')); ctx.openDialog('Members starts', result);
      } catch (error) { if (current()) { status.textContent = `${error.reviewAbandoned ? 'The saved maps changed while this review was waiting.' : error.message} Go Back and review again.`; back.disabled = false; } }
    }, 'primary');
    apply.disabled = true; typed.addEventListener('input', () => { apply.disabled = saving || typed.value.trim().toLowerCase() !== 'members'; });
    const actions = el('div', undefined, 'members-start-actions'); actions.append(back, apply); content.append(status, actions); generation = ctx.openDialog('Confirm members start', content); typed.focus?.();
  }
  async function open() {
    if (!allowed()) return;
    if (ctx.state()?.members?.length !== 2) { ctx.openDialog('Ready for members', el('p', 'Ready for members requires both players in the group. Restore the group’s player maps before starting.')); return; }
    const content = el('div', undefined, 'members-start'), loading = el('p', 'Loading starting banks…'); loading.setAttribute('role', 'status'); content.append(loading);
    const generation = ctx.openDialog('Ready for members', content);
    try { const response = await ctx.api('/api/members-start'); if (!allowed() || !(ctx.dialogCurrent?.(generation) ?? true)) return; choices(response.data, normalizeMembersStartOptions({ pool: 'optionA', pairing: 'different', switchToMembers: true }, ctx.state().members.map(member => member.id))); }
    catch (error) { if (ctx.dialogCurrent?.(generation) ?? true) { loading.textContent = `Starting banks could not load. ${error.message}`; content.append(button('Try again', open)); } }
  }
  return { open };
}
