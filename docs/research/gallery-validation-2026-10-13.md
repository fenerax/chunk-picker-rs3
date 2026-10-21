# Gallery validation · October 13, 2026

The admin-only gallery contains 88 entries. Its catalogue, fixture adapter,
throwing write seams and coverage checklist are documented in
[gallery.md](../gallery.md). The picker stylesheet, normal entrypoint,
Area check and place-label modules were not edited.

## Measured screenshot run

```powershell
npm run screens -- --compare 38d93347d0
```

Source revision: `a6d76af929`, with a clean working tree when capture began.
Output: `.local/screens/a6d76af929/index.html`, `compare.html` and `report.json`.

- 542 PNGs: 490 gallery shots and 52 copied-save shots. The base matrix is
  88 gallery entries plus seven native surfaces, each at desktop 1440 × 900
  and phone 390 × 844, in dark and light. Another 162 images page long content.
- Elapsed after acquiring the light lock: **209,880 ms (3 min 30 sec)**,
  including comparison and cleanup. The shared-lock wait is excluded.
- Sampled peak process-tree working set: **5,803,929,600 bytes (5,535 MiB)**,
  from 79 samples; peak process count 24. This includes the runner, server
  workers, Chrome children and sampler. Shared pages can be counted twice,
  and short peaks between samples can be missed.
- One scratch server and one disposable Chrome browser were used. Both were
  stopped, and the scratch save/profile directory was removed. A subsequent
  process/path check found no owned Node/Chrome processes or scratch directories.
- Gallery API/write requests: **0**. Clicking a real task checkbox verified
  the throwing stub and checkbox rollback. The copied `state.json` remained
  byte-for-byte unchanged. The original save was only read for its copy.
- Comparison with the preceding complete album: 13 changed, 529 unchanged,
  zero new and zero missing. **Every gallery image matched.** All changed shots
  were native copied-save scenes; inspected examples include duo tasks updating
  versus settled results. Native scenes also depend on terrain readiness and
  real-time labels. The browser verified a rendered difference canvas.

Earlier validation used a synthetic one-pixel baseline with one paired and one
retired filename to exercise changed dimensions, new and missing browser views.
That baseline was a tool check, not a prior UI version. A run made alongside the
full suite took 7 min 8 sec; the measured run above followed its completion.
Reusing fixture documents and skipping byte-identical lossless comparison PNGs
keeps the complete review within a few minutes on this machine.

## Tests

- Final `npm run test:quick`: **1,173 passed**, zero failures (44,645 ms).
- Full suite, run once under `.local/with-heavy.ps1`: **3,845 tests;
  3,844 passed, one skipped, zero failures** (636,894 ms).
- The full suite ran on `38d93347d0`. The only later implementation change
  skips decoding byte-identical comparison files; its 12 focused screenshot
  tests and the final quick suite passed. Different PNG encodings of identical
  pixels are covered, and still use the pixel comparison path.
- Gallery tests exercise admin/player/viewer access, authorization before asset
  revalidation, write denial, fixture independence and deliberate coverage gaps.
  All three new test files are classified in `scripts/test-selection.mjs`.

## Observations for the next visual pass

- Claim, edit and blocker details make task rows noticeably taller and uneven.
- Disabled Undo text is faint against the dark toolbar.
- The phone toolbar needs sideways scrolling to reach its later controls.
- Settings → Map has a large unused lower area compared with Rules and History.

These observations were not fixed. The scratch server can also show a prominent
backup-configuration warning; that is not evidence of a live backup problem.

## Coverage limits

Explicit gallery exclusions are Chrome's native re-lock confirmation, the
post-save Members success response, and a separate empty tool-dialog host.
The real Completed Tasks renderer is covered with fixtures; its full copied-save
calculation is omitted from this light run. Gallery coverage represents component
families, not every gameplay permutation or every expanded nested disclosure.

The six-page limit left overflow in copied-save Search (four variants), phone
History (two), and the phone Stickers editor (two). The index and JSON report
show their remaining pixels. Those repeated long lists can still be reviewed
interactively. Main screenshots wait for loaded tasks and drawn terrain, but
do not wait for all advisory/duo calculations or high-resolution tile queues;
their differences need review alongside the stable fixture images.
