import { readFile } from 'node:fs/promises';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { posix as path } from 'node:path';

export async function scopedCgroup({ platform = process.platform, read = readFile,
  parallelism = availableParallelism, logicalCpus = () => cpus().length, memory = totalmem } = {}) {
  if (platform !== 'linux') return {};
  const membership = (await read('/proc/self/cgroup', 'utf8')).split('\n').map(line => line.split(':'))
    .find(([hierarchy, controllers]) => hierarchy === '0' && controllers === '')?.slice(2).join(':');
  if (membership === undefined) return { version: 'unavailable' };
  const base = path.resolve('/sys/fs/cgroup', '.' + membership);
  if (base !== '/sys/fs/cgroup' && !base.startsWith('/sys/fs/cgroup/')) throw new Error('Invalid cgroup membership.');
  // availableParallelism reflects scheduler affinity, unlike the host CPU list.
  const values = { version: 2, affinityCpuCores: parallelism(), effectiveMemoryBytes: memory() };
  values.effectiveCpuCores = Math.min(values.affinityCpuCores, logicalCpus());
  for (const name of ['cpu.max', 'memory.max', 'memory.current', 'memory.peak', 'memory.swap.current'])
    try { values[name] = (await read(path.join(base, name), 'utf8')).trim(); } catch { values[name] = null; }
  for (let directory = base; directory.startsWith('/sys/fs/cgroup'); directory = path.dirname(directory)) {
    try {
      const [quota, period] = (await read(path.join(directory, 'cpu.max'), 'utf8')).trim().split(/\s+/).map(Number);
      if (Number.isFinite(quota) && period > 0) values.effectiveCpuCores = Math.min(values.effectiveCpuCores, quota / period);
    } catch {}
    try { const bytes = Number((await read(path.join(directory, 'memory.max'), 'utf8')).trim());
      if (Number.isFinite(bytes) && bytes > 0) values.effectiveMemoryBytes = Math.min(values.effectiveMemoryBytes, bytes); } catch {}
    if (directory === '/sys/fs/cgroup') break;
  }
  return values;
}
