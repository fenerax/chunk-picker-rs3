import path from 'node:path';
import { realpath } from 'node:fs/promises';

async function location(filename) {
  try { return await realpath(filename); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(filename);
    if (parent === filename) throw error;
    return path.join(await location(parent), path.basename(filename));
  }
}
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
// The CLI checks before creating any output. The copy API also checks directly.
// Existing ancestors are resolved to cover junction/symlink aliases.
export async function assertFixtureCopyDestination(source, destination) {
  const from = await realpath(path.resolve(source)), to = await location(path.resolve(destination));
  if (contains(from, to) || contains(to, from)) throw new Error('Fixture output must be outside its source; overlapping trees are refused.');
}
