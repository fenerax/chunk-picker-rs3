import { dropChance } from './helper-model.mjs';
import { chanceChart, dataTable } from './helper-charts.mjs';
export function renderDrops(host, { document, api, member, partner: partnerMember, stateRevision, isCurrent, draft }) {
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const field = (label, control) => { const wrap = el('label', label); wrap.append(control); return wrap; };
  let disposed = false, rows = [], manualRateEdited = false; const controller = new AbortController();
  host.append(el('h2', 'Drop chances'), el('p', 'How likely is at least one drop? Use a monster you can reach, or enter a rate yourself.', 'helper-intro'));
  const form = el('form', undefined, 'helper-form'), source = el('select'), denominator = el('input'), own = el('input'), partner = el('input'), filter = el('input'), output = el('section'), status = el('p', 'Loading drops from your chunks…', 'helper-note');
  const custom = el('option', 'Enter a rate'); custom.value = ''; source.append(custom);
  filter.type = 'search'; filter.placeholder = 'Monster or item'; filter.value = draft?.filter ?? '';
  denominator.type = 'number'; denominator.min = 1; denominator.step = 'any'; denominator.value = draft?.denominator ?? '128'; denominator.required = true;
  for (const input of [own, partner]) { input.type = 'number'; input.min = 0; input.max = Number.MAX_SAFE_INTEGER; input.step = 1; input.value = '0'; input.required = true; }
  partner.required = false;
  own.value = draft?.ownKills ?? '0'; partner.value = draft?.partnerKills ?? '0';
  const submit = el('button', 'Calculate drop chance'); submit.type = 'submit'; status.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
  form.append(field('Find a drop', filter), field('Or pick one from your chunks', source), field('Drop rate: 1 in', denominator), field(`${member.name}’s kills so far`, own), field(`${partnerMember?.name ?? 'Partner'}’s kills (optional)`, partner), submit);
  host.append(form, status, (() => { const more = el('details', undefined, 'helper-note'); more.append(el('summary', 'How this is worked out'), el('p', 'Every kill has the same chance, so past dry streaks don’t make the next kill luckier. Combined kills assume you both have the same drop rate. Rare drop table rolls and bad-luck protection aren’t included. Each listed rate is for one loot roll; if an item can come from several rolls, type in its overall rate instead.')); return more; })(), output);
  function calculate(event) {
    event?.preventDefault(); if (!form.checkValidity()) { if (event) form.reportValidity(); return; }
    try {
      const data = dropChance(Number(denominator.value), Number(own.value), Number(partner.value));
      const percent = probability => `${(probability * 100).toFixed(2)}%`;
      output.replaceChildren(el('p', `${percent(data.probability)} chance of at least one drop${source.value === '' ? '' : ' from this loot roll'} after ${data.kills.toLocaleString()} combined kills.`, 'helper-answer'),
        el('p', `${percent(1 - data.probability)} chance of still having none. These are chances, not a guarantee.`, 'helper-note'), chanceChart(document, data),
        dataTable(document, 'Drop chance by kill count', ['Chance of a drop', 'Total kills', 'More kills from now'], [[`${percent(data.probability)} so far`, data.kills.toLocaleString(), '—'], ...data.thresholds.map(row => [percent(row.probability), row.kills?.toLocaleString() ?? 'Too many to count precisely', row.remainingKills?.toLocaleString() ?? 'Unknown'])]));
    } catch (error) { output.replaceChildren(el('p', error.message, 'helper-error')); }
  }
  form.addEventListener('submit', calculate);
  denominator.addEventListener('input', () => { manualRateEdited = true; source.value = ''; output.replaceChildren(); });
  source.addEventListener('change', () => { const row = rows[Number(source.value)]; if (source.value !== '' && row) { denominator.value = String(row.denominator); calculate(); } });
  filter.addEventListener('input', () => {
    const query = filter.value.trim().toLowerCase(); source.replaceChildren(custom);
    let shown = 0;
    rows.forEach((row, index) => { if (shown < 100 && `${row.monster} ${row.item}`.toLowerCase().includes(query)) { const option = el('option', `${row.monster} → ${row.item} (${row.rate})`); option.value = String(index); source.append(option); shown++; } });
  });
  calculate();
  api(`/api/helper-drops?memberId=${encodeURIComponent(member.id)}`, undefined, controller.signal).then(value => {
    if (disposed || !isCurrent() || value.memberId !== member.id) return;
    if (stateRevision !== undefined && value.stateRevision !== stateRevision) { status.textContent = 'The save changed while loading drops. Wait for the picker to refresh, then reopen Drop chances.'; return; }
    rows = value.drops; filter.dispatchEvent(new Event('input'));
    const chosen = draft?.selectedRoll, chosenIndex = chosen ? rows.findIndex(row => row.monster === chosen.monster && row.item === chosen.item && row.denominator === chosen.denominator) : -1;
    if (!manualRateEdited && chosenIndex >= 0 && Number(denominator.value) === rows[chosenIndex].denominator) {
      if (![...source.children].some(option => option.value === String(chosenIndex))) { const row = rows[chosenIndex], option = el('option', `${row.monster} → ${row.item} (${row.rate})`); option.value = String(chosenIndex); source.append(option); }
      source.value = String(chosenIndex); calculate();
    }
    status.textContent = value.f2p === false ? 'The picker currently uses members rules. Chunk drops are listed only with F2P rules; you can still enter a rate.' : `${rows.length.toLocaleString()} drops with known rates in your chunks. Search to narrow the list (it shows up to 100).`;
  }).catch(error => { if (!disposed && error.name !== 'AbortError') status.textContent = `Could not load chunk drops. You can still enter a rate. ${error.message}`; });
  const dispose = () => { disposed = true; controller.abort(); rows = []; };
  dispose.getDraft = () => { const row = source.value !== '' ? rows[Number(source.value)] : undefined; return { denominator: denominator.value, ownKills: own.value, partnerKills: partner.value, filter: filter.value, selectedRoll: row ? { monster: row.monster, item: row.item, denominator: row.denominator } : null }; };
  return dispose;
}
