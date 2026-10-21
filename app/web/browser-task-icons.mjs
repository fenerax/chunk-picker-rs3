import { taskIcon as modelIcon, taskCategoryIcon as modelCategoryIcon, taskItemNames } from '../tasks/task-icons.mjs';
import { categoryPlaceholder, getArtStatus, placeholderPicture, resolvePicture } from './art-status.mjs';

export { taskItemNames };
export function taskCategoryIcon(category, skillIcon = () => null) {
  const exactSkill = name => { const route = skillIcon(name); return route?.startsWith('/placeholder-art/') ? null : route; };
  return resolvePicture(modelCategoryIcon(category, exactSkill), categoryPlaceholder(category));
}
export function taskIcon(task = {}, lookups = {}) {
  const generic = placeholderPicture('item');
  // A generic bag must not pretend that a Wiki NPC or quest marker is an item.
  const itemIcon = name => { const url = lookups.itemIcon?.(name); return url === generic ? null : url; };
  const inventory = taskItemNames(task).map(itemIcon).find(Boolean);
  const skillIcon = name => { const route = lookups.skillIcon?.(name); return route?.startsWith('/placeholder-art/') ? null : route; };
  const route = modelIcon(task, { ...lookups, itemIcon, skillIcon });
  if (getArtStatus() && (task.item || task.equipmentName || task.category === 'BiS' || /^Obtain\s/i.test(task.rawLabel ?? task.label ?? '')) && taskItemNames(task).length) {
    return resolvePicture(inventory, generic);
  }
  return resolvePicture(route, categoryPlaceholder(task.category));
}
