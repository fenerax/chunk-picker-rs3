// Bound open streams and collected metadata. A failed batch settles every
// admitted inspection before returning its first error, with no later reads.
export async function* checkedBatches(entries, inspect) {
  for (let offset = 0; offset < entries.length; offset += 3) {
    const results = await Promise.allSettled(entries.slice(offset, offset + 3).map(entry => Promise.resolve().then(() => inspect(entry))));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    for (const result of results) yield result.value;
  }
}
