# Private usage counts

The picker counts which windows and controls people use to help Player 1 decide
where to put them. Counts stay on this picker and are only seen by the
administrator. There is no analytics service or third-party destination.

## What is recorded

Each stored row has only a fixed UI event id, person, device class, UTC day and
count. Dialogs, dock panels, the picker page and Helper sections count opens;
top bar, map toolbar, phone tabs and task sidebar controls count uses. A committed
change in a text or search control counts using that control; individual
keystrokes do not generate counts.
Repeated task and goal controls count as UI families rather than specific tasks.
The fixed catalogue is `app/web/usage-catalogue.mjs`, using the ids from
`docs/research/ui-map-2026-10-13.json` where possible. Other task list controls
share one fallback family, and unrecognised tool titles share a tool-dialog family.

No free text, queries, chunk ids, task or item names, goal text, URLs, invitation
tokens or typed values are recorded. An event id such as `tasks:row-name` means
the task-details button family; it contains no task name. There are no individual
event records, session identifiers, precise times or device identifiers in the
usage file. OBS overlay pages and the gallery do not run the counter. Managing
OBS links in the main picker is an ordinary tool dialog.

The server determines the person from the authenticated invitation. A linked
player or administrator counts under that member id. The private master link
and unlinked invitations count under the first member, normally Player 1. Link
Player 2's invitation to Player 2 in **Admin → Invite links** for correct attribution.
Changing the displayed map does not change the person being counted. View-only
invitations count under `viewer`, together, rather than a named person.

A phone is any viewport under 768 pixels wide; everything else is desktop.
Resizing may put counts from one browser in both classes. Days use UTC, including
the current partial day.

## Turn counting off

Open **More → Settings → Panels** and switch off **Count which windows I use**.
You can also find it by searching Settings for “count”. It is on by default and
remembered separately in each browser/device. View-only users have the same
switch under **More → Usage settings**, without gameplay editing controls.

Turning it off immediately stops collection and discards unsent counts; it does
not remove counts already delivered. A request already in flight can still finish.
Turning it on resumes from that point. The choice also applies to other tabs on
the same origin. If browser storage is blocked or cleared, the default is on again.

## View and export

Administrators can open **Admin → Usage**. Choose a person, the last 7 or 30 UTC
days, and phone, desktop or both. The table lists the 30 highest counts and shows
both device totals. **No counts in this period** lists the registered UI families
with zero counts for the chosen person/device/period. A zero may mean counting
was off, the control was unavailable, or the feature has only just been installed;
it does not prove that the person has never used it.

**Export JSON** downloads all retained daily aggregate rows, for every person and
both device classes. It contains the same five fields as the usage file, with a
schema version. Usage is not included in gameplay exports or backups.

## Storage and deletion

Usage lives in `usage.json` next to `state.json`, normally
`.local/duo/usage.json`, or the directory supplied with `--data-dir`. The server
keeps today and the previous 179 UTC days. Older rows are pruned when it opens,
reads or writes usage. It queues atomic writes to this sidecar; it never changes
the save revision, History, Undo, live gameplay sync or gameplay backups.

To delete all counts, stop the picker, delete only `usage.json` in its save
directory, then restart. Leave `state.json` and the other save files in place.
A new usage file is created when an enabled device next sends counts. Turn the
switch off on each device first if you want counting to stay off. Delete any
downloaded usage JSON exports separately if you want to remove those copies too.

## Delivery and limits

One delegated control handler and shared dialog/panel hooks feed a bounded
memory buffer. The client sends aggregate counts to same-origin `POST /api/usage`
about every 60 seconds and uses `sendBeacon` on `pagehide`, falling back to a
keepalive request if the beacon cannot be queued. The existing CSP is
unchanged. The endpoint requires a valid picker session; only administrators can
read `GET /api/usage`. Its viewer POST exception grants no gameplay permissions.

The server accepts only catalogue ids, known member/viewer actors, phone/desktop,
valid retained UTC days and integer increments from 1 to 1,000. Payloads allow at
most 200 rows and 32 KiB, with no extra fields. Admission is limited to 12 POSTs
per minute per invitation and 600 globally, with bounded identity buckets.
The server overwrites the actor with the authenticated person.

These are practical usage counts. A failed connection or rejected beacon can
lose unsent counts. Retries after a lost acknowledgement can duplicate increments.
The buffer caps each increment at 1,000 and keeps at most 200 daily buckets.
It adds no persistent client queue or individual delivery identifiers.
