import { datasetJSON } from '../dataset-runtime.mjs';

export const MAP_PIN_DETAILS_PATH = 'map-pin-details.2026-10-08.v2.json';
export const MAP_PIN_DETAILS = await datasetJSON(`app/data/${MAP_PIN_DETAILS_PATH}`);
const byId = new Map(MAP_PIN_DETAILS.pins.map(detail => [detail.id, detail]));

/** Stable identity only: a baseline pin at the same coordinate is not a match. */
export function mapPinDetailForId(id) { return byId.get(id) ?? null; }
export function applyMapPinDetails(pins) {
  return pins.map(pin => {
    const detail = mapPinDetailForId(pin.id);
    return detail ? { ...pin, detail } : pin;
  });
}
