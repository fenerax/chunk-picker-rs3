// Run later as root on the deployment/scratch machine. No account access.
// Optional --archive-file PATH installs an already downloaded, pinned .bz2.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resticPin } from '../linux/restic.mjs';
export async function installRestic({ platform = process.platform, arch: cpu = process.arch, uid = process.getuid?.(),
  archiveFile,
  fetchImpl = fetch, decompress = bytes => execFileSync('bzip2', ['-dc'], { input: bytes, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 ** 2 }),
  publish = async binary => {
    const scratch = await mkdtemp('/usr/local/bin/.restic-install-');
    try {
      const file = path.join(scratch, 'restic'); await writeFile(file, binary, { flag: 'wx', mode: 0o755 });
      await chmod(file, 0o755); await rename(file, '/usr/local/bin/restic');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }, pins = resticPin } = {}) {
  let category = 'platform';
  try {
    if (platform !== 'linux' || uid !== 0 || !pins[cpu]) throw Error();
    const pin = pins[cpu], arch = cpu === 'x64' ? 'amd64' : 'arm64';
    let compressed;
    if (archiveFile !== undefined) {
      category = 'archive read';
      compressed = await readFile(archiveFile);
    } else {
      category = 'download';
      const response = await fetchImpl(`https://github.com/restic/restic/releases/download/v${resticPin.version}/restic_${resticPin.version}_linux_${arch}.bz2`, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error('Restic archive unavailable.');
      compressed = Buffer.from(await response.arrayBuffer());
    }
    category = 'archive checksum';
    if (createHash('sha256').update(compressed).digest('hex') !== pin.archive) throw Error('Restic archive checksum differs.');
    category = 'decompress';
    const binary = decompress(compressed);
    category = 'binary checksum';
    if (createHash('sha256').update(binary).digest('hex') !== pin.binary) throw Error('Restic binary checksum differs.');
    category = 'install'; await publish(binary);
  } catch { throw Error('Restic installation refused: ' + category + '.'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'archive-file': { type: 'string' } } });
    await installRestic({ archiveFile: values['archive-file'] }); process.stdout.write('Pinned restic installed.\n');
  }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
