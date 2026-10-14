const known = value => Number.isFinite(value) && value >= 0;
const whole = value => Math.round(value).toLocaleString('en-CA');
const minutes = value => (value / 60).toLocaleString('en-CA', { maximumFractionDigits: 1 });
const xpText = rate => known(rate?.xpPerHour) ? `${whole(rate.xpPerHour)} XP/hour` : 'XP/hour unknown';
const resourcesText = (rate, label, disposition) => known(rate?.resourcesPerHour)
  ? `${whole(rate.resourcesPerHour)} ${label}/hour ${disposition}` : `${label}/hour unknown`;

export function bankingRateText(rate, { resourceLabel = 'resources', kept = false } = {}) {
  return `${xpText(rate)} · ${resourcesText(rate, resourceLabel, kept ? 'kept' : 'gathered')}`;
}

/** Read-only per-spot comparison. The walking estimate is the normal view. */
export function renderBankingComparison(el, banking, { advanced = false, resourceLabel = 'resources' } = {}) {
  if (!banking) return null;
  const section = el('section', undefined, 'helper-training-banking-comparison');
  section.append(el('h4', `Drop or bank${Number.isInteger(banking.level) ? ` at level ${banking.level}` : ''}`));
  const spots = banking.spots?.length ? banking.spots : [{ status: banking.status, drop: banking.drop }];
  const more = spots.length > 3 ? el('details', undefined, 'helper-training-banking-more') : null;
  if (more) more.append(el('summary', `More spots (${spots.length - 3})`));
  for (const [index, spot] of spots.entries()) {
    const row = el('div', undefined, 'helper-training-banking-spot');
    if (spot.label) row.append(el('p', spot.label, 'helper-training-note'));
    const columns = el('div', undefined, 'helper-training-banking-columns');
    const drop = el('div', undefined, 'helper-training-banking-option'), bank = el('div', undefined, 'helper-training-banking-option');
    drop.append(el('strong', 'Drop'), el('p', bankingRateText(spot.drop ?? banking.drop, { resourceLabel })));
    const walking = spot.rates?.walking ?? spot.bank;
    bank.append(el('strong', 'Bank'));
    if (spot.status === 'unreachable' || spot.status === 'no-bank' || spot.status === 'no-reachable-bank') bank.append(el('p', 'No bank reachable in your chunks.'));
    else if (!walking || !spot.destination) bank.append(el('p', 'Banking time unknown.'));
    else {
      bank.append(el('p', bankingRateText(walking, { resourceLabel, kept: true })), el('p', `To ${spot.destination.name ?? spot.destination.label ?? 'bank'}`));
      bank.append(el('p', known(spot.walkingSeconds) ? `${minutes(spot.walkingSeconds)} min round-trip walk` : 'Round-trip walk time unknown'));
      const resources = walking.resources ?? spot.resources ?? [];
      if (resources.length > 1) bank.append(el('p', resources.map(resource => `${known(resource.perHour ?? resource.resourcesPerHour) ? whole(resource.perHour ?? resource.resourcesPerHour) : '?'} ${resource.item ?? resource.label}/hour kept`).join(' · ')));
    }
    columns.append(drop, bank); row.append(columns);
    if (advanced) {
      const details = el('details', undefined, 'helper-training-banking-details'), list = el('ul'); details.append(el('summary', 'Banking details'));
      if (Number.isFinite(spot.x) && Number.isFinite(spot.y)) list.append(el('li', `Spot coordinates: ${spot.x}, ${spot.y}`));
      if (known(spot.tileSteps)) list.append(el('li', `Round-trip route: ${whole(spot.tileSteps)} tile steps`));
      if (spot.chunkIds?.length) list.append(el('li', `Route chunks: ${spot.chunkIds.join(', ')}`));
      if (known(walking?.capacity)) list.append(el('li', `Capacity: ${whole(walking.capacity)} ${resourceLabel}`));
      if (known(walking?.gatheringSeconds)) list.append(el('li', `Gathering: ${whole(walking.gatheringSeconds)} seconds per backpack`));
      if (known(walking?.handlingSeconds ?? spot.handlingSeconds)) list.append(el('li', `Storing and banking: ${whole(walking?.handlingSeconds ?? spot.handlingSeconds)} seconds per trip`));
      if (known(walking?.cycleSeconds)) list.append(el('li', `Full cycle: ${whole(walking.cycleSeconds)} seconds`));
      if (spot.rates?.running) list.append(el('li', `Running scenario: ${bankingRateText(spot.rates.running, { resourceLabel, kept: true })}`));
      for (const note of new Set([...(banking.limitations ?? []), ...(spot.limitations ?? [])])) if (typeof note === 'string') list.append(el('li', note));
      if (!walking) list.append(el('li', 'No route estimate is available for this spot.'));
      details.append(list); row.append(details);
    }
    if (index >= 3 && more) more.append(row); else section.append(row);
  }
  if (more) section.append(more);
  return section;
}
