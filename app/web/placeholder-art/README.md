# Public placeholder drawings

These 42 deliberately crude doodles were drawn as hand-written SVG for this project on 2026-10-13. They are licensed under MIT, the same licence as the project's own code. Exact item and activity names should remain visible wherever these generic symbols are used.

Each drawing starts only from the plain idea of its subject: a pickaxe, fish, candle, bag, and so on. No image under resources/, reference/, app/web/task-item-artwork*, any map asset folder or the game cache was opened, viewed, traced, recoloured, reduced, sampled or fed into any process to create these drawings. Future revisions must follow the same independence rules and must not imitate RuneScape icons.

Use thick, slightly wobbly strokes, two or three flat colours, and lopsided shapes. Keep them readable at 16–24 px and obviously temporary. Check both light and dark backgrounds. Each icon has an off-white sticker rim behind the artwork: repeat its geometry with no fill, round joins and caps, and a light stroke 2.6 px wider than the matching artwork stroke. Keep the dark outline inside the rim and use the same single SVG on both themes. The SVGs use a 24 × 24 viewBox, a title, and only inert geometry with presentation attributes. No styles, scripts, event handlers, images, external references, href, fonts, filters or foreignObject. Keep each SVG below 2 KB.

provenance.json records the SHA-256 of every SVG and this folder's README.md and .gitattributes, with the author, creation date and MIT licence for each file. It excludes itself to avoid a circular hash. LF line endings are pinned for the hashed files. Hashes verify file integrity; the authorship statement records how these drawings were made.

Run the focused check with node --test --test-timeout=120000 tests/placeholder-art.test.mjs, or run npm run test:quick. App wiring is a separate job.
