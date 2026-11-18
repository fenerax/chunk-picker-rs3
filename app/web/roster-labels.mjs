// Display labels only. Keep saved filter IDs and wire projection names stable.
export const rosterLabel = members => members.length === 1 ? 'Solo' : members.length === 2 ? 'Duo' : 'Group';
export const playersLabel = members => members.length === 1 ? 'You' : members.length === 2 ? 'Both players' : 'All players';
export function taskOwnersLabel(members, memberIds) {
  if (members.length === 2 && memberIds.length === 2) return 'Both';
  return memberIds.map(id => members.find(member => member.id === id)?.name ?? id).join(', ');
}
