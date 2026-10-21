# Calmer, more consistent look · October 13, 2026

The map, task sidebar, toolbar groups, phone tabs and dialog regions keep their
existing positions. No gameplay, persistence, authorization, theme palette or
command behaviour changed. The only JavaScript edit replaces the sticker
search's literal `16px` with an exact-value token.

## Commits and inventory

- Baseline: `30233a6314`.
- Part A: `e68ce60621`, exact token extraction and documentation.
- Part B: `b4c7521`, consistent type, spacing, line heights and control radii.
- Part B: `ac19408c85`, calmer details, readable Undo and content-sized Settings.

[Design tokens](../design-tokens.md) documents the six recommended type sizes,
seven spacing steps, colour roles, font stacks, weights, line heights, radii,
borders and shadows. [The original inventory](../design-token-inventory.tsv)
records 2,621 CSS declarations across all 36 authored stylesheets, plus theme
palette setters and CSS-in-JS assignments. Vendored/reference styles are excluded.
Theme values, user colours and calculated map/position geometry retain their
existing authority. The independent transparent OBS sheet retains its appearance.

Part A introduced exact compatibility values alongside the small public scale.
Replacing only introduced references with their values reconstructed all 36
original stylesheets byte for byte. Font registration names stay literal.
Part B migrated 1,148 near-duplicate references and removed unused compatibility
definitions; the remaining 191 extracted values include specialised map, OBS,
gallery and status values, not 191 recommended scale steps.

## Part B changes

- Headings, labels, help, buttons and chips share the core type and spacing scales.
- Control radii and line heights use a consistent scale.
- Task claim and edit actions share compact spacing and a 24px desktop action height; phone targets remain 44px.
- Disabled toolbar text uses full opacity and a readable panel foreground.
- The phone toolbar uses smaller gaps and padding without shrinking touch targets.
- Settings grows to its content instead of reserving a 520px work area.
- Routine task headings, skill badges and training options use fewer accent colours.
- Toolbar groups, task filter chips and method choices lose redundant borders.

Task details stay visible and wrap when needed; rows with more information still
need more height. The phone toolbar still scrolls sideways: its existing control
groups cannot all fit at 390px while retaining 44px targets. Regrouping remains
for the later layout job. Map colours, ownership/travel cues and user-selected
sticker/completion colours remain unchanged.

## Part A screenshot comparison

Both runs used `npm run screens` under the shared light lock, one scratch server
and one disposable Chrome session per run. The baseline and Part A each contain
544 images: 476 gallery fixture images and 68 copied-save images, including long
dialog pages, at 1440 × 900 and 390 × 844 in dark and light.

- Baseline: 200,153ms; sampled peak 5,360MiB.
- Part A: 228,874ms; sampled peak 5,452MiB.
- Comparison: **538 unchanged, 6 changed, zero new/missing**.
- **Every one of the 476 gallery fixture shots matched.**

The six differences are listed individually below. Each contains the same 4,954
changed pixels (1.505% above the runner's tolerance) in the native Search form.
The first inspected page bounds the difference at x22–367, y412–554: the upper
form label and fields shift vertically by about one pixel. The dialog header,
checkbox, results and map background match. This is consistent with native
form/flex rounding or rendering timing; the precise cause was not established.
It is not reported as zero differences or attributed to a changed token value.

| Changed filename | Explanation |
| --- | --- |
| `main--search--light--phone-390.png` | Native Search upper-form alignment variation. |
| `main--search--light--phone-390--page-2.png` | Same upper-form variation; paged results match. |
| `main--search--light--phone-390--page-3.png` | Same upper-form variation; paged results match. |
| `main--search--light--phone-390--page-4.png` | Same upper-form variation; paged results match. |
| `main--search--light--phone-390--page-5.png` | Same upper-form variation; paged results match. |
| `main--search--light--phone-390--page-6.png` | Same upper-form variation; paged results match. |

The complete comparison is `.local/screens/e68ce60621/compare.html`.
Copier state was unchanged and scratch directories were removed after each run.

## Final comparison and checks

Command: `npm run screens -- --compare e68ce60621 --port 8963`.

Final source: `ac19408c85`; **546 captures** (478 gallery, 68 copied-save).
The comparison reports **544 changed, 2 new, zero missing, zero unchanged**.
The two new images are page 3 of desktop Helper → Progress, in dark and light:
normalised type/spacing makes that content require one additional scroll page.
All 88 gallery entries remain covered. The full comparison page renders its
pixel-difference canvas successfully.

Elapsed: **309,504ms**; sampled process-tree peak **5,379MiB**.
All ten themes were checked at desktop 1440 × 900 and phone 390 × 844 in the
same locked browser session. Minimum measured disabled Undo contrast: **4.51:1**.
Keyboard focus rings retained their 2px outlines and at least 3:1 contrast.
Phone toolbar buttons remain at least 44 × 44px; no document-width overflow
was measured. Toolbar overflow remains inside its own scrolling region.
Gallery API/write requests: **zero**; the save-throwing seam was verified.
The copied state remained byte-for-byte unchanged. All three completed-run
reports confirm scratch removal. A final process, scratch-directory and port
check found no owned Node/Chrome processes, scratch saves/profiles or listener
on port 8963.

The private representative album is
`.local/screens/tokens-before-after/index.html`, with the complete comparison
page and eight pairs: desktop and phone maps in dark and light, dark desktop
task sidebar, light desktop Settings → Map, dark desktop partner Undo, and
light phone Task details. Main views use copied save data; gallery views use
the established fixtures. Native backgrounds/calculations can settle between
shots. The gallery does not screenshot the independent OBS page itself.

The focused token/theme/sticker/phone/Settings run passed **52 tests**.
Final quick suite: **1,295 passed**, zero failures, 63,547ms.
The mechanical design detector reported no findings. The full suite was skipped
under the UI/docs-only rule; no server, storage, engine, worker or app/data code
changed. New token checks are classified as quick tests.

Three complete capture runs were sequential. A preceding port-adapter startup
attempt failed before Chrome opened or any screenshot was captured; its scratch
copy was removed. The local adapter uses scratch port 8963, preserving the
tracked runner's port rules. No dependencies or tracked screenshot-tool changes
were introduced. No original save was written, and invitation tokens were not
printed. Cleanup verification is recorded with the final results.

The design skill's context check also identified the older `PRODUCT.md` schema.
It was left untouched; `impeccable init` owns a separate context refresh.
