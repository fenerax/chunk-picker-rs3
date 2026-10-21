/** Annotation sources are independent of zoom; cache with the map scene. */
export function taskCountAnnotationCells(map) {
  const ids = new Set([...map.active.selectedRanks.keys(), ...map.candidateRanks.keys(), ...map.deathMarkers.keys()]);
  for (const member of map.visibleMembers) {
    if (member.startingChunk) ids.add(member.startingChunk);
    for (const [id, stickers] of Object.entries(member.stickers ?? {})) if (stickers?.length) ids.add(id);
  }
  for (const [id, state] of map.cellStates) {
    if (state.selected?.length || map.visibleMembers.length > 1 && state.owners.length > 0
      && state.owners.length < map.visibleMembers.length) ids.add(id);
  }
  return new Map([...ids].filter(id => map.cells.has(id)).map(id => [id, map.cells.get(id)]));
}

/** Existing annotations in zoomed world pixels. Cached until geometry changes. */
export function taskCountObstacles(map, { chunkIdLayout, layoutStickerCluster, startingFlagSize }, annotationCells = map.cells) {
  const size = 128 * map.zoom, prefs = map.model.preferences, members = map.visibleMembers;
  const obstacles = [], add = (x, y, width, height) => { if (width > 0 && height > 0) obstacles.push({ x, y, width, height }); };
  const cells = prefs.ids && size >= 35 ? map.cells : annotationCells;
  for (const [id, point] of cells) {
    const x = point.x * size, y = point.y * size, state = map.cellStates.get(id);
    const idLayout = prefs.ids && size >= 35 ? chunkIdLayout(members, id, size, prefs.stickerScale, prefs.chunkIdScale) : null;
    if (idLayout) add(x + 2, y + size - 5 - idLayout.fontSize, idLayout.idRight - 2, idLayout.fontSize + 2);
    const rank = (state?.owners.length || state?.pending ? map.active.selectedRanks.get(id) : map.candidateRanks.get(id))
      ?? state?.selected?.[0]?.selectedRanks.get(id);
    if (rank && size >= 11) add(x + 1, y + 1, size - 2, size - 3 - (idLayout ? idLayout.fontSize + 4 : 0));
    if (members.length > 1 && state?.owners.length && state.owners.length < members.length && size >= 12) {
      const tab = Math.max(6, Math.min(18, size * .13));
      add(x, y, tab * (1 + (state.owners.length - 1) * .8), tab);
    }
    if (size >= 18 && members.some(owner => owner.startingChunk === id || owner.stickers?.[id]?.length)) {
      const cluster = layoutStickerCluster(members, id, size, prefs.stickerScale, idLayout?.flagLift ?? 0);
      const bar = members.length > 1 ? 4 : 0;
      for (const marker of cluster.markers) add(x + marker.x, y + marker.y, marker.size, marker.size + bar);
      if (cluster.overflow) {
        const chip = cluster.overflow, font = Math.max(7, chip.height - 2);
        // At very large marker sizes the existing chip can paint upward, or
        // have a background shorter than its minimum text. Reserve both.
        const height = Math.max(Math.abs(chip.height), font + 2);
        add(x + chip.x, y + chip.y + chip.height / 2 - height / 2, chip.width, height);
      }
      if (size >= 30 || !cluster.markers.length && !cluster.overflow) {
        const flags = members.filter(owner => owner.startingChunk === id), pad = Math.min(4, size * .1);
        const flagSize = idLayout?.flagSize ?? startingFlagSize(members, id, size, prefs.stickerScale);
        flags.forEach((owner, index) => add(x + size - pad - flagSize - index * (flagSize + 2),
          y + size - pad - flagSize - bar - (idLayout?.flagLift ?? 0), flagSize, flagSize + bar));
      }
    }
    if (size >= 20 && map.deathMarkers.has(id)) {
      const markerSize = Math.max(12, Math.min(30, size * .27));
      add(x + 2, y + size - markerSize - 5, markerSize + 4, markerSize + 4);
    }
  }
  return obstacles;
}
