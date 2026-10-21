// Isolated server entry. Keep private invitation/session data on IPC only.
if (!process.send || !process.env.RS3_SCREENS_SCRATCH) throw new Error('Launch through npm run screens.');
let application;
try {
  const port = Number(process.env.RS3_SCREENS_PORT);
  if (!Number.isInteger(port) || port < 9311 || port > 9319) throw new Error('Invalid scratch port.');
  const { createServer } = await import('../app/server.mjs');
  application = await createServer({ dataDir: process.env.RS3_SCREENS_SCRATCH, host: '127.0.0.1', port,
    loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false });
  await application.listen();
  process.send({ type: 'ready', inviteUrl: application.inviteUrl });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await application.close(); process.exit(0); };
  process.on('message', message => { if (message?.type === 'stop') void stop(); });
  process.once('disconnect', () => void stop());
} catch {
  process.send({ type: 'error' });
  await application?.close();
  process.exit(1);
}
