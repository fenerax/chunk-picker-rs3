# Design tokens

The picker keeps its map-first layout and existing ten themes. Tokens are defined
on `:root` in `app/web/style.css`. `applyTheme()` in `map-tools.mjs` supplies the
theme palette and readable foregrounds. The independent transparent OBS page
defines only the tokens it uses in `overlay.css`.

| Tokens | Use |
| --- | --- |
| `--bg`, `--panel`, `--surface` | Page, panel/dialog, and raised control surfaces. |
| `--text`, `--muted`, `--link` | Foregrounds on the page background. |
| `--panel-*`, `--surface-*`, `--task-*` | Text, muted text and links on their actual containing surface; the task variants also cover hover. |
| `--gold`, `--gold-strong`, `--on-gold` | Primary action/selected control and its foreground; `--brand*` remain aliases. |
| `--danger`, `--ok`, `--focus` | Error, success and visible keyboard focus. |
| `--border`, `--hairline` | Control boundary and quieter separator. |
| `--type-xs/sm/body/base/heading/title` | Badge (0.75rem), help/label (0.85rem), compact body (0.93rem), body/control (1rem), section heading (1.15rem), dialog title (1.5rem). |
| `--type-input-mobile` | Fixed 16px sticker search input to avoid phone input zoom. |
| `--weight-normal/medium/semibold/bold` | 400/500/600/700; use semibold for headings and bold for the primary action. |
| `--leading-tight/control/body/copy` | 1.2/1.25/1.4/1.5; headings, controls, compact text and help paragraphs. |
| `--space-1` through `--space-7` | 0.15/0.25/0.4/0.5/0.75/1/1.5rem; small internal gaps through section separation. The root size is 15px. |
| `--radius-xs/check/sm`, `--radius`, `--radius-dialog/pill/circle` | Label, checkbox, control, panel, dialog, chip and round marker. |
| `--border-thin/check/focus` | 1/1.5/2px boundaries, checkbox strokes and focus rings. |
| `--shadow`, `--shadow-toolbar`, `--shadow-dialog` | Floating panel, map toolbar/summary and modal elevation. Light variants retain the existing softer shadows. |
| `--shadow-map-label/overlay-text/tooltip/menu/selection` | Existing specialist map text, OBS text, tooltip, menu and selected-state effects. |
| `--font-body`, `--font-body-system`, `--font-sans`, `--display`, `--font-icons/symbol/mono` | Existing system body stacks, display serif, icon fonts and technical preview. Font registration names stay literal. |
| `--color-warning-*`, `--color-danger-*`, `--color-blocked-marker`, `--color-completed-default`, `--color-map-label-*` | Exact existing status and map-label colours. |

Part A preserves every literal exactly. The six type sizes and seven spacing
steps are the public scale; `*-legacy-*` and `--color-fixed-*` are compatibility
entries for values that cannot be rounded without a visible change. They are
not additional recommended scale steps. Exact values for every extracted token are
in [design-token-values.tsv](design-token-values.tsv); all original declarations
and source locations are in [design-token-inventory.tsv](design-token-inventory.tsv).
The inventory covers all 36 authored stylesheets, font shorthands, theme palette
setters and the authored style assignments. Vendored/reference CSS is excluded.
Zero, `transparent`, `currentColor`, inherited values and calculated geometry
stay literal: they express behaviour rather than a design scale.

The [dated validation](research/design-tokens-validation-2026-10-13.md) records
the extraction comparison, consistency changes, theme checks and local album.

Do use the containing surface's foreground tokens. Do preserve the theme helper's
contrast correction, keyboard focus outlines and 44px phone touch targets.
Do put refinements beside the component's existing rules. Do use the gallery at
desktop and phone widths to check a scale change.

Don't introduce a new accent for an ordinary label or secondary action. Don't
use opacity to dim readable disabled text. Don't round compatibility values in
a token-extraction commit. Don't change map ownership, travel, custom sticker
colours or user-selected completion colours: these carry saved meaning.
