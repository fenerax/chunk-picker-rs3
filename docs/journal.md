# Map journal

**Info → Map journal** opens the selected player's map-wide journal and the
other player's journal. Both are readable in personal and Group view, including
view-only links. Select the other player's map to edit that journal, using the
same player-link permissions as chunk notes. Sandbox journals are read only.

Each journal holds plain text up to 10,000 characters. **Save journal** records a
revision-checked `set-journal` command in History; clearing the text clears the
journal. Undo can reverse it without replacing unrelated later changes.

The shared note editor keeps drafts when the dialog closes or the player changes.
Unrelated saves can use the latest revision. A change to the same journal asks
you to use the remote note or explicitly save your draft instead; it never
silently replaces the other version. Closed editors cannot submit queued saves.

Full backups and per-player restores keep journals. Original picker imports read
the map's free-text `chunkNotes` journal separately from its per-chunk notes.
Older saves load without a journal; existing imported maps gain their retained
original journal once, so a journal deliberately cleared later stays cleared.
