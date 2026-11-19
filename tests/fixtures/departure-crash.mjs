import { inviteFixture } from '../helpers/owner-invite-fixture.mjs';
const [root, seam, args, action = 'leave'] = JSON.parse(process.argv[2]);
const f = await inviteFixture(root, { crashPoint(name) { if (name === seam) process.exit(86); } });
if (action === 'join') await f.service.accept(...args);
else await f.departures.depart(...args);
await f.close();
