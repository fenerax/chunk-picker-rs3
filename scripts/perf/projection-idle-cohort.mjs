// Four ordinary calculator populations, started serially after memory admission.
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
const { values: args } = parseArgs({ options: { 'data-dir': { type: 'string' }, out: { type: 'string' }, minutes: { type: 'string', default: '180' } } });
const children = new Set();
try {
  if (!args.out?.startsWith('/tmp/') || !args['data-dir']?.startsWith('/tmp/')) throw Error('OptionsError');
  await mkdir(args.out, { recursive: true });
  const exits = [];
  for (const [population, mode] of [['preview','0'],['preview','1'],['mixed','1'],['mixed','0']]) {
    const limit = Number((await readFile('/sys/fs/cgroup/memory.max','utf8')).trim());
    const used = Number(await readFile('/sys/fs/cgroup/memory.current','utf8'));
    if (!(limit-used >= 4*1024**3)) throw Error('MemoryAdmissionError');
    const file = args.out + '/' + population + '-' + mode + '.json', trace = args.out + '/startup-' + population + '-' + mode;
    await mkdir(trace, { recursive: true });
    const argv = ['--expose-gc', '--import', new URL('./projection-idle.mjs', import.meta.url).href,
      ...(population === 'mixed' ? ['--import', new URL('./profile-stack/bootstrap.mjs', import.meta.url).href] : []),
      fileURLToPath(new URL(population === 'preview' ? './preview-engine.mjs' : './hotspots-engine.mjs', import.meta.url)),
      '--trial', '--data-dir', args['data-dir'], ...(population === 'mixed' ? ['--result-hashes'] : [])];
    const child = spawn(process.execPath, argv, { env: { ...process.env, RS3_FINAL_PROJECTION: mode, RS3_IDLE_REPORT: file,
      RS3_IDLE_MINUTES: args.minutes, RS3_PROFILE: '1', RS3_PROFILE_DIR: trace, RS3_ENGINE_PROFILE_PROBE: '0', RS3_ENGINE_HEAP_PROFILE: '0' }, stdio: ['ignore','ignore','inherit'] });
    children.add(child); let ended;
    const exit = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',code => { ended=code;children.delete(child);resolve(code); }); });
    exits.push(exit);
    while (true) {
      if (ended !== undefined) throw Error('IdleChildError');
      try { const report = JSON.parse(await readFile(file,'utf8')); if (report.samples?.length) break; } catch(error) { if(error.code !== 'ENOENT') throw error; }
      await new Promise(r=>setTimeout(r,1000));
    }
    console.error(JSON.stringify({ started: exits.length, population, mode: Number(mode) }));
  }
  if ((await Promise.all(exits)).some(code=>code!==0)) throw Error('IdleChildError');
} catch(error) { for(const child of children)child.kill('SIGTERM');console.error(JSON.stringify({error:error.name}));process.exitCode=1; }
