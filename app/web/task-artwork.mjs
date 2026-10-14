import { itemIcon } from './icons.mjs';
import { getArtStatus, placeholderPicture, resolvePicture } from './art-status.mjs';

// Exact inventory artwork retained in upstream 98a3bdc. These versioned copies
// cover the requested examples when the installed optional icon bundle is absent.
export const taskArtworkProvenance = [
  { names: ['Team-1 cape'], source: 'resources/equipment_icons/Team-1_cape.png', sha256: '6d8c01870ff6f508d962b79d0008f37793b36726d957064b314a24e14b99ae40' },
  { names: ['Skull lantern (tier 10)', 'Skull lantern#(tier 10)'], source: 'resources/equipment_icons/Skull_lantern_(tier_10).png', sha256: 'a7c146e534035efd5e8f4a782391f911601ae054e356aa428e8a63bf5e72a665' },
];
export function taskItemIcon(name, lookup = itemIcon) {
  const generic = placeholderPicture('item'), supplied = lookup(name); if (supplied && supplied !== generic) return resolvePicture(supplied, getArtStatus() ? generic : null);
  const artwork = taskArtworkProvenance.find(row => row.names.includes(name));
  return resolvePicture(artwork ? `/task-item-artwork.2026-10-09.v1/${artwork.sha256}.png` : null, getArtStatus() && typeof name === 'string' && name.trim() ? generic : null);
}
