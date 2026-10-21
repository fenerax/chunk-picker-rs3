import { loadArtPack, safeArtFile, ART_COMPONENTS } from './packs.mjs';
import { ART_BINDINGS } from './art-bindings.mjs';

// Local overrides are operator configuration, never browser input. Refuse links
// in these providers too, so an optional root cannot widen an artwork route.
export async function localArtFile(directory, relative) {
  if (!directory || !relative) return null;
  try {
    return await safeArtFile(directory, relative);
  } catch (error) {
    if (error instanceof TypeError || ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

export async function createArtProvider({ packsDir, selectionPath, selection, overrides = {}, defaults = {} } = {}) {
  const pack = await loadArtPack({ packsDir, selectionPath, selection });
  const choices = new Map(ART_COMPONENTS.map(component => [component, new Set()]));
  const resolved = (component, relative, source, filename) => {
    choices.get(component)?.add(source);
    return filename;
  };
  async function file(component, relative) {
    const override = await localArtFile(overrides[component], relative);
    if (override) return resolved(component, relative, 'override', override);
    const packed = await pack.file(component, relative);
    if (packed) return resolved(component, relative, 'pack', packed);
    const fallback = await localArtFile(defaults[component], relative);
    return resolved(component, relative, fallback ? 'default' : 'placeholder', fallback);
  }
  async function required(component, relative) {
    const found = await file(component, relative);
    if (!found) throw Object.assign(new Error('Not found.'), { status: 404, code: 'ENOENT' });
    return found;
  }
  async function status() {
    const availableRoutes = [];
    for (const [route, binding] of ART_BINDINGS) {
      if (await file(binding.component, binding.relative)) availableRoutes.push(route);
    }
    const selected = pack.status();
    return { placeholderPictures: availableRoutes.length < ART_BINDINGS.size,
      pack: selected, availableRoutes,
      components: Object.fromEntries([...choices].map(([component, sources]) => [component, [...sources].sort()])) };
  }
  return { file, required, status, pack };
}
