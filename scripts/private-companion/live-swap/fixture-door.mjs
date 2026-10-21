import { readFile } from 'node:fs/promises';
import { createFrontDoor } from './front-door.mjs';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const door = await createFrontDoor(config), stopControl = await door.control(config.control);
process.send?.({ booted: true });
process.on('disconnect', () => { void stopControl().then(() => door.close()).finally(() => process.exit()); });
process.on('message', message => { if (message === 'stop') void stopControl().then(() => door.close()).finally(() => process.exit()); });
