# Screenshot gallery and comparisons

Run from this worktree on the Windows desktop:

```powershell
npm run screens
npm run screens -- --compare abc1234567
npm run screens -- --compare C:\path\to\previous-screens
```

The npm command calls `scripts/screens.ps1`, which holds the existing
`.local/with-light.ps1` shared lock. It waits for one available browser session
and at least 3 GB free memory. It can coexist with the heavy lock, but uses one
scratch server and one disposable headless Chrome profile, sequentially. Run
`npm run screens -- --help` for options without taking a lock or launching either.
The usual explicit `.local/with-light.ps1 npm run screens` wrapper also works.
The command adopts an existing lock only when its owner is an ancestor process.

The default save source is the main repository's `.local/duo`, currently
`C:\Users\User\Projects\chunk-picker-rs3\.local\duo`. `--source PATH` selects
a different read-only snapshot. The runner copies it below this worktree's
`.local/screens/scratch-*`, excluding `store.lock`, `access-token`, invitation
and feedback files. It verifies `state.json` stayed stable during the copy,
uses fresh scratch credentials over IPC, and never prints invitation URLs,
tokens or save contents. Local map assets and game data are read from the main
repository. `--port` accepts only 9311–9319 (default 9311); live picker ports
are never used. `--chrome PATH` overrides Chrome discovery.

Every entry in `app/web/gallery-catalogue.mjs` is captured through the isolated
preview route, after its explicit readiness signal, fonts and visible images.
Capture mode builds a fresh fixture document for each entry, then reuses it for
the four appearances through the shipped preference and responsive layout helpers.
Scroll positions reset between variants. Settings → Map and floating sticker/colour
pickers use fresh documents for each variant to retain their control values and
focus-based positioning. Gallery captures use exact iframe CSS widths, without
mobile browser auto-fit shrinking an overflowing isolated component. A width
assertion checks every gallery shot; the copied main UI uses mobile emulation.
The gallery uses fixtures and shipped components. Main map, Tasks, More, Helper,
Search, Settings and History use the actual copied save and
the ordinary UI listeners. A display override on the read response supplies the
theme to the shipped theme helper and map renderer without saving a preference.
Gameplay fields and revision remain unchanged. Both sources use desktop 1440 × 900
and phone 390 × 844, in dark and light themes, at device scale 1.
Main readiness requires loaded tasks and a drawn terrain frame. It does not wait
for every advisory/duo calculation or high-resolution tile queue to become quiet.
These native scenes can differ while background results settle. The scratch server's backup
configuration can show an operational warning absent from the live picker.

Long dialogs retain their normal dimensions. The runner scrolls the largest
overflowing dialog container in overlapping viewport pages, up to six pages.
The index and JSON report state how many pixels remain after that limit. This
also pages long isolated gallery regions such as the task sidebar, so its pinned
and backlog examples remain reviewable below the fold. Ordinary copied-save map
screens retain their normal viewport.
This does not expand every nested list or capture every possible interactive state;
those states should receive dedicated catalogue entries when needed.
Only images inside the visible window and scroll clipping region delay a shot.
Each additional dialog page waits for newly visible images. Gallery captures
disable transitions through the external gallery stylesheet; main captures allow
short transitions to settle. The normal gallery retains its transitions.
Chrome uses its faster lossless PNG encoder; this trades larger files for less CPU
time and does not change the captured pixels.
Completed Tasks is captured through its real renderer with gallery fixtures.
Opening its full copied-save review requests both large detail calculations and
is outside this light review run. The full suite covers that integration.

Outputs are ignored files under `.local/screens/<10-character HEAD sha>/`:

- `index.html`: local thumbnail index, with links to full PNGs.
- `report.json`: captures, elapsed milliseconds and sampled peak process-tree
  working set. It marks uncommitted source changes explicitly.
- `gallery--<entry>--<theme>--<viewport>.png` and
  `main--<surface>--<theme>--<viewport>.png`: stable names. Overflow pages append
  `--page-2`, `--page-3`, etc.
- `compare.html`, when `--compare` is supplied: changed, new and missing images
  side by side, with browser canvas pixel differences.

The process-tree sampler includes the runner, server workers, Chrome renderer
and utility processes, and its own small monitoring process. It samples roughly
every two seconds; transient peaks between samples can be higher. Working-set
sums can count shared pages in more than one process. A normal run should finish
within a few minutes after acquiring the lock; first copied-save calculation
and the number of overflow pages determine the duration.

Comparisons match filenames, never capture order. PNG decoding uses Node's
built-in zlib for Chrome's non-interlaced 8-bit RGB/RGBA output; there are no npm
dependencies. Byte-identical lossless PNGs skip decoding; different encodings of
the same pixels still use the pixel model. The documented noise allowance ignores channel differences of
8 or less (0–255 scale), and treats an image as unchanged when at most 0.1% of
its pixels exceed that channel allowance. A dimension change always counts as
changed. Pink pixels in the canvas mark channel differences above 8; retained
pixels are gray. Date labels, changed copied-save data, fonts and map assets
may produce expected differences, so review the side-by-side images.

Comparison images are embedded as data URLs, so opening `compare.html` from
disk does not require a server or grant it access to the source save. Screenshots
of the main UI can contain the duo's personal game information; keep these
local outputs private unless you deliberately choose to share them.
Images decode lazily; difference canvases are built near the viewport and their
pixel buffers are released off screen. The runner verifies a difference canvas
in its existing browser when a comparison contains paired changed images.

Rerunning at the same HEAD replaces that SHA's current image set and removes
stale generated PNGs. To compare two uncommitted iterations at the same HEAD,
copy the first output directory elsewhere, then pass that copy to `--compare`.
The runner refuses to compare a directory with itself. Copy processes and the
Chrome profile are stopped before scratch deletion; if a process refuses to
stop, scratch is retained and the command fails, with that state in the report.

Focused verification, without a browser or save:

```powershell
node --test tests/screens-model.test.mjs
```

These tests cover safe stable filenames, filename pairing, noise boundaries,
Chrome PNG RGB/RGBA decoding through all five row filters, dimension changes,
and generated comparison pages. They do not establish visual correctness;
inspect the generated index and comparison after a browser run.

[Measured validation](research/gallery-validation-2026-10-13.md) records the
542-shot run, timing, memory, test results, exclusions and visual observations.
