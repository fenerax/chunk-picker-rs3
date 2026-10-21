// The scheduler and each worker keep the same LRU of parsed save states, so a
// request may reference a state instead of resending it. Two cover the current
// save and the one an in-flight calculation still uses; each parsed state
// carries the whole identity registry, so older entries only cost memory.
export const STATE_SNAPSHOT_LIMIT = 2;
