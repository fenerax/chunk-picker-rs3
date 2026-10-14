import { fileURLToPath } from 'node:url';

// The exported package uses this entrypoint; ordinary private startup is unchanged.
// Keep the independent launcher's isolated storage, environment and port checks.
process.argv.splice(2, 0, '--dataset', 'open-f2p');
if (!process.argv.slice(2).includes('--data-dir')) process.argv.push('--data-dir', fileURLToPath(new URL('../var/open-f2p', import.meta.url)));
await import('./start-independent-game.mjs');

