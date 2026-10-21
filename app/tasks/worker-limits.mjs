// V8 sizes an isolate's young generation from the machine's memory: 128 MB on a
// 16 GB machine. Task compilation and evaluation measured no slower at 32 MB, and
// each calculator then holds about 60-120 MB less. Old-generation limits stay as
// inherited, so a large catalogue is never cut short by this setting.
export const TASK_WORKER_RESOURCE_LIMITS = Object.freeze({ maxYoungGenerationSizeMb: 32 });
