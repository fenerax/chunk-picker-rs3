# Search

Open **Search** or press **/**. Search stays open while you pan or zoom the map;
on a phone-sized screen it sits at the bottom. Close it with **×** or **Esc**.
Opening another tool also closes Search.

**Chunks** searches names, IDs, chunk contents and both players' saved chunk
notes. Results show notes with their author's name. Notes are read from the
current save each time Search opens, independently of the partner-note panel.
Unsaved note drafts and task notes are not chunk-note results.

**Highlight matches on map** shows pink fills and dashed outlines for every
matching surface chunk, including results on other pages. Sections use their
base chunk. Interior results remain searchable; they have no surface square to
highlight. Task, item and equipment searches use their recorded source locations;
training searches use available tasks for that skill. Task search loads its map
locations only for a typed query with highlighting enabled, keeping the existing
task rows and page usable while loading or if that lookup fails. Clearing the query,
closing Search, changing mode or adopting another save removes the old highlights.
The highlight switch changes only this open Search, including on view-only links.

Results use **Previous** and **Next** to page through 120 rows at a time with no
total-result cap. Paging reuses the result set. Input retains its 120 ms debounce.
Map panning draws cached highlight coordinates without repeating search or task
requests. Pink marks use a dedicated canvas below map icons and cyan open-chunk
brackets; translucent fills retain the existing roll numbers.

**Items & drops → View** orders sources by drop rate, most common first, with
shops and guaranteed drops first, stable equal-rate ordering, and unknown rates
after known positive rates. Rate-bearing training outputs also participate;
unrated sources follow. Item names retain their existing alphabetical order.
The retained original reference is `reference/original-picker/index.js` in this checkout: its item-detail
rate comparator is at line 9345. Current calculated probabilities include nested
drop-table chances; Search sorts a copy and does not change cached evidence.
The original fallback source's incidental `shouldRank` omission cannot be
reconstructed from normalized source records and is not reproduced.

Implementation lives in `screen-search.mjs`, `screen-search-data.mjs`,
`search.css` and `map-search-layer.mjs`, with small dialog, map and authenticated
asset-route hooks. Search does not write saves or introduce dependencies.

Focused verification: `tests/search.test.mjs`, `tests/map-search-layer.test.mjs`,
the existing screen harness in `tests/web-browser.test.mjs`, and the authenticated
browser import graph in `tests/server.test.mjs`.
