// Compatibility-only preload, inherited by calculator processes and isolates.
// Raw response comparisons retain every field; elapsed-time values are fixed.
Object.defineProperty(performance, 'now', { value: () => 1000, configurable: true });
