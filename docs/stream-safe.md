# Stream-safe mode and feedback

Turn **Stream-safe mode** on in **More** or **Settings → Panels**. Both switches
use the same preference in this browser, including its other open picker tabs.
A **Stream-safe** indicator stays beside the picker title while it is on.

New invite links appear as a masked field. **Copy link** copies the real link
without displaying it. **Show** opens a warning; **Show link** confirms revealing
it. Player and administrator invitations warn that anyone who sees the link can
edit the save. Viewer invitations explain their view access. Turning the mode on
again hides a revealed link. Closing the invite dialog clears its link.

Feedback sender names and optional technical context are hidden while the mode
is on. Invitation paths in feedback are already redacted by the server. The
mode covers private access links and feedback names; map names and History keep
their normal display.

Joining through `/join/<token>` establishes an HttpOnly session cookie and
redirects to `/`. After a successful session check, stream-safe mode also removes
leftover invitation paths or token query/fragment fields with `replaceState`.
Ordinary map query parameters and fragments are retained. Browser storage being
unavailable leaves the switch usable for the current page.

The owner's **Feedback** button shows the count of notes she has not opened.
Opening the list marks displayed notes seen; handled notes hidden by the filter
stay unread until **Show handled** displays them. New arrivals keep their badge.
Authors can open **Your feedback** and see **Handled** on finished notes.
View-only invitations have no feedback badge or controls.

Seen IDs live in `feedback.json` beside the save, outside gameplay revisions,
History, Undo and gameplay backups. Linked invitations share the player's seen
state across devices. The private master link uses the first map's owner identity,
so it shares seen state with that owner's linked administrator invitation.
Unlinked invitations keep their own identity. Counts and an open list refresh
when returning to the tab and once per minute while it is visible.
