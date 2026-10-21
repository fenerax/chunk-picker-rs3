// Run a script that calls fetch directly with the shared Wiki client:
//   node --import ./scripts/lib/rs-wiki-preload.mjs scripts/<script>.mjs ...
// Its Wiki requests then get the project agent, serial spacing, maxlag and
// backoff; other hosts are untouched. Committed data records some scripts'
// bytes, so those use this preload instead of importing the client.
import path from 'node:path';
import { routeGlobalWikiFetch } from './rs-wiki-client.mjs';

const script = process.argv[1] ? path.basename(process.argv[1], '.mjs').replace(/[^\w.() -]/g, '-').slice(0, 80) : '';
routeGlobalWikiFetch({ tool: process.env.RS3_WIKI_TOOL || script || undefined });
