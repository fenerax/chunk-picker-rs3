/** Run inside a real browser via Playwright page.evaluate(profileMapPage, options).
 * Uses real local artwork/pins and an isolated, deterministic duo model.
 */
export async function profileMapPage({ zooms = [0.1, 0.35, 4], frames = 120, warmupFrames = 20, zoomFrames = 0, unlockedCount = 180, taskCounts = false, taskCountEntries = null, taskCountModes = null, placeNames = true, placeNameModes = null, chunkColours = false, groupView = false, activityLayerModes = ['off'], activityLayerEntries = null } = {}) {
  const { ChunkMap } = await import('/map.mjs');
  const [manifest, dataset] = await Promise.all([
    fetch('/assets/map/manifest.json').then(r => r.json()),
    fetch('/assets/map/pins.normalized.json').then(r => r.json()),
  ]);
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1280px;height:800px;z-index:10000;background:#070b0e';
  document.body.append(stage);
  const canvases = Array.from({ length: 4 }, () => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    stage.append(canvas); return canvas;
  });
  const tooltip = document.createElement('div'); stage.append(tooltip);
  const map = new ChunkMap({ stage, baseCanvas: canvases[0], stateCanvas: canvases[1],
    pinCanvas: canvases[2], hoverCanvas: canvases[3], tooltip });
  const chunks = new Map(), ids = [];
  for (let x = 0; x < 47; x++) for (let y = 0; y < 50; y++) {
    const id = String(7495 + x * 256 - y); chunks.set(id, { id, name: `Chunk ${id}` }); ids.push(id);
  }
  // Include a dense revealed region, and centres around the Varrock/Lumbridge area.
  const unlocked = ids.filter(id => { const x = Math.ceil((Number(id) - 7495) / 256), y = x * 256 + 7495 - Number(id);
    return x >= 14 && x <= 28 && y >= 12 && y <= 30; }).slice(0, unlockedCount);
  if (taskCountEntries) for (const [id] of taskCountEntries) if (chunks.has(id) && !unlocked.includes(id)) unlocked.push(id);
  // Display-only geometry needs no calculator module or registered engine
  // resolver. Every synthetic cell is F2P and this fixture has no travel edges.
  const world = { chunks, surface: new Set(ids), walkable: new Set(ids), f2p: new Set(ids) };
  const pool = { eligible: [], partnerConnections: { byChunk: {} } };
  const colourIds = ['red', 'yellow', 'green', 'blue'];
  const member = { id: 'player1', name: 'Player 1', unlocked, selected: [], pendingRoll: [], stickers: {},
    chunkColours: chunkColours ? Object.fromEntries(ids.map((id, index) => [id, colourIds[index % 4]])) : {} };
  const members = [member];
  if (groupView) members.push({ id: 'player2', name: 'Player 2', unlocked, selected: [], pendingRoll: [], stickers: {},
    chunkColours: chunkColours ? Object.fromEntries(ids.map((id, index) => [id, colourIds[(index + 1) % 4]])) : {} });
  map.setModel({ world, state: { revision: 0, members, settings: {} }, memberId: 'player1', groupView, pool, preferences: { showTaskCounts: taskCountModes?.[0] ?? taskCounts } });
  if (taskCounts || taskCountModes?.some(Boolean)) map.setTaskCounts(new Map(taskCountEntries ?? unlocked.map((id, index) => [id, index % 37 + 1])));
  map.setMapAssets(manifest, dataset);
  if (activityLayerModes.some(mode => mode !== 'off')) map.setActivityLayers({
    clues: new Map(activityLayerEntries?.clues ?? ids.map(id => [id, [{ tier: 'easy', label: 'Synthetic clue location' }]])),
    slayer: new Map(activityLayerEntries?.slayer ?? ids.map(id => [id, [{ label: 'Synthetic Slayer location' }]])),
  });
  await map.placeLabels?.ready;
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => {
    const deadline = performance.now() + 120000;
    while (performance.now() < deadline) {
      await nextFrame();
      if (map.imageStatus === 'ready' && !map.terrain.pending.size && !map.terrain.queue.size &&
          !map.terrain.updateFrame && !map.frame) { await nextFrame(); return; }
    }
    throw new Error(`Map did not settle: image=${map.imageStatus}, pending=${map.terrain.pending.size}, queue=${map.terrain.queue.size}, previews=${map.terrain.previews.size}, frame=${map.frame}`);
  };
  map.autoFit = false; map.zoom = 0.1; map.offset = { x: 339, y: 80 };
  map.invalidate(true, true, true); await settle();
  const contexts = [...map.contexts, map.pinContext];
  let drawImages = 0;
  for (const context of contexts) {
    const original = context.drawImage.bind(context);
    context.drawImage = (...args) => { drawImages++; original(...args); };
  }
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
  const results = [];
  let labelDuration = 0;
  if (map.placeLabels) {
    const drawLabels = map.placeLabels.draw.bind(map.placeLabels);
    map.placeLabels.draw = context => { const start = performance.now(); drawLabels(context); labelDuration += performance.now() - start; };
  }
  for (const zoom of zooms) for (const badges of taskCountModes ?? [taskCounts]) for (const names of placeNameModes ?? [placeNames]) for (const activities of activityLayerModes) {
    map.setDisplayPreferences({ showTaskCounts: badges, showPlaceNames: names });
    map.setActivityLayerPreferences({ clueTier: ['clues', 'both'].includes(activities) ? 'all' : 'off', showSlayer: ['slayer', 'both'].includes(activities) });
    map.zoom = zoom; map.offset = { x: 640 - 2797 * zoom, y: 400 - 2375 * zoom };
    map.invalidate(true, true, true); await settle();
    const render = [], intervals = [], draws = [], labelTimes = [];
    let prior = await nextFrame();
    for (let frame = 0; frame < frames + warmupFrames; frame++) {
      const timestamp = await nextFrame();
      map.offset.x += frame % 40 < 20 ? 4 : -4;
      map.offset.y += frame % 60 < 30 ? 2 : -2;
      drawImages = 0; labelDuration = 0;
      const start = performance.now();
      map.terrain.setView(map.visibleBounds(), zoom, map.dpr);
      map.drawBase(); map.drawState(); map.drawPins(); map.drawHover();
      const duration = performance.now() - start;
      if (frame >= warmupFrames) { render.push(duration); intervals.push(timestamp - prior); draws.push(drawImages); labelTimes.push(labelDuration); }
      prior = timestamp;
    }
    results.push({ zoom, taskCounts: badges, placeNames: names, activityLayers: activities, labelP95Ms: percentile(labelTimes, .95), labels: map.placeLabels?.lastPlacements.length ?? 0,
      renderMedianMs: percentile(render, 0.5), renderP95Ms: percentile(render, 0.95),
      renderMaxMs: Math.max(...render), frameMedianMs: percentile(intervals, 0.5), frameP95Ms: percentile(intervals, 0.95),
      frameMaxMs: Math.max(...intervals), fps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
      over50Ms: intervals.filter(ms => ms > 50).length, drawImagesMedian: percentile(draws, 0.5), drawImagesMax: Math.max(...draws) });
  }
  const zoomInteractions = [];
  if (zoomFrames) for (const badges of taskCountModes ?? [taskCounts]) for (const names of placeNameModes ?? [placeNames]) {
    map.setDisplayPreferences({ showTaskCounts: badges, showPlaceNames: names });
    const intervals = [], render = [], draws = [], labelTimes = [];
    let prior = await nextFrame();
    for (let frame = 0; frame < zoomFrames + 20; frame++) {
      const timestamp = await nextFrame(), progress = frame / (zoomFrames + 19);
      // Continuous wheel-like zoom in/out around Varrock, through every tier.
      map.zoom = 0.055 * (4 / 0.055) ** (1 - Math.abs(progress * 2 - 1));
      map.offset = { x: 640 - 2797 * map.zoom, y: 400 - 2375 * map.zoom };
      drawImages = 0; labelDuration = 0; const start = performance.now();
      map.terrain.setView(map.visibleBounds(), map.zoom, map.dpr);
      map.drawBase(); map.drawState(); map.drawPins(); map.drawHover();
      if (frame >= 20) { render.push(performance.now() - start); intervals.push(timestamp - prior); draws.push(drawImages); labelTimes.push(labelDuration); }
      prior = timestamp;
    }
    zoomInteractions.push({ taskCounts: badges, placeNames: names, activityLayers: activityLayerModes.at(-1) ?? 'off', labelP95Ms: percentile(labelTimes, .95), renderP95Ms: percentile(render, 0.95), renderMaxMs: Math.max(...render),
      frameP95Ms: percentile(intervals, 0.95), frameMaxMs: Math.max(...intervals),
      fps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
      over50Ms: intervals.filter(ms => ms > 50).length, drawImagesMax: Math.max(...draws) });
  }
  const zoomInteraction = taskCountModes || placeNameModes ? zoomInteractions : zoomInteractions[0] ?? null;
  const failedTiles = [...map.terrain.failed], nativePages = map.terrain.pages?.size ?? null, renderDpr = map.dpr;
  map.dispose(); stage.remove();
  return { viewport: [1280, 800], dpr: devicePixelRatio, frames, warmupFrames, unlockedCount: unlocked.length, taskCounts, taskCountModes, chunkColours, groupView, activityLayerModes,
    activityLayerCounts: activityLayerEntries ? { clues: activityLayerEntries.clues?.length ?? 0, slayer: activityLayerEntries.slayer?.length ?? 0 } : null,
    terrainFiles: manifest.terrain.tiles.filter(t => t.status === 'downloaded').length, pins: dataset.pins.length,
    failedTiles, nativePages, renderDpr, zoomInteraction, results };
}
