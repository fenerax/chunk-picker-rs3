# Stickers

Each member can keep up to **six ordered stickers per surface chunk**. Repeated types are
allowed: for example, Player 1 can put a gold Star labelled “Quest route”, a Mining sticker
labelled “Coal”, and another Star labelled “Meet Player 2” on Wendlewick. Stickers are personal
annotations and do not change ownership, access or tasks.

Open **Sticker** in the chunk panel or the map's right-click menu. Clicking a catalogue
sticker adds it and keeps the picker open. The top row shows the current list; select one
to recolour it with a colour dot, or use its **×** to remove it. With no selection, dots
choose the colour for the next addition. **Label & more…** opens the full editor to add,
select, edit the type/colour/text, remove, or clear the list. Each saved operation has its
own History entry and Undo; the quick picker also shows an Undo toast such as “Star added
to Wendlewick”. **Reload stickers** reviews the latest list after a revision conflict before
retrying. Switching members closes the picker. Skill artwork retains its original colours
even when a stored colour changes.

The map draws up to four stickers as a compact cluster. In group view it alternates
members' stickers and retains the ownership colour bars; a **+N** chip counts the remaining
stickers across the visible members. Smaller cells show fewer icons, or just the count.
Hover text and the canvas's accessible description list every visible member's sticker,
including its full label. Starting flags remain separate annotations.

**More → Map display** changes sticker and starting-flag size live. These browser-only
sizes keep clusters inside their chunk; see [Map display](map-display.md).

## State and commands

`member.stickers[chunkId]` is an ordered array of `{id, type, color, text}`. An empty array
is an explicit clear that masks an inherited original-picker sticker. IDs stay stable when
editing; type, `#RRGGBB` colour and literal text are validated. The cap is exported as
`MAX_STICKERS_PER_CHUNK` from `app/core/map-markers.mjs`.

Submit commands to `POST /api/command` with the current `expectedRevision`:

```js
{ expectedRevision: 12, command: {
  type: 'add-sticker', memberId: 'player1', chunkId: '7495',
  sticker: { type: 'star', color: '#f5c451', text: 'Quest route' }
} }
```

The supported commands are:

| Command | Additional fields | Effect |
| --- | --- | --- |
| `add-sticker` | `sticker: {type, color, text}` | Append a sticker with a server-assigned ID |
| `update-sticker` | `stickerId`, `sticker: {type, color, text}` | Replace that sticker's fields, keeping its ID and position |
| `remove-sticker` | `stickerId` | Remove just that sticker |
| `clear-stickers` | — | Clear the chunk's list |
| `set-sticker` | `sticker: {type, color, text}` or `null` | Compatibility command: replace the entire list with one sticker, or clear it |

Every command also takes `memberId` and `chunkId`. Revision conflicts, invalid IDs and a
seventh addition fail without changing state. History uses the existing sparse dictionary
deltas; Undo restores the prior list, including an inherited sticker or absent override.

Existing schema-1 single-sticker saves and their undo records normalize to one-item arrays;
old `null` overrides become empty arrays. `resolveMemberStickers(state, member)` also
decodes retained `stickered`, `stickeredColors` and `stickeredNotes` into inherited lists.
These retained original records stay intact, and authored lists take precedence. The first
edit of an inherited sticker saves the resolved list, preventing a later removal from
resurrecting it. Portable backup export/restore includes IDs, order, labels, clears and undo
records without a state schema version change. Original-picker synchronization keeps its
existing compatibility boundary and cannot represent an ordered multi-sticker list upstream.

`layoutStickerCluster(members, chunkId, size)` in `app/web/map.mjs` returns chunk-local
placements and overflow geometry for drawing and tests. The existing `createStickerPicker`
hook and `mapTools.sticker(chunkId)` serve both quick-picker entry points and the full editor.
