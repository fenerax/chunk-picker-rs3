import { acquireProcessGuard } from '../../app/storage/process-guard.mjs';
try {
  const release = await acquireProcessGuard(process.argv[2]); await release();
  process.send?.({ acquired: true });
} catch (error) { process.send?.({ acquired: false, message: error.message }); }
if (process.connected) process.disconnect();
