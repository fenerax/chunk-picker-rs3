// Keep API requirement evidence available to the personal travel panel.
export function projectTeleportRoute(row, world) {
  return {
    id: row.id, name: row.name, group: row.group ?? 'transport',
    kind: row.kind, cost: row.cost, unmet: row.unmet, unknown: row.unknown,
    available: row.global ? (row.rollAvailable ?? row.available) : row.available,
    reason: (row.global ? row.rollReason : row.reason) ?? row.reason ?? 'Travel evidence unresolved',
    reasons: (row.global ? row.rollReasons : row.reasons) ?? row.reasons ?? [],
    accessAvailable: row.available, accessReason: row.reason,
    rollOnly: !!(row.global && row.rollAvailable && !row.available),
    destination: row.rollDestination?.chunkId ?? row.destination ?? row.to?.split('-')[0] ?? '',
    destinationName: world.chunks.get(row.rollDestination?.chunkId ?? row.destination)?.name ?? row.destinationName ?? '', estimated: !!row.estimated,
    override: row.override ?? null, pending: !!row.pending,
    provenance: row.provenance, endpointEvidence: row.endpointEvidence,
  };
}

