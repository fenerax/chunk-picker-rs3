# Third-party notices

Created using intellectual property belonging to Jagex Limited under the terms
of Jagex's Fan Content Policy. This content is not endorsed by or affiliated
with Jagex. Policy: https://legal.jagex.com/docs/policies/fan-content-policy

RuneScape is a trademark of Jagex Limited. This unofficial, non-commercial
project is not endorsed by or affiliated with Jagex or the RuneScape Wiki.
The MIT licence covers project-authored code, rules and placeholder drawings;
it grants no rights to Jagex game artwork, game data or trademarks.

## Jagex game data and artwork

This repository ships material derived from the RuneScape game client and its
cache. It belongs to Jagex Limited, and the MIT licence does not cover it:

- the `app/data/cache-*`, `docs/research/cache-*` and related data files that
  record names, ids, coordinates, components, shops, NPCs, transport links and
  membership flags read from the game cache;
- the scripts in `scripts/cache/` that read a local game cache to rebuild
  those files (no cache files are included);
- six equipment icons in `resources/equipment_icons/`, which are Jagex game
  artwork kept from the original picker.

Map art and icons are not part of this repository. When an installed art pack
supplies them, they are Jagex game artwork under the same terms.

## Original RS3 chunk picker

`reference/original-picker/` and `rs3-chunkpicker-chunkinfo-export.json` are
copies of the original RS3 chunk picker and its chunk data, kept for
comparison. Data files named `original-*`, `legacy-*` and `retained-*` are
built from that export. These files are not covered by the MIT licence.

## RuneScape Wiki

RuneScape Wiki contributors supply the adapted factual dataset in
`app/datasets/open-f2p/wiki-derived/`. Its NOTICE and per-record page titles,
revision IDs and source URLs provide attribution and describe changes.
That folder uses Creative Commons Attribution-NonCommercial-ShareAlike 3.0
Unported: https://creativecommons.org/licenses/by-nc-sa/3.0/ .
The cooking, fletching and travel facts in
`app/training/gathering-processing.mjs` and `app/training/banking-travel.mjs`
also adapt RuneScape Wiki contributors' facts under that licence. Their source
tables retain page titles, revision IDs, timestamps, content hashes and URLs.
The activity timing facts in `app/data/activity-timing.mjs` also adapt Wiki
contributors' facts under that licence, with source URLs beside the rules.
The calculator combines those facts with project-authored timing estimates;
its displayed assumptions describe the limits of those estimates.

The data files listed in `WIKI-NOTICE.md` also adapt RuneScape Wiki
contributors' facts under CC BY-NC-SA 3.0. Their records cite the source Wiki
pages where the build recorded them; that notice lists the files and the
changes made.

Keep the attribution, non-commercial and share-alike terms when redistributing
covered adaptations. This separate data licence is not replaced by MIT.

## Placeholder pictures

Placeholder SVGs are hand-written drawings made from simple shapes for this
project, without tracing or transforming game images.
