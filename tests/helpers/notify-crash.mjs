// Fault injection stays in this disposable child; production has no kill hooks.
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const [controlDir, phase, failSend] = process.argv.slice(2), trace = [];
const state = path.join(controlDir, 'notify-state.json'), reset = path.join(controlDir, 'notify-reset.json');
const spool = path.join(controlDir, 'notify-spool'), counts = new Map();
let directoryLabel;
async function boundary(label) {
  trace.push(label);
  if (label !== phase) return;
  process.send({ boundary: label });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
const { open, rename, rm, appendFile } = fs.promises;
fs.promises.open = async (file, ...args) => {
  const handle = await open(file, ...args), name = String(file);
  const kind = name.startsWith(state + '.') && name.endsWith('.tmp') ? 'outbox'
    : name.startsWith(reset + '.') && name.endsWith('.tmp') ? 'intent' : null;
  if (kind) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const label = kind + ':' + counts.get(kind);
    await boundary(label + ':open');
    const write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle), close = handle.close.bind(handle);
    handle.writeFile = async bytes => {
      await write(bytes.slice(0, 5)); await boundary(label + ':partial');
      await write(bytes.slice(5)); await boundary(label + ':written');
    };
    handle.sync = async () => { await boundary(label + ':before-sync'); await sync(); await boundary(label + ':synced'); };
    handle.close = async () => { await close(); await boundary(label + ':closed'); };
  } else if (name === controlDir && args[0] === 'r' && directoryLabel) {
    const label = directoryLabel; directoryLabel = null;
    const sync = handle.sync.bind(handle);
    handle.sync = async () => { await boundary(label + ':before-directory-sync'); await sync(); await boundary(label + ':directory-synced'); };
  }
  return handle;
};
fs.promises.rename = async (from, to) => {
  const target = String(to);
  const kind = target === state ? 'outbox' : target === reset ? 'intent' : null;
  const label = kind ? kind + ':' + counts.get(kind)
    : target.includes('.reset-') ? 'quarantine'
    : target.startsWith(spool + path.sep) && target.endsWith('.claimed') ? 'claim' : null;
  if (label) await boundary(label + ':before-rename');
  const result = await rename(from, to);
  if (kind) directoryLabel = label;
  if (label) await boundary(label + ':renamed');
  return result;
};
fs.promises.rm = async (file, ...args) => {
  const name = String(file);
  const kind = name === reset ? 'ack-intent' : name.startsWith(spool + path.sep) && name.endsWith('.claimed') ? 'ack-mailbox' : null;
  if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const label = kind ? kind + ':' + counts.get(kind) : null;
  if (label) await boundary(label + ':before-unlink');
  const result = await rm(file, ...args);
  if (label) await boundary(label + ':unlinked');
  return result;
};
syncBuiltinESMExports();
const { notify } = await import('../../scripts/linux/notify.mjs');
await notify({ controlDir, faults: {}, merge: true, now: Date.parse('2026-11-05T12:00:00Z'), send: async text => {
  await boundary('send:before');
  if (failSend === 'true') throw Error('Synthetic offline receiver');
  await appendFile(path.join(controlDir, 'delivered.log'), text + '\n');
  await boundary('send:accepted');
} });
process.send({ trace });
process.disconnect();
