// Multi-source shortest paths with non-negative initial costs. Weighted bank
// entrances and teleport legs share the same admitted, diagonal-aware graph.
export function bankingTileSearch({ size, neighbors }, seeds) {
  const distance = new Int32Array(size).fill(-1), next = new Uint8Array(size).fill(255);
  const owner = new Uint16Array(size).fill(65535), heap = [];
  function push(node, cost) {
    const value = cost * size + node;
    let i = heap.length; heap.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p] <= value) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = value;
  }
  function pop() {
    const first = heap[0], value = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1] < heap[c]) c++;
        if (heap[c] >= value) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = value;
    }
    return first;
  }
  for (const seed of seeds) if (seed.node >= 0 && seed.node < size && Number.isInteger(seed.cost) && seed.cost >= 0
    && (distance[seed.node] < 0 || seed.cost < distance[seed.node])) {
    distance[seed.node] = seed.cost; owner[seed.node] = seed.owner; push(seed.node, seed.cost);
  }
  while (heap.length) {
    const value = pop(), node = value % size, cost = Math.floor(value / size);
    if (distance[node] !== cost) continue;
    for (const [neighbor, directionBack] of neighbors(node)) {
      if (distance[neighbor] >= 0 && distance[neighbor] <= cost + 1) continue;
      distance[neighbor] = cost + 1; next[neighbor] = directionBack; owner[neighbor] = owner[node]; push(neighbor, cost + 1);
    }
  }
  return { distance, next, owner };
}

export function straightRuns(points) {
  const runs = [];
  let previous;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return null;
    const direction = `${dx},${dy}`;
    if (direction === previous) runs[runs.length - 1]++;
    else { runs.push(1); previous = direction; }
  }
  return runs;
}
