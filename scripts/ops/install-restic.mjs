// Run later as root on the deployment/scratch machine. No account access.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { resticPin } from '../linux/restic.mjs';
export async function installRestic() {
  if (process.platform !== 'linux' || process.getuid() !== 0 || !resticPin[process.arch]) throw Error('Supported Linux root required.');
  const pin = resticPin[process.arch], arch = process.arch === 'x64' ? 'amd64' : 'arm64';
  const response = await fetch(`https://github.com/restic/restic/releases/download/v${resticPin.version}/restic_${resticPin.version}_linux_${arch}.bz2`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error('Restic archive unavailable.');
  const compressed = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(compressed).digest('hex') !== pin.archive) throw Error('Restic archive checksum differs.');
  const binary = execFileSync('bzip2', ['-dc'], { input: compressed, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 ** 2 });
  if (createHash('sha256').update(binary).digest('hex') !== pin.binary) throw Error('Restic binary checksum differs.');
  const scratch = await mkdtemp('/usr/local/bin/.restic-install-');
  try {
    const file = path.join(scratch, 'restic'); await writeFile(file, binary, { flag: 'wx', mode: 0o755 });
    await chmod(file, 0o755); await rename(file, '/usr/local/bin/restic');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await installRestic(); process.stdout.write('Pinned restic installed.\n'); }
  catch { process.stderr.write('Restic installation refused.\n'); process.exitCode = 1; }
}
