import { openRegistry } from '../../app/storage/registry.mjs';

const [options, step] = process.argv.slice(2);
// Parent ownership also covers an aborted test runner. No timer or natural-exit
// assumption: the IPC connection keeps this checkpoint alive until termination.
process.on('disconnect', () => process.exit(2));
const registry = await openRegistry({ ...JSON.parse(options), async crashPoint(name, context) {
  if (name !== step) return;
  await new Promise((resolve, reject) => process.send({ step: name, pickerId: context.pickerId }, error => error ? reject(error) : resolve()));
  await new Promise(() => {});
} });
await registry.firstLogin('discord', 'synthetic-crash');
throw new Error('Synthetic crash checkpoint was not reached.');
