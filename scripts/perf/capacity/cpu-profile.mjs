import path from 'node:path';

export const cpuProfileManifest = enabled => ({ enabled: enabled === true, directory: enabled ? 'cpu-profiles' : null,
  scope: enabled ? 'server and calculator host processes; calculator Worker isolates are not captured' : 'disabled' });
export const cpuProfileExecArgv = (enabled, directory, mode) => enabled && mode === 'server'
  ? ['--cpu-prof', `--cpu-prof-dir=${path.join(directory, 'cpu-profiles')}`] : [];
