import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/transport-routes.2026-10-09.v2.json");

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const TRANSPORT_ROUTES = freeze(catalogue);
export const transportStations = new Map(TRANSPORT_ROUTES.stations.map(station => [station.id, station]));
export const transportRouteById = new Map(TRANSPORT_ROUTES.routes.map(route => [route.id, route]));
