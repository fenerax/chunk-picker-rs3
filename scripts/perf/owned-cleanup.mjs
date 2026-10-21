// Delete disposable storage only after every owned process has stopped.
export async function afterOwnedChildrenStop(children, stop, cleanup) {
  const owned = [...new Set(children.filter(Boolean))];
  for (const child of owned) await stop(child);
  if (owned.some(child => child.pid && child.exitCode === null && child.signalCode === null)) {
    throw new Error('Owned process has not exited.');
  }
  return cleanup();
}
