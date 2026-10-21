# Original picker reference

This folder keeps the `tasksMap.json` seed from the upstream picker
([source-chunk/chunk-picker-rs3](https://github.com/source-chunk/chunk-picker-rs3),
commit `98a3bdc`, v6.9.68) with its original bytes and authorship.

The authored server reads the task-map seed here for migration and original
sync. It serves `runescape_world_map.png` at `/assets/world.png` and
`Background-chunk.PNG` at `/assets/background.png` from this folder. Those two
images are not tracked; the art pack's `worldImages` component installs them.

The upstream page, scripts and stylesheet (`index.html`, `index.js`,
`index.css`, `modal.js`, `tooltip.js`, `worker.js`) are no longer kept. Line
citations such as `index.js:1234` in the docs refer to that upstream commit.
The read-only parity capture and the item-icon exporter check the deployed or
downloaded upstream sources against pinned hashes instead.

Shared artwork remains in the root `resources/` directory because the authored
app serves it too. `rs3-chunkpicker-chunkinfo-export.json` stays at the repository
root: current loaders, generators and provenance identities retain that path.

Historical performance archives may still contain a root `tasksMap.json`.
The comparison harness accepts that layout when verifying a pinned old commit;
the current application reads only this folder's seed.
