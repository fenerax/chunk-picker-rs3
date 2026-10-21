import { readFile } from 'node:fs/promises';
import { SwapController } from './controller.mjs';
import { connectFrontDoor } from './front-door.mjs';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
let serial = 0; const pending = new Map();
process.on('message', message => { const call = pending.get(message.id); if (call) { pending.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(Object.assign(new Error(message.error), { code: message.error })) : call.resolve(message.value); } });
const rpc = (method, argument) => new Promise((resolve, reject) => {
  const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Supervisor deadline: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer }); process.send({ id, method, argument });
});
const instance = (slot, identity) => ({ identity, ...Object.fromEntries(['observe', 'standby', 'freeze', 'close', 'activate', 'verify'].map(method => [method, argument => rpc(`${slot}.${method}`, argument)])) });
const managed = Object.fromEntries(['assertHeld', 'pause', 'assertStoreReleased', 'commit', 'unpause'].map(method => [method, argument => rpc(`managed.${method}`, argument)]));
managed.acquire = async () => { await rpc('managed.acquire'); return () => rpc('managed.release'); };
const frontDoor = await connectFrontDoor(config.control, config.token);
const controller = new SwapController({ journal: config.journal, dataDir: config.dataDir, old: instance('old', config.old), next: instance('next', config.next), frontDoor, managed, policy: { mode: 'verification' },
  onPhase: (phase, value) => rpc('phase', { phase, value }),
  onBoundary: (phase, value) => rpc('phase', { phase, value, boundary: true }),
});
try { const value = await controller[config.operation](); process.send({ done: true, value }); }
catch (error) { process.send({ done: true, error: error.code ?? error.message }); }
// Keep the controller lease until the supervisor explicitly ends this process.
process.on('disconnect', () => { frontDoor.disconnect(); process.exit(); });
