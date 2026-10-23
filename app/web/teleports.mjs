import { amountInput, parseAmount } from './amount-input.mjs';

const groups = [['lodestones', 'Lodestones'], ['spells', 'Spells'], ['items', 'Items'], ['transport', 'Transport']];
const overrideChoices = [{ value: 'auto', label: 'Automatic' }, { value: 'true', label: 'I can use it' }, { value: 'false', label: 'I can’t use it' }];
const unresolvedEndpointReasons = new Set([
  'station coordinate needs exact decoded tile evidence',
  'direct component selector requires exact decoded tile evidence',
  'station selector has unresolved or multiple components',
  'split station needs a verified section',
]);
// Translate only these known diagnostic messages; personal requirements keep
// their original wording, and the API's evidence remains untouched.
function displayReason(value) {
  if (value === 'Members only.') return 'Members only. Turn off F2P in Chunk Rules to include this route.';
  if (unresolvedEndpointReasons.has(value)) return 'Exact landing spot is not mapped yet.';
  if (value.startsWith('Lodestone activation is estimated from its reachable chunk')) return 'You can reach this lodestone to activate it.';
  if (value.startsWith('Teleport requirements and destination chunk are verified')) return 'You meet the requirements.';
  if (value === 'Consumable teleport — rule off.') return 'Uses up an item. Turn on Allow consumable teleports in Chunk Rules to count it.';
  if (value.includes('Personal requirements met from reachable supplies and game progress.')) return value.replace('Personal requirements met from reachable supplies and game progress.', 'You meet the requirements.').replace(' Levels use estimated reachable training ceilings.', '').trim();
  if (/^lodestone-[a-z0-9]+(?:-[a-z0-9]+)*-activated: confirmations requirement is unknown or not met\.$/.test(value)) return 'Lodestone activation is not confirmed. If you have activated it in-game, choose “I can use it” in Override.';
  if (value === 'wilderness-pvp-warning-accepted: confirmations requirement is unknown or not met.') return 'Wilderness PvP warning acceptance is not confirmed. Accept the warning before using this lever.';
  if (/^[a-z0-9-]+: confirmations requirement is unknown or not met\.$/.test(value)) return 'Required in-game confirmation is missing or unknown.';
  if (/^Destination or departure section .+ is blocked\.$/.test(value)) return 'The departure or destination area is blocked.';
  if (/^Section .+ is not verified F2P\.$/.test(value)) return 'The departure or destination area has not been confirmed as free-to-play.';
  if (/^[a-z0-9-]+: [a-z-]+ requirement is unknown or not met\.$/.test(value)) return 'An in-game requirement needs checking. If you meet all requirements, choose “I can use it” in Override.';
  return value;
}

// Keep the surface's styling isolated without adding another global CSS dependency.
if (globalThis.document?.head && !document.querySelector('link[data-teleports-style]')) {
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet'; sheet.href = new URL('./teleports.css', import.meta.url).href;
  sheet.dataset.teleportsStyle = ''; document.head.append(sheet);
}

/** Personal route review. No catalogue response mutates saved state. */
export function openTeleportsDialog(ctx, { uuid = () => globalThis.crypto.randomUUID() } = {}) {
  const { el, input, field, select, button } = ctx;
  const advanced = () => ctx.advanced?.() ?? ctx.preferences?.()?.advanced === true;
  const destinationLabel = (name, id) => name ? `${ctx.plain?.(name) ?? name}${advanced() ? ` · Chunk ${id}` : ''}` : `Chunk ${id}`;
  const requestedMember = ctx.memberId();
  const owner = () => ctx.state().members.find(row => row.id === requestedMember);
  if (!owner()) throw new Error('Select a player before opening Teleports.');
  const content = el('div', undefined, 'teleports-panel');
  const generation = ctx.openDialog(`${owner().name}’s Teleports`, content);
  const current = () => ctx.memberId() === requestedMember && ctx.dialogCurrent(generation);
  let request = 0, controller, saving = false;
  const controls = [];
  const customStatuses = new Map();
  let feedback, catalogue;
  const remember = node => { controls.push(node); return node; };
  const report = message => { if (current()) feedback.replaceChildren(el('p', message, 'teleports-error')); };
  const scopeValid = revision => current() && ctx.state().revision === revision;
  const guard = revision => {
    if (!scopeValid(revision)) throw new Error('The saved map or selected player changed. Refresh Teleports and review the latest availability before saving.');
  };
  async function save(payload, revision) {
    if (!current() || saving) return;
    try {
      guard(revision); saving = true;
      controls.forEach(node => { node.disabled = true; });
      await ctx.command(payload, revision, undefined, () => scopeValid(revision));
      if (current()) { saving = false; await render(); }
    } catch (error) {
      if (current()) { report(error.message || String(error)); controls.forEach(node => { node.disabled = false; }); }
    } finally { saving = false; }
  }
  function checkbox(label, checked, action) {
    const control = remember(input('checkbox')); control.checked = checked;
    const wrap = el('label', undefined, 'teleports-checkbox'); wrap.append(control, el('span', label));
    if (action) control.addEventListener('change', async () => {
      const previous = !control.checked;
      await action(control.checked);
      // A rejected save cannot leave an unsaved value looking confirmed.
      if (current() && controls.includes(control)) control.checked = previous;
    });
    return { wrap, control };
  }
  function routeRow(row, revision) {
    const wrap = el('article', undefined, 'teleports-route');
    const body = el('div', undefined, 'teleports-route-body');
    const heading = el('div', undefined, 'teleports-route-heading');
    const status = el('span', row.available ? 'Usable' : 'Not usable', `teleports-status${row.available ? ' is-usable' : ''}`);
    heading.append(el('h4', row.name), status); body.append(heading);
    const destination = String(row.destination ?? '');
    body.append(el('p', destinationLabel(row.destinationName, destination), 'teleports-destination'));
    const rawReasons = [row.reason, ...(row.reasons ?? [])].filter(Boolean);
    const failures = [...(row.unmet ?? []), ...(row.unknown ?? [])];
    const coinsOnly = !row.available && failures.length && failures.every(value =>
      value.requirement === 'currencies' && value.key === 'coins' || value.requirement === 'return-coins');
    const coinReason = row.kind === 'carpet' && row.cost?.['currencies:coins'] > 0
      ? `Needs ${row.cost['currencies:coins'].toLocaleString('en-GB')} coins for this carpet leg and enough for the way home. Enter your coins on hand above if you have them.`
      : 'Needs coins for this journey. Enter your coins on hand above if you have them.';
    const reasons = coinsOnly ? [coinReason] : [...new Set(rawReasons.filter(value => row.group !== 'lodestones' || !row.rollOnly || !unresolvedEndpointReasons.has(value)).map(displayReason))];
    body.append(el('p', reasons.join(' · ') || 'No availability details returned.', 'teleports-reason'));
    if (rawReasons.includes('Members only.') && ctx.rulesDialog) {
      body.append(button('Review members rule', () => { if (current()) return ctx.rulesDialog({ ruleId: 'content.f2p', memberId: requestedMember }); }));
    }
    if (advanced()) {
      const diagnostics = el('details', undefined, 'teleports-diagnostics');
      diagnostics.append(el('summary', 'Route diagnostics'), el('p', `Route ID: ${row.id}`));
      for (const reason of new Set([row.reason, ...(row.reasons ?? []), row.accessReason].filter(Boolean))) diagnostics.append(el('p', reason));
      body.append(diagnostics);
    }
    if (row.rollOnly && row.group !== 'lodestones') {
      body.append(el('p', 'Its destination can come up in your rolls. The exact landing spot isn’t mapped yet, so it doesn’t open up any area by itself.', 'teleports-reason'));
      const access = row.accessReason && displayReason(row.accessReason);
      if (advanced() && access && !reasons.includes(access) && access !== 'Exact landing spot is not mapped yet.') body.append(el('p', access, 'teleports-signal'));
    }
    const signal = [row.pending ? 'Not mapped yet' : row.estimated && !reasons.includes('You can reach this lodestone to activate it.') ? 'Based on estimated levels, so check in-game' : '',
      row.override === true ? 'You marked this usable' : row.override === false ? 'You marked this unusable' : ''].filter(Boolean).join(' · ');
    if (signal) body.append(el('p', signal, 'teleports-signal'));
    if (row.pending) {
      wrap.append(body, el('p', 'This route can’t be changed until it’s mapped.', 'teleports-signal'));
      return wrap;
    }
    const choice = remember(select(overrideChoices, row.override === true ? 'true' : row.override === false ? 'false' : 'auto'));
    choice.setAttribute('aria-label', `Availability override for ${row.name}`);
    choice.addEventListener('change', async () => {
      const before = row.override === true ? 'true' : row.override === false ? 'false' : 'auto';
      await save({ type: 'set-teleport-override', memberId: requestedMember, routeId: row.id, value: choice.value === 'auto' ? null : choice.value === 'true' }, revision);
      if (current() && controls.includes(choice)) choice.value = before;
    });
    wrap.append(body, field('Override', choice)); return wrap;
  }
  async function loadCatalogue() {
    const token = ++request, revision = ctx.state().revision;
    controller?.abort(); controller = new AbortController();
    catalogue.setAttribute('aria-busy', 'true');
    catalogue.replaceChildren(el('p', 'Checking which teleports you can use…', 'teleports-empty'));
    try {
      const value = await ctx.api(`/api/teleports?member=${encodeURIComponent(requestedMember)}`, undefined, controller.signal);
      if (!current() || token !== request) return;
      if (!scopeValid(revision) || value.memberId !== requestedMember || value.stateRevision !== revision) {
        catalogue.replaceChildren(el('p', 'The saved map changed while checking teleports. Refresh to see the latest personal availability.', 'teleports-empty'));
        return;
      }
      const rows = value.rows ?? []; ctx.onTravelRoutes?.(rows); const usable = rows.filter(row => row.available).length;
      for (const row of value.personalTeleports ?? []) {
        const node = customStatuses.get(row.id);
        if (node) node.textContent = row.available ? 'Usable' : row.reason ?? 'Not usable';
      }
      // Members-only routes can never be used in free-to-play, so they fold away instead of filling the list.
      const membersOnly = row => !row.available && (row.reasons ?? [row.reason]).includes('Members only.');
      const folded = rows.filter(membersOnly).length;
      catalogue.replaceChildren(el('p', `${usable} of ${rows.length - folded} routes usable${folded ? ` · ${folded} members-only folded away` : ''}${value.automatic ? '' : ' · Preview: automatic is off'}`, 'teleports-count'));
      if (!rows.length) catalogue.append(el('p', 'No automatic routes were found for this player.', 'teleports-empty'));
      for (const [id, title] of groups) {
        const routes = rows.filter(row => row.group === id);
        if (!routes.length) continue;
        const section = el('section', undefined, 'teleports-group');
        const groupHeading = el('div', undefined, 'teleports-group-heading');
        const shown = routes.filter(row => !membersOnly(row)).sort((a, b) => Number(b.available) - Number(a.available)), hidden = routes.filter(membersOnly);
        groupHeading.append(el('h3', title), el('span', `${shown.filter(row => row.available).length} / ${shown.length} usable`, 'teleports-group-count'));
        section.append(groupHeading);
        if (id === 'lodestones' && routes.some(row => row.rollOnly)) section.append(el('p', 'Usable lodestones add roll options. Exact landing areas are not confirmed, so they do not open areas by themselves. Check activation in-game, then choose “I can use it” in that lodestone’s Override dropdown.', 'teleports-help'));
        section.append(...shown.map(row => routeRow(row, revision)));
        if (hidden.length) {
          const more = el('details', undefined, 'teleports-members');
          more.append(el('summary', `Members-only ${title.toLowerCase()} (${hidden.length})`), ...hidden.map(row => routeRow(row, revision)));
          section.append(more);
        }
        catalogue.append(section);
      }
    } catch (error) {
      if (!current() || token !== request || error.name === 'AbortError') return;
      catalogue.replaceChildren(el('p', `Could not check teleport availability. ${error.message || String(error)}`, 'teleports-error'), button('Retry availability', loadCatalogue));
    } finally { if (current() && token === request) catalogue.setAttribute('aria-busy', 'false'); }
  }
  async function render() {
    if (!current()) return;
    const personal = owner(), revision = ctx.state().revision;
    controls.length = 0;
    customStatuses.clear();
    feedback = el('div', undefined, 'teleports-feedback'); feedback.setAttribute('role', 'status');
    const intro = el('p', `Teleports ${personal.name} can use add their destination to ${personal.name}’s roll options. The destination stays locked until it’s rolled.`, 'teleports-intro');
    const mode = el('section', undefined, 'teleports-mode');
    const automatic = ctx.state().rules?.['travel.automatic'] === true;
    mode.append(checkbox('Automatic availability', automatic, value => save({ type: 'set-rule', ruleId: 'travel.automatic', value }, revision)).wrap,
      el('p', automatic ? 'On for both of you. Each player gets the teleports their own levels, quests and items allow.' : 'Off for both of you: only the custom teleports below count. The list shows what would count if you turn this on.', 'teleports-help'),
      el('p', 'RuneMetrics sync supplies levels and quests, but not lodestone activations or bank contents. For each lodestone you have activated, choose “I can use it” in its Override dropdown below. Do this separately for each player. Changes can be undone in History.', 'teleports-help'),
      el('p', 'The old F2P map does not confirm activated lodestones after a members restart. Teleports need a way back to your chunks. Activate a lodestone in your own area or confirm another teleport home.', 'teleports-help'));
    const coinsForm = el('form', undefined, 'teleports-coins');
    const coins = input('text');
    coins.id = 'transport-coins';
    coins.value = String(personal.transportFacts?.currencies?.coins ?? '');
    amountInput(coins, { min: 0, max: 1e12, whole: true });
    const coinsField = field('Coins on hand', coins);
    const coinsLabel = coinsField.children[0]; coinsLabel?.setAttribute('for', coins.id);
    const canEditCoins = ctx.canWriteMember?.(requestedMember) ?? ctx.canWrite?.() ?? true;
    coins.disabled = !canEditCoins;
    if (canEditCoins) remember(coins);
    coins.setAttribute('aria-describedby', 'transport-coins-help');
    const coinsHelp = el('p', 'At least this many coins. 10k, 2.5m and 1b work too. Renewable coins still count if higher. Fares are checked, not spent. Clear the field to remove your declaration.', 'teleports-help');
    coinsHelp.id = 'transport-coins-help';
    async function saveCoins() {
      if (!canEditCoins) return;
      const value = coins.value.trim(), amount = parseAmount(value);
      if (value && (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12)) {
        report('Enter a whole number from 0 to 1,000,000,000,000 (or 1t), or clear the field.'); return;
      }
      const facts = structuredClone(personal.transportFacts ?? {});
      if (value) facts.currencies = { ...facts.currencies, coins: amount };
      else if (facts.currencies) {
        delete facts.currencies.coins;
        if (!Object.keys(facts.currencies).length) delete facts.currencies;
      }
      await save({ type: 'set-transport-facts', memberId: requestedMember, facts }, revision);
    }
    coinsForm.append(coinsField, coinsHelp);
    if (canEditCoins) coinsForm.append(remember(button('Save coins', saveCoins)));
    coinsForm.addEventListener('submit', event => { event.preventDefault(); void saveCoins(); });
    const toolbar = el('div', undefined, 'teleports-toolbar');
    toolbar.append(el('h3', 'Automatic routes'), remember(button('Refresh', render)));
    catalogue = el('div', undefined, 'teleports-catalogue');
    const custom = el('section', undefined, 'teleports-custom');
    custom.append(el('h3', 'Custom teleports'), el('p', 'Add a teleport the picker doesn’t know about. One that uses up an item, like a teleport tablet, also needs Allow consumable teleports in Chunk Rules.', 'teleports-help'));
    if (!personal.teleports?.length) custom.append(el('p', 'No custom teleports saved yet.', 'teleports-empty'));
    for (const teleport of personal.teleports ?? []) {
      const row = el('article', undefined, 'teleports-manual');
      row.append(el('h4', teleport.label), el('p', destinationLabel(ctx.world?.()?.chunks.get(String(teleport.destination))?.name, teleport.destination), 'teleports-destination'));
      const status = el('p', 'Checking return route…', 'teleports-reason');
      customStatuses.set(teleport.id, status); row.append(status);
      const actions = el('div', undefined, 'teleports-manual-actions');
      actions.append(checkbox('Usable by this player', teleport.available, value => save({ type: 'set-teleport', memberId: requestedMember, teleport: { ...teleport, available: value } }, revision)).wrap,
        checkbox('Consumable', teleport.consumable, value => save({ type: 'set-teleport', memberId: requestedMember, teleport: { ...teleport, consumable: value } }, revision)).wrap,
        remember(button('Remove', () => save({ type: 'delete-teleport', memberId: requestedMember, teleportId: teleport.id }, revision), 'teleports-remove')));
      row.append(actions); custom.append(row);
    }
    const form = el('form', undefined, 'teleports-add');
    form.append(el('h3', 'Add a custom teleport'));
    const name = remember(input('text')), destination = remember(input('text'));
    name.required = destination.required = true;
    name.placeholder = 'Teleport name'; destination.placeholder = 'Destination chunk ID';
    const fields = el('div', undefined, 'teleports-add-fields'); fields.append(field('Name', name), field('Destination chunk', destination));
    const available = checkbox('Usable by this player', true), consumable = checkbox('Uses a consumable', false);
    const add = remember(button('Add teleport', addTeleport, 'teleports-add-button'));
    async function addTeleport() {
      if (!name.value.trim() || !destination.value.trim()) { report('Enter a name and destination chunk ID before adding a teleport.'); return; }
      await save({ type: 'set-teleport', memberId: requestedMember, teleport: { id: uuid(), label: name.value.trim(), destination: destination.value.trim(), available: available.control.checked, consumable: consumable.control.checked } }, revision);
    }
    form.addEventListener('submit', event => { event.preventDefault(); void addTeleport(); });
    form.append(fields, available.wrap, consumable.wrap, add);
    content.replaceChildren(intro, mode, coinsForm, feedback, toolbar, catalogue, custom, form);
    await loadCatalogue();
  }
  const ready = render();
  return { ready, refresh: render };
}
