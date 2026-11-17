import { originalMapCodeTexts } from './original-map-code.mjs';
self.onmessage = async ({ data }) => {
  try { self.postMessage({ texts: await originalMapCodeTexts(data.code) }); }
  catch (error) { self.postMessage({ error: error.message || 'Could not read original gameplay.' }); }
};
