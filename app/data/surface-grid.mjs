import { datasetValue } from "../dataset-runtime.mjs";
export const SURFACE_GRID = datasetValue("app/data/surface-grid.mjs#SURFACE_GRID");

/** Inverse of the reference grid's x * 256 - y + 7495, with strict crop bounds. */
export function surfaceCoordinates(id) {
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
  const region = Number(id);
  const x = Math.ceil((region - SURFACE_GRID.startId) / SURFACE_GRID.stride) || 0;
  const y = x * SURFACE_GRID.stride + SURFACE_GRID.startId - region;
  return x >= 0 && x < SURFACE_GRID.columns && y >= 0 && y < SURFACE_GRID.rows ? { x, y } : null;
}

export const CACHE_SECTION_OFFSET = datasetValue("app/data/surface-grid.mjs#CACHE_SECTION_OFFSET");
