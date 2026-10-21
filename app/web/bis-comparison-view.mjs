import { renderBiSComparison } from './bis-compare.mjs';

// Partner details share the duo list loader and its current-revision cache.
export function createBiSComparisonView(context, { memberId, result, isCurrent }) {
  const { el, button } = context, root = el('div', undefined, 'form-stack');
  const members = context.state().members, selected = members.find(member => member.id === memberId), partners = members.filter(member => member.id !== memberId);
  let request = 0;
  const chooser = partners.length > 1 ? el('select') : null;
  if (chooser) {
    chooser.setAttribute('aria-label', 'Compare gear with player');
    for (const member of partners) { const option = el('option', member.name); option.value = member.id; chooser.append(option); }
    chooser.value = partners[0].id;
    root.append(chooser);
  }
  const body = el('div'); root.append(body);
  const load = async () => {
    const sequence = ++request, partner = partners.find(member => member.id === chooser?.value) ?? partners[0];
    body.replaceChildren(el('p', `Loading ${partner.name}’s gear…`, 'status-detail'));
    try {
      const other = await context.ensureMemberResult(partner.id);
      if (sequence !== request || !isCurrent() || root.isConnected === false) return;
      if (other?.memberId !== partner.id || other.stateRevision !== result.stateRevision || !other.currentBiS) throw new Error('The saved gear changed while loading. Refresh Current BiS and try again.');
      body.replaceChildren(renderBiSComparison(context, [{ member: selected, result }, { member: partner, result: other }]));
    } catch (error) {
      if (sequence !== request || !isCurrent() || root.isConnected === false) return;
      body.replaceChildren(el('p', error.message ?? 'Partner gear is unavailable. Try again.', 'info-empty'), button('Retry comparison', load));
    }
  };
  if (!partners.length) body.append(el('p', 'Add another player to compare gear.', 'info-empty'));
  else if (!context.ensureMemberResult) body.append(el('p', 'Partner gear is unavailable. Refresh the page and try again.', 'info-empty'));
  else { chooser?.addEventListener('change', load); load(); }
  return root;
}
