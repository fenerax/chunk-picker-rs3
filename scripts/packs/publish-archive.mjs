// Small, deterministic USTAR/gzip transport. No extraction to the input tree.
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const fail = category => Object.assign(new Error(`Publish refused (${category}).`), { category });
export const relativeName = name => typeof name === 'string' && name.length > 0 && !/[\\:\x00-\x1f]/.test(name)
  && name.split('/').every(part => part && part !== '.' && part !== '..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function header(name, size) {
  const bytes = Buffer.alloc(512);
  let prefix = '', leaf = name;
  if (Buffer.byteLength(leaf) > 100) {
    const positions = [...name.matchAll(/\//g)].map(match => match.index).reverse();
    const split = positions.find(index => Buffer.byteLength(name.slice(0, index)) <= 155 && Buffer.byteLength(name.slice(index + 1)) <= 100);
    if (split === undefined) throw fail('archive-path-length');
    prefix = name.slice(0, split); leaf = name.slice(split + 1);
  }
  const put = (value, offset, length) => bytes.write(value, offset, length, 'utf8');
  const octal = (value, offset, length) => {
    const text = value.toString(8);
    if (text.length >= length) throw fail('archive-size');
    put(text.padStart(length - 1, '0') + '\0', offset, length);
  };
  put(leaf, 0, 100); octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
  octal(size, 124, 12); octal(0, 136, 12); bytes.fill(32, 148, 156); bytes[156] = 48;
  put('ustar\0', 257, 6); put('00', 263, 2); put(prefix, 345, 155);
  const sum = bytes.reduce((total, byte) => total + byte, 0);
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return bytes;
}

// Each record's digest comes from the preceding scan. A changed input aborts.
export async function writeArchive(destination, records) {
  async function* parts() {
    for (const record of records) {
      yield header(record.name, record.bytes);
      const hash = createHash('sha256'); let count = 0;
      for await (const bytes of createReadStream(record.source)) {
        count += bytes.length; hash.update(bytes); yield bytes;
      }
      if (count !== record.bytes || hash.digest('hex') !== record.sha256) throw fail('input-changed');
      const padding = (512 - count % 512) % 512;
      if (padding) yield Buffer.alloc(padding);
    }
    yield Buffer.alloc(1024);
  }
  await pipeline(Readable.from(parts()), createGzip({ level: 6 }), typeof destination === 'string' ? createWriteStream(destination, { flags: 'wx' }) : destination);
}

// Accept ordinary USTAR regular files/directories only. PAX, links, devices,
// sparse files and ambiguous paths are refused rather than extracted by tar.
export async function visitArchive(source, visit) {
  const input = createReadStream(source), unzip = createGunzip();
  input.on('error', error => unzip.destroy(error)); input.pipe(unzip);
  const iterator = unzip[Symbol.asyncIterator](); let pending = Buffer.alloc(0), ended = false, expanded = 0;
  async function take(count) {
    const chunks = []; let size = 0;
    while (size < count) {
      if (!pending.length && !ended) {
        const item = await iterator.next(); ended = !!item.done;
        if (!ended) pending = item.value;
      }
      if (!pending.length) break;
      const amount = Math.min(count - size, pending.length);
      expanded += amount;
      if (expanded > 1024 ** 3) throw fail('archive-limit');
      chunks.push(pending.subarray(0, amount)); pending = pending.subarray(amount); size += amount;
    }
    return Buffer.concat(chunks, size);
  }
  const text = (bytes, start, length) => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + length)).split('\0')[0];
  const number = (bytes, start, length) => {
    const value = text(bytes, start, length).trim();
    if (!/^[0-7]+$/.test(value)) throw fail('archive-header');
    const result = parseInt(value, 8);
    if (!Number.isSafeInteger(result)) throw fail('archive-size');
    return result;
  };
  try {
    let total = 0, members = 0, zeroBlocks = 0;
    while (true) {
      const block = await take(512);
      if (!block.length) { if (zeroBlocks < 2) throw fail('archive-truncated'); break; }
      if (block.length !== 512) throw fail('archive-truncated');
      if (block.every(byte => byte === 0)) { zeroBlocks++; continue; }
      if (zeroBlocks) throw fail('archive-trailer');
      const checksum = number(block, 148, 8), copy = Buffer.from(block); copy.fill(32, 148, 156);
      if (copy.reduce((sum, byte) => sum + byte, 0) !== checksum || text(block, 257, 6) !== 'ustar') throw fail('archive-header');
      const leaf = text(block, 0, 100), prefix = text(block, 345, 155);
      let name = prefix ? `${prefix}/${leaf}` : leaf;
      const type = block[156], directory = type === 53;
      if (directory) name = name.replace(/\/$/, '');
      if (!relativeName(name) || ![0, 48, 53].includes(type)) throw fail('archive-entry');
      const size = number(block, 124, 12);
      if ((directory && size) || size > 512 * 1024 ** 2 || (total += size) > 1024 ** 3 || ++members > 50000) throw fail('archive-limit');
      let remaining = size;
      async function* body() {
        while (remaining) {
          const bytes = await take(Math.min(remaining, 256 * 1024));
          if (!bytes.length) throw fail('archive-truncated');
          remaining -= bytes.length; yield bytes;
        }
      }
      await visit({ name, directory, header: block, bytes: size }, body());
      if (remaining) throw fail('archive-unconsumed');
      const padding = await take((512 - size % 512) % 512);
      if (padding.length !== (512 - size % 512) % 512 || padding.some(byte => byte !== 0)) throw fail('archive-padding');
    }
  } finally { input.destroy(); unzip.destroy(); }
}
