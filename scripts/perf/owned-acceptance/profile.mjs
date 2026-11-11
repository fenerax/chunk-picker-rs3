export const SEED = 'owned-acceptance-7b-2026-11-10-v1';
export const shapes = Object.freeze({
  acceptance: Object.freeze({ groups: 50, tasks: 24000, aliases: 100000, members: 4, history: 1000, archiveSegments: 2, archiveEvents: 100, chunks: 256 }),
  smoke: Object.freeze({ groups: 2, tasks: 12, aliases: 32, members: 4, history: 4, archiveSegments: 2, archiveEvents: 2, chunks: 4 }),
});
export const acceptanceShape = shape => Object.entries(shapes.acceptance).every(([key, value]) => shape?.[key] === value);
