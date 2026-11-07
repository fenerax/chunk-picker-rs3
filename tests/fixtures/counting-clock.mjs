// Worker telemetry tests measure stage execution, not host runtime. Each clock
// observation advances one unit, so executing a stage always has a positive cost.
let observations = 0;
Object.defineProperty(performance, 'now', { value: () => ++observations, configurable: true });
