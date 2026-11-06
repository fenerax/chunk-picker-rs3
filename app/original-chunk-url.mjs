// Independent implementation of the documented legacy chunk URL format.
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const originalPickerURL = 'https://gitgeddes.github.io/ChunkPicker/?';
export function legacyChunkIndex(id) {
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw new TypeError('Chunk must be a whole numeric grid cell.');
  const value = Number(id), x = Math.floor(value / 256) - 29, y = 70 - (value % 256);
  if (x < 0 || x >= 47 || y < 0 || y >= 49) throw new RangeError(`Chunk ${id} is outside the original picker grid.`);
  return x + 47 * y;
}
export function originalChunkURL(ids, dataset, world) {
  if (dataset.datasetId !== 'duo-legacy' || dataset.datasetContractVersion !== 1 || dataset.coordinateSystem !== 'surface-grid-v1' || dataset.identityNamespace !== 'rs3') {
    throw Object.assign(new Error('Original picker links require the full legacy RS3 dataset (surface-grid-v1). Only chunks carry over; this dataset has different coordinates or coverage.'), { status: 422 });
  }
  const tokens = [...new Set(ids)].map(id => {
    if (!world.chunks.has(String(id))) throw Object.assign(new Error(`Chunk ${id} is not a full cell in this dataset. No link was generated.`), { status: 422 });
    let index = legacyChunkIndex(id), token = '';
    do { token = alphabet[index % 62] + token; index = Math.floor(index / 62); } while (index);
    return token;
  });
  return originalPickerURL + tokens.join(',');
}
