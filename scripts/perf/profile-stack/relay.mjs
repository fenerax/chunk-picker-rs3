// Profile the process-worker relay isolate as well as its calculator thread.
// A runner-only preload inherited by owned fork/Worker children. It does not
// decode or copy gameplay messages and does nothing outside a relay main thread.
import { isMainThread } from 'node:worker_threads';
import path from 'node:path';
if (isMainThread && process.env.RS3_PROFILE === '1' && path.basename(process.argv[1] ?? '') === 'process-worker-host.mjs') {
  process.env.RS3_PROFILE_ROLE = 'relay';
  const profile = await import('../../../app/profile-spans.mjs');
  if (process.env.RS3_PROFILE_SCENARIO) await profile.control({ action: 'start', scenario: process.env.RS3_PROFILE_SCENARIO });
  let controls = Promise.resolve();
  process.on('message', message => {
    const data = message.kind === 'post' && message.payload?.data;
    if (!data?._rs3ProfileControl) return;
    controls = controls.then(async () => {
      await profile.control(data);
      // No shared buffers in a numeric acknowledgement; use the existing
      // advanced-IPC envelope without touching the gameplay relay handlers.
      process.send?.({ kind: 'message', payload: { data: { _rs3ProfileRelayReply: data._rs3ProfileControl }, shared: [], views: [] } });
    }).catch(() => {});
  });
}
