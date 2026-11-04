import { readFile } from 'node:fs/promises';

export async function cgroupSpareMemory(read = readFile) {
  const limit = (await read('/sys/fs/cgroup/memory.max', 'utf8')).trim();
  if (limit === 'max') {
    const memory = await read('/proc/meminfo', 'utf8');
    return Number(/^MemAvailable:\s+(\d+)/m.exec(memory)?.[1]) * 1024;
  }
  return Number(limit) - Number(await read('/sys/fs/cgroup/memory.current', 'utf8'));
}
