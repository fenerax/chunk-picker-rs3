export const SEED = 'owned-acceptance-7b-2026-11-10-v1';
export const shapes = Object.freeze({
  acceptance: Object.freeze({ groups: 50, tasks: 24000, aliases: 100000, members: 4, history: 1000, archiveSegments: 2, archiveEvents: 100, chunks: 256 }),
  smoke: Object.freeze({ groups: 1, tasks: 3, aliases: 2, members: 4, history: 1, archiveSegments: 1, archiveEvents: 1, chunks: 2 }),
  spotCheck: Object.freeze({ groups: 3, tasks: 2400, aliases: 10000, members: 4, history: 1000, archiveSegments: 2, archiveEvents: 100, chunks: 256 }),
});
// One warmup and one measured round exercise the same receipt paths in smoke.
export const rounds = Object.freeze({ acceptance: 5, smoke: 2, spotCheck: 5 });
export const acceptanceShape = shape => Object.entries(shapes.acceptance).every(([key, value]) => shape?.[key] === value);
