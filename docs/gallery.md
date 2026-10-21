# Picker component gallery

Administrators can open `/gallery` with the same cookie used for the picker.
Player, viewer and unauthenticated requests get 404, including the preview and
fixture assets. Open it from **Admin → Component gallery** in the picker top bar
or the phone More tab. Admin also holds Invite links, OBS overlays and Usage.

The section index selects one sample at a time, keeping one iframe resident.
Each anchor has a stable ID, a source-module label and a real renderer. The
top controls select all ten existing themes and 1440, 768 or 390 px preview
widths. Samples use the shipped `index.html` shell and existing CSS/modules;
the preview replaces only `main.mjs`. It never initializes live command,
startup or subscription factories. A visible “Not saved: gallery” note stays
inside open dialogs too.

`app/web/gallery-catalogue.mjs` owns the sample list. `gallery-fixtures.mjs`
returns independent copies of the synthetic data in `gallery-fixture-data.json`
and in-memory endpoint responses. The fixture adapter does not fetch save data.
An original-sync preview is a local sample response, never a web fetch. Save,
command, RuneMetrics apply, upload and download seams throw. The preview also
blocks API fetches, XHR, event streams, sockets, beacons, browser-storage writes,
native form navigation and download links. Artwork GETs remain available.
The server also rejects API requests whose referrer is a gallery page.
No new package dependencies are used.

Usage has counting-on, counting-off and view-only Settings shortcut samples,
plus typical counts, no counts yet and Player 2-filtered count samples. Its fixture
contains invented daily totals for 36 registered windows, both players, viewers
and unlinked invites. The preview uses an in-memory counting preference and the
fixed gallery clock without starting tracking listeners or timers. `/api/usage`
is answered by the fixture adapter; real API requests and exports stay blocked.

To regenerate the small model/result fixture from the current serializers:

```powershell
node scripts/build-gallery-fixtures.mjs
```

This writes only the gallery JSON. It builds two synthetic players and a tiny
definition set, without opening storage or reading `.local/duo`. The clock in
previews is fixed at noon UTC on October 13, 2026 so claim ages and recent-roll
labels stay stable between captures. Main copied-save screenshots use real time.

Coverage combines three checks:

- The dated UI map supplies every dialog and main-screen region, panel, toolbar
  and banner ID. This preserves the agreed review checklist and visibility gates.
- Current shell markup supplies IDs on sections, dialogs, menus and main regions.
  A newly authored region fails even before the UI map is refreshed.
- Current `app/web/*.mjs` sources supply `openDialog(...)` title registrations,
  including dynamic title expressions. `gallery-dialog-coverage.json` records
  their reviewed sample IDs or an explicit reason. A new title in an existing
  module fails; module-level coverage alone cannot hide it. Titles are more stable
  than line numbers, and broader exported create/render functions include many
  nonvisual controllers that would make this checklist noisy.

The check also rejects removed sample references, retired registrations, duplicate
IDs and exclusions without reasons. Its tests deliberately add a dialog to an
already-covered module and a new shell panel, and remove an existing sample.
Registration extraction is a conservative lexical check of this repository's
ordinary literal/template title calls, not a general JavaScript parser. A new
dialog host/registration API would need to extend the scanner.

The deliberate exclusions are Chrome’s native re-lock confirmation (browser
chrome), the post-save “Members starts” response (requires a committed command),
and a separate empty `#tool-dialog` entry (the shared host appears in all dialog
samples). Partner Undo and coordination banners use synthetic attribution data.
Repeated rows, every rule disclosure, every map layer and all gameplay combinations
are represented by their host families; this is not exhaustive permutation coverage.
Long lists and deeply nested disclosures can need additional dedicated entries.

[Screenshot capture and comparison](gallery-screens.md) documents `npm run screens`,
stable filenames, the lock, noise threshold, memory sampling and cleanup.
