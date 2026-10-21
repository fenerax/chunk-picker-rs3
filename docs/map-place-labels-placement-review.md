# Map place-label placement review

## Evidence status

This review records the final paired run on October 13, 2026, captured at
16:52–16:53 UTC. Baseline source is `9c3cbd7`; authoritative measurements are
`.local/screens/labels-before.json` and `labels-after.json`. The copied duo save
has revision 110, 163 unlocked
chunks, IDs and task badges enabled. Desktop captures use 1440×900; phone
captures use 390×844. Recent Chunks and the map legend were expanded. The
default fitted zoom differs by viewport. These are fixture observations, not
claims about every personal map.

All 38 screenshots came from one final locked browser session: 19 per phase,
including 24 desktop/phone × dark/light × out/default/in captures, eight
Havenhythe captures and six gray/dark/light high-visibility captures. Actual
map theme, high-visibility state and artwork style were asserted. See the
[paired screenshot gallery](../.local/screens/labels-gallery.md).

## Original baseline

Counts below are distinct `(name, category)` collisions, so one name can occur
in several categories. `Unlocked interior` is a preference violation in the
baseline; the final implementation permits it only as the documented fallback.
There were no recorded name/name overlaps in these baseline views. No badge
rectangle, ID/rank/sticker/flag annotation or colour-accent collision was
reported by this fixture; absence here does not replace focused obstacle tests.

| Width | View | Zoom | Names | Collision categories and counts |
| ---: | --- | ---: | ---: | --- |
| 1440 | Out | 0.055 | 14 | Leader 1; summary 2; unlocked border 6; unlocked interior 4 |
| 1440 | Default | 0.203125 | 32 | Summary 18; recent panel 6; area-check toolbar 1; unlocked border 11; unlocked interior 12 |
| 1440 | In | 0.85 | 32 | Summary 10; recent panel 6; toolbar groups 5; unlocked border 3; unlocked interior 19 |
| 1440 | Havenhythe | 0.42 | 9 | Summary 2; unlocked border 2; unlocked interior 4 |
| 390 | Out | 0.055 | 13 | Leader 1; unlocked border 6; unlocked interior 4 |
| 390 | Default | 0.08759765625 | 9 | Unlocked border 3; unlocked interior 3 |
| 390 | In | 0.85 | 14 | Toolbar groups 2; unlocked border 3; unlocked interior 9 |
| 390 | Havenhythe | 0.42 | 4 | Unlocked border 2; unlocked interior 4 |

The requested light captures repeat these counts. Each requested desktop
high-visibility capture has 32 names at zoom 0.203125 and repeats the desktop
default collision list. Exact affected names and original category strings
follow at the end of this document.

## Final collision results

All 19 after views have **zero hard-obstacle collisions and zero name/name
overlaps**. Recorded `unlocked chunk` intersections below are allowed interior
fallbacks, not border or annotation collisions. Dark and light counts agree
except for the desktop close view; its light rendering retains one extra name.

| Width | View | Zoom | Before names | After dark / light names | Allowed interior fallback names |
| ---: | --- | ---: | ---: | --- | --- |
| 1440 | Out | 0.055 | 14 | 20 / 20 | None |
| 1440 | Default | 0.203125 | 32 | 23 / 23 | Het's Oasis, Fort Forinthry, Wendlewick |
| 1440 | In | 0.85 | 32 | 18 / 19 | Het's Oasis, Mage Training Arena, Archaeology Campus, Exam Centre, Temple |
| 1440 | Havenhythe | 0.42 | 9 | 8 / 8 | Havenhythe, Wendlewick |
| 390 | Out | 0.055 | 13 | 18 / 18 | None |
| 390 | Default | 0.08759765625 | 9 | 13 / 13 | None |
| 390 | In | 0.85 | 14 | 11 / 11 | Het's Oasis, Mage Training Arena, Archaeology Campus, Exam Centre, Varrock Dig Site, Kharid-et Dig Site |
| 390 | Havenhythe | 0.42 | 4 | 4 / 4 | Havenhythe, Wendlewick |

Desktop gray, dark and light high-visibility captures each retain 23 names at
zoom 0.203125, with the same three interior fallback names as the default view.

## Placement rules

Regions precede towns, then smaller places; explicit priority and ID break
ties. Region labels appear below zoom 0.65, towns from 0.16, and small places
from 0.65. Candidate positions include vertical, horizontal and diagonal
adjustments bounded per axis at 80px for regions, 48px for towns and 24px for
small places. A modest shrink keeps text at least 12 CSS pixels; names without
a valid nearby position disappear. Names never overlap each other.

Hard obstacles include roll numbers, chunk IDs, task-count badges and their
leaders, sticker clusters and overflow chips, starting flags, owner tabs,
death markers, exposed unlocked borders, painted chunk-colour accents, and
visible floating panels/toolbars. Interior shared unlocked edges are not
perimeter strokes. Colour accents use their actual zoom/slice thresholds.
Diagonal leaders use segment intersection rather than their full bounding box.

Unlocked interiors form a separate preference layer. Placement first searches
all permitted nearby candidates for terrain outside them. If none fits, a
hard-obstacle-free interior position is allowed. Borders, annotations and
other names remain protected in that fallback. Final drawing also checks
current viewport-repaired badge/leader positions and fixed panels during
short pans; partially clipped names are hidden.

The label layer reuses raster text, bounded zoom-tier layouts and nearby fits.
Label-only geometry does not mutate the shared task-count obstacle index.
Panel geometry is refreshed after layout/visibility/details/scroll events;
unchanged geometry does not schedule repeated redraws. Disposal releases
observers and listeners.

## Validation and final results

Pure and class tests cover hierarchy independent of input order, horizontal
alternatives, readable shrinking, fully blocked omission, owned-interior
preference/fallback, hard-marker protection, repeated pairwise collision
checks, exposed/shared borders, colour thresholds, exact leaders, repaired
badges, zoom/resize fitting, panel clipping and observer disposal. Cache tests
check ordinary pan/artwork reuse and incoming labels after longer pans.

The browser harness uses a copied save, waits for coherent real task counts
and settled terrain, records labels and obstacle categories, and captures
matched before/after widths, zooms and themes under the shared heavy-work lock.
It checks actual map theme, high-visibility state, failed terrain tiles, page
errors, horizontal overflow, save commands and unchanged save bytes. Synthetic
profiling measures the label layer separately from the whole render with
names off/on, IDs, group annotations, badges and chunk colours enabled.

| Zoom | Before render p95 off / on | Before label p95 | After render p95 off / on | After label p95 |
| ---: | --- | ---: | --- | ---: |
| 0.055 | 5.50 / 5.20 ms | 0.10 ms | 6.30 / 5.60 ms | 0.30 ms |
| 0.16 | 4.60 / 4.70 ms | 0.30 ms | 6.80 / 6.40 ms | 0.90 ms |
| 0.35 | 10.20 / 11.10 ms | 0.30 ms | 12.50 / 11.40 ms | 0.50 ms |
| 0.85 | 8.70 / 7.40 ms | 0.50 ms | 7.30 / 6.90 ms | 0.40 ms |
| Continuous zoom | 18.10 / 21.30 ms | 1.00 ms | 34.90 / 27.40 ms | 7.00 ms |

Profiling used 1280×800 at DPR 1, 180 pan frames after 60 warmup frames,
180 revealed chunks, 1,160 terrain files and 2,054 pins. Final label-layer pan
p95 ranges from 0.3 to 0.9 ms; continuous-zoom p95 is 7 ms. The added fitting
has a measurable zoom cost. No improvement is inferred from noisy off/on
whole-render differences, and these results do not meet the earlier 0.5 ms
label-layer budget. Continuous zoom recorded three frames over 50 ms per
baseline mode and six per final mode; the final 0.35 names-on pan sample also
recorded one frame over 50 ms.

Focused checks passed **85/85 across five files** and the quick suite passed
**1,169/1,169**. No full-suite run was performed. The copied save remained byte
identical, page errors and save commands were both zero, and no terrain fetch
failed. Scratch data and the browser were stopped and removed after capture.

Phone checks use browser emulation, not a physical device. These results cover
this labels branch and fixture; parallel Clue/Slayer changes are not included.

## Original affected-name lists

The lists below preserve each width/view/zoom and the category strings from
the original JSON. They cover dark geometry; requested light geometry is
identical, and desktop high-visibility geometry repeats the default list.

### 1440px / out / zoom 0.055

- **badge leader:** Morytania.
- **map-summary:** The Lost Grove, Tirannwn.
- **unlocked border:** Ashdale, Feldip Hills, Havenhythe, Karamja, Miscellania, Morytania.
- **unlocked chunk:** Feldip Hills, Havenhythe, Karamja, Morytania.

### 1440px / default / zoom 0.203125

- **map-summary:** Ape Atoll, Arandar, Ashdale, Brimhaven, Crandor, East Ardougne, Entrana, Feldip Hills, Isafdar, Karamja, Kingdom of Kandarin, Kingdom of Misthalin, Port Sarim, Shilo Village, Taverley, Tirannwn, West Ardougne, Yanille.
- **recent-panel:** Kingdom of Kandarin, Miscellania, Rellekka, Seers' Village, Taverley, Ungael.
- **toolbar-group toolbar-area-check:** Ungael.
- **unlocked border:** Al Kharid, Ashdale, Brimhaven, Canifis, Crandor, Entrana, Fort Forinthry, Havenhythe, Karamja, Kingdom of Misthalin, Mort'ton.
- **unlocked chunk:** Al Kharid, Ashdale, Brimhaven, Canifis, Crandor, Entrana, Fort Forinthry, Havenhythe, Kingdom of Misthalin, Mort'ton, Port Sarim, Taverley.

### 1440px / in / zoom 0.85

- **map-summary:** Al Kharid, Champions' Guild, Jail, Kalphite Hive, Kalphite Nursery, Lumbridge, Lumbridge Swamp, Mage Training Arena, River Lum, Shantay Pass.
- **recent-panel:** Archaeology Campus, Champions' Guild, Clan Camp, Cooks' Guild, Varrock, Varrock Dig Site.
- **toolbar-group:** Fort Forinthry, Slayer Tower.
- **toolbar-group toolbar-roll:** Fort Forinthry.
- **toolbar-group toolbar-undo:** Fenkenstrain's Castle.
- **toolbar-group zoom-group:** Fenkenstrain's Castle.
- **unlocked border:** Abandoned Mine, Mort Myre Swamp, River Salve.
- **unlocked chunk:** Abandoned Mine, Al Kharid, Archaeology Campus, Champions' Guild, Clan Camp, Cooks' Guild, Exam Centre, Fort Forinthry, Het's Oasis, Jail, Lumbridge, Lumbridge Swamp, Mage Training Arena, Mort Myre Swamp, River Lum, Shantay Pass, Temple, Varrock, Varrock Dig Site.

### 1440px / havenhythe / zoom 0.42

- **map-summary:** Harmony, Wendlewick.
- **unlocked border:** Amberfell, Moonsylvar Wood.
- **unlocked chunk:** Amberfell, Havenhythe, Moonsylvar Wood, Wendlewick.

### 390px / out / zoom 0.055

- **badge leader:** Morytania.
- **unlocked border:** Ashdale, Feldip Hills, Havenhythe, Karamja, Miscellania, Morytania.
- **unlocked chunk:** Feldip Hills, Havenhythe, Karamja, Morytania.

### 390px / default / zoom 0.08759765625

- **unlocked border:** Ape Atoll, Crandor, Karamja.
- **unlocked chunk:** Ape Atoll, Crandor, Karamja.

### 390px / in / zoom 0.85

- **toolbar-group:** Canifis.
- **toolbar-group toolbar-roll:** Temple.
- **unlocked border:** Abandoned Mine, Mort Myre Swamp, River Salve.
- **unlocked chunk:** Abandoned Mine, Archaeology Campus, Exam Centre, Het's Oasis, Kharid-et Dig Site, Mage Training Arena, Mort Myre Swamp, Temple, Varrock Dig Site.

### 390px / havenhythe / zoom 0.42

- **unlocked border:** Amberfell, Moonsylvar Wood.
- **unlocked chunk:** Amberfell, Havenhythe, Moonsylvar Wood, Wendlewick.
