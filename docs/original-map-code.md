# Import by original map code

In **More → Export / Import**, choose **Import by original map code**, enter
the code, and select the destination player. Rules and task checks start off.
Preview, match the source player, preview again, then **Apply reviewed replacement**.
This replaces only the chosen player's map. Undo and Browse previous saves are
available. Changing the code, options or destination invalidates the review.

`RS3_ORIGINAL_IMPORT_MAP_CODE=1` enables this route; it is off by default and
independent of `RS3_ORIGINAL_IMPORT_PASTE`. Neither flag is enabled by a launcher.
Keep it off until the original maintainer has been told about this feature.
Only the `duo-legacy` / `surface-grid-v1` dataset is compatible. Owners can
choose any destination player in their picker; member invitations only their own.

The browser's worker reads the existing capture allowlist of public gameplay
branches, one GET at a time, from `https://chunkpickerrs3.firebaseio.com`.
It never reads the map root, sends credentials, follows redirects, or writes to
the original. Reads have a 30-second deadline and an 8 MiB aggregate byte limit.
Unknown codes, denied reads, invalid JSON and oversized responses stop before
preview. Retry or use the paste fallback if browser/network policy prevents reads.

The existing [paste adapter](original-import-paste.md) owns Firebase decoding,
chunk/task identity matching, rule decisions and exact retained evidence. The
new wire format is transient: it uses the same saved provenance, review token,
worker queue, revision and authorization checks, save format and Undo commands.
No save, registry or authentication format changes are needed.

Unlocked chunks, selected order, pending choices and blacklist transfer. Opted-in
matched challenge checks, backlog/favorites and equivalent player rules transfer
under the paste adapter's limits. Notes, custom tasks, display settings, roll
timeline, unsupported rules and unmatched identities remain archived, not active.
Personal quest/skill/item observations and foreign Undo are never inferred.

Synthetic tests cover the public GET allowlist, normalization, failure/cancel
paths, separate flags, mapping, preview-only behavior, required receipts, stale
review rejection, previous saves and Undo. No original player maps are fetched.
