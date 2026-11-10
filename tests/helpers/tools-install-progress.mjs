let sequence = 0;
export async function step(label, action) {
  const id = ++sequence;
  process.stderr.write(`tools step ${id}: ${label}\n`);
  const result = await action();
  process.stderr.write(`tools step ${id}: complete\n`);
  return result;
}
