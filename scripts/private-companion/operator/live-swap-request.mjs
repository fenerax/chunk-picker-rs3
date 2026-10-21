import { loadTopology, runtimeCall } from '../live-swap/managed-runtime.mjs';
import { failure } from '../live-swap/journal.mjs';
const [file, hash, method] = process.argv.slice(2);
if (!['status', 'swap', 'recover'].includes(method)) throw failure('LIVE_SWAP_REQUEST_METHOD');
try {
  const topology = await loadTopology(file, hash);
  const result = await runtimeCall(topology.coordinator.controlPipe, topology.controlToken, { kind: 'coordinator', topologyHash: hash }, method);
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write('LIVE_SWAP_REQUEST_REFUSED\n'); process.exitCode = 1;
}
