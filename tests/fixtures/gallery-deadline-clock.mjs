import { mock } from 'node:test';

// The parent advances this only after the gallery acknowledges its owned child.
// The actual supervisor and process cleanup still execute in the child process.
mock.timers.enable({ apis: ['setTimeout'] });
process.on('message', message => {
  if (message === 'expire-gallery-deadline') mock.timers.tick(3000);
});
