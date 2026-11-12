// Boundary and restart samples remain in the totals, but cannot establish a
// measured verdict. A missing/stale receipt cannot prove a server generation.
export const sampleCounts = () => ({ verified: 0, unverified: 0, mismatched: 0,
  measured: { verified: 0, unverified: 0, mismatched: 0 } });

export function countSample(counts, row, status) {
  const key = status === 'pass' ? 'verified' : status === 'fail' ? 'mismatched' : 'unverified';
  counts[key]++;
  if (row.measured === true) counts.measured[key]++;
}

export const sampleReceiptStatus = (row, source) => {
  const server = row.server, receipt = server?.[`${source}Observation`];
  if (!server?.[source] || !receipt) return 'unverified';
  return receipt.serverId === server.serverId && receipt.generation === row.generation ? 'pass' : 'fail';
};

export const sampleCountsMarkdown = (name, counts) =>
  `${name} samples: ${counts.verified} verified; ${counts.unverified} lacked evidence. ` +
  `Measured: ${counts.measured.verified} verified; ${counts.measured.unverified} lacked evidence.\n\n`;
