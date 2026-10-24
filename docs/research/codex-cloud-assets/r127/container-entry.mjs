// Controller for the existing Docker envelope; source/application files stay read-only.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseContext } from './portable-context.mjs';
import { stage, publicCase, writeCase } from './component-protocol.mjs';
parseContext(process.argv.slice(2));
if (process.version !== 'v24.19.0' || process.execPath !== '/runtime/node') throw new Error('pinned-node-version-required');
stage('start');
const child = spawn(process.execPath, ['--max-old-space-size=4096', new URL('./full-public-component.r127.mjs', import.meta.url).pathname, ...process.argv.slice(2)], {
  cwd: '/scratch', env: { ...process.env }, stdio: ['ignore', 'inherit', 'inherit', 3],
});
let deadline = false, forced;
const stop = () => { deadline = true; child.kill('SIGTERM'); forced = setTimeout(() => child.kill('SIGKILL'), 3000); };
const timer = setTimeout(stop, 208000);
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const outcome = await new Promise(resolve => { child.once('error', () => resolve({ code: 1 })); child.once('close', (code, signal) => resolve({ code, signal })); });
clearTimeout(timer); clearTimeout(forced);
if (outcome.code === 124) deadline = true;
if (!existsSync('/scratch/case-result.json')) {
  stage('error');
  await writeCase(publicCase({ failureCode: deadline ? 'controller-deadline' : 'child-failed' }));
}
// Exit is recorded independently from component validity by the envelope.
process.exitCode = !deadline && outcome.code === 0 && !outcome.signal ? 0 : 1;
