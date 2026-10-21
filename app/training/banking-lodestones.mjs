import { TRANSPORT_ROUTES } from '../data/transport-routes.mjs';

/** Activation is personal, not inferred from the partner's territory or a map
 * icon. Reuse saved confirmations/overrides; exact typed landing coordinates
 * still have to pass the banking mask's admission and collision checks. */
export function confirmedBankingLodestones(availability, catalogue = TRANSPORT_ROUTES) {
  if (availability.gatheringLodestones === 'off') return [];
  const unlocks = availability.gatheringTravelUnlocks ?? {}, stations = new Map(catalogue.stations.map(row => [row.id, row]));
  if (unlocks.conditions?.['teleport-origin-permitted'] === false) return [];
  return catalogue.routes.filter(route => {
    if (route.kind !== 'lodestone' || route.from !== null || unlocks.overrides?.[route.id] === false) return false;
    if (!availability.members && (route.members !== false || route.f2p !== true)) return false;
    const keys = route.requirements?.confirmations ?? [];
    const station = stations.get(route.to);
    return unlocks.overrides?.[route.id] === true || keys.length > 0 && keys.every(key => unlocks.confirmations?.[key] === true)
      || (unlocks.teleports ?? []).some(row => row.available && !row.consumable && station
        && String(row.destination).split('-')[0] === station.chunkId
        && ([route.id, route.to].includes(row.id) || row.label?.trim().toLowerCase() === station.name?.toLowerCase()));
  }).flatMap(route => {
    const station = stations.get(route.to);
    return station?.plane === 0 && station.componentWitness?.plane === 0
      && Number.isSafeInteger(station.mapId) && station.componentWitness.mapId === station.mapId
      && station.coordinateEvidence?.role === 'exact-teleport-destination'
      && Number.isInteger(station.x) && Number.isInteger(station.y)
      ? [{ ...station, routeId: route.id, evidence: route.provenance }] : [];
  });
}
