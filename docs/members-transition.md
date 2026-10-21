# Ready for members

Field decisions made before implementation, against `MEMBER_KEYS` in
`app/core/state.mjs`. This is one shared, revision-checked command for the duo.

Open **Settings → Map → Ready for members**, choose the bank pool and optional
banks, then review both players' reset counts. Type **members** before pressing
**Reset group maps and roll starting banks**. Either player's write link can run
the action; viewer links and Sandbox cannot. A changed save requires a fresh
review. The result names both banks and points to Undo in History.

| Member field | Decision |
| --- | --- |
| id | Keep |
| name | Keep |
| sourceMapId | Keep |
| unlocked | Reset to the rolled bank chunk |
| selected | Reset to empty |
| pendingRoll | Reset to empty |
| blacklisted | Keep; uncertain map-specific intent |
| completedTasks | Keep |
| obtainedEquipment | Keep |
| teleports | Keep; uncertain map-specific intent |
| teleportOverrides | Keep; uncertain map-specific intent |
| notes | Keep |
| journal | Keep |
| taskStatus | Keep, including challenge and in-game completions |
| taskRules | Keep |
| sectionOverrides | Keep; add the new bank's usual starting sections |
| sourceBacklogs | Keep |
| areaOverrides | Keep; uncertain map-specific intent |
| preferences | Keep; move startingChunk to the rolled bank |
| primaryOverrides | Keep |
| passiveLevels | Keep |
| maxLevels | Keep |
| slayerLock | Keep; uncertain map-specific intent |
| stickers | Keep |
| taskAlternatives | Keep |
| runescapeName | Keep |
| skillProgress | Keep |
| questProgress | Keep |
| runeMetricsSync | Keep |
| originalPickerSync | Keep |
| transportFacts | Keep; uncertain map-specific intent |

Custom tasks live in the group `tasks` catalogue and are kept. All shared rules
are kept except `content.f2p`, which is turned off when the dialog's members
content option is checked.

The transition adds a small optional `f2pMap` member value containing the old
unlocked list and timestamp. It keeps the first snapshot on later transitions.
The automatic full backup is labelled **Before going members** and pinned in
retained backups. History records the initiating identity, the bank data version,
the options, and both bank results. One Undo restores the preceding maps, starting
flags, access overrides, snapshot presence, and shared rules.

Bank candidates come from the versioned runtime data derived from the research
snapshot. The broad pool has 19 strict entries; its optional conditional tick is
a confirmation that the duo allows their listed requirements. F2P extension
entries are deduplicated by chunk ID. Havenhythe admits Dalia only for each player
who confirms Trader Woes. Transport-only and wandering bankers are excluded.

Kept blacklist, transport facts, travel overrides, section/area overrides, and
Slayer lock may reflect old map decisions. Review them after moving if needed;
the transition does not infer which personal decisions are obsolete.
