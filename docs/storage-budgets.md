# Retained save storage budgets

Each group has a publication budget in addition to request and rate limits.
Accounting uses filesystem metadata, including the current save, standalone
preimages, retained packs, History archives, static fields, optional evidence
and the sibling dataset binding. It excludes the same root lock/cache paths
as online capture (`store.lock`, `store.lock.recovery`, `warm-store`). Bytes
are compressed/on-disk file lengths, not decoded JSON sizes. Snapshot spools
and operator recovery copies have their existing separate admission checks.
No gameplay, registry, ledger, sidecar, retained backup or checkpoint format
changes; accounting is rebuilt from disk after restart.

| Environment setting | Default | Meaning |
| --- | ---: | --- |
| `RS3_STORE_MAX_BYTES` | `1073741824` (1 GiB) | Maximum group file bytes after a gameplay publication |
| `RS3_STORE_MAX_FILES` | `3584` | Group file ceiling, including eight slots reserved for temporary/optional publications |
| `RS3_STORE_MIN_FREE_BYTES` | `5368709120` (5 GiB) | Free filesystem space to preserve after peak publication output |

All values must be positive safe integers. The file ceiling can be lowered,
but cannot exceed 3,584: Format 1 capture has a 4,096-descriptor budget, and
still needs margin for in-flight sidecars and its time budget. A file budget
does not guarantee capture finishes inside its one-second deadline.
For 50 groups, the default byte allowance is at most 50 GiB of group stores;
provision additional room for snapshots, operator recovery copies, releases
and the filesystem reserve. This is a default allowance, not preallocated disk.

For Linux service deployments, put these nonsecret variables in the existing
`/etc/chunk-picker/runtime.env`. Serving children explicitly inherit them;
the monitor unit reads that file too, so thresholds agree. Restart the writer
after changing limits and install the updated monitor unit. Ordinary direct
Node launches use the same environment variables. `retention: false` disables
packing policy, not publication budgets.

Before writing a gameplay change or applying an import, the store checks the
prospective state, retained preimage, labels and pending dependencies together.
Group bytes use net replacement growth; shared headroom reserves **all** output
bytes because atomic temporary files coexist with old files. Reservations
include filesystem allocation rounding, directory/temporary overhead and 1 MiB
of optional projection slack. Concurrent groups in the service process share
reservations by filesystem device; a failed publication releases its reservation.
This coordinates service writers, not unrelated processes or operator copies.
Keep those operations under their existing headroom checks.

A refused change returns HTTP 507 / `STORAGE_BUDGET_EXCEEDED`, explaining
whether the group limit or shared disk reserve blocked it and asking the owner
to contact the operator. Admission happens before that attempt creates a
preimage or dependency. An admitted attempt whose later commit hook fails
still preserves its independently named preimage, as before. Existing progress,
History, backup browsing, portable exports and retained downloads remain
readable. A budget refusal skips optional daily startup observations rather
than preventing the existing save from opening.

Packing continues to use the existing age/day/pin selection, full source
validation, synchronized pack publication and exact reread before removing
duplicate standalone copies. It never discards preserved snapshots. Packing
may temporarily exceed the group allowance to reduce file pressure, but still
reserves shared headroom for the extra durable copy. Gameplay waits only for
an overlapping publication's accounting, not full archive validation.

The existing five-minute monitor inventories the legacy store and every
`p_<32 hex digits>` directory under the configured multi-picker root, without
opening registry or gameplay writers. It obtains roots through
`RS3_OPERATOR_CONFIG`; an explicit monitor `dataDir`/`multiPicker.pickerRoot`
is also supported for isolated deployments. Missing/unreadable roots are
monitor failures, not healthy zero usage. Inspect current per-group bytes,
files and effective limits privately with
`node --env-file=/etc/chunk-picker/runtime.env scripts/linux/monitor.mjs --storage`
from the installed tools directory. This read-only report sends no notifications
and writes no accounting file. The existing notifier sends a
fixed `group-storage` warning at 80% of either group allowance, escalates when
full (including the eight reserved file slots), and reports recovery. At the
defaults, the file warning begins at 2,868 files, well before 4,096. No group
names, save contents or paths enter external alerts; repeat warnings are silent.

On an alert, inspect the per-group counts and any
`getInfo().retention.failure`, provision space or raise the byte allowance
within server capacity, and check whether existing age-based packing can help.
Preserve pinned and historical inputs. Raising the file ceiling above its safe
bound or deleting retained copies is not an automatic recovery action.

`tests/storage-budget.test.mjs` uses synthetic stores only. Its minimal
two-member case executes 450 committed changes with 100 active History
entries, producing 455 files and approximately 566 KB: over seven times below
the file ceiling and over 1,000 times below the byte ceiling. This measures
retained-file accumulation, not the contents or size of any private game.
Other cases independently exercise oversized publications, reservations across
groups, import refusals, preserved downloads and packing under pressure.

## Retained storage per login

Multi-picker mode adds a retained allowance independent of traffic/upload limits:

| Environment setting | Default | Meaning |
| --- | ---: | --- |
| `RS3_LOGIN_MAX_BYTES` | `10737418240` (10 GiB) | Maximum aggregate retained on-disk bytes and pending reservations per login |
| `RS3_LOGIN_MAX_MAPS` | `20` | Maximum distinct retained picker directories plus frozen Past maps per login |

Both accept positive safe integers; map count has a hard maximum of 128 to bound
metadata work. Programmatic configuration is `multiPicker.loginStorage` with
`maxBytes` and `maxMaps`; explicit options override the environment. These
settings are read only when opening the multi-picker registry. The 10 GiB default
equals ten default 1 GiB group budgets, matching the ten-character allowance.
Twenty retained maps permits history beyond ten current maps while preventing
unlimited departure/rejoin churn. These are admission defaults, not preallocated
disk or proof that an operator's server can support all users at their ceilings.

Each login is charged once for each default picker it owns or controls through
a non-viewer membership/current character placement, including retired onboarding
and rejoin solos, reserved creation and deleting-but-not-yet-deleted pickers.
Several of its characters in one picker do not multiply that picker. A shared
picker is charged in full to each controlling login; equal shares would let
other logins subsidize retained growth. Legacy shared-picker storage and viewer
memberships are excluded. Each registry-held Past map is additionally charged
to its recorded login by exact snapshot file length, independently of its source
picker's lifecycle. Retired source directories and frozen snapshots are separate
retained objects and both count when owned by the login.

Bytes include History, backups/packs, private evidence and sidecars, and the
sibling dataset binding, with the existing capture lock/cache exclusions.
No save contents are decoded for accounting. The publishing picker's existing
usage measurement is reused; other pickers use streamed metadata reads capped at
4,096 entries each, including directories. A new allocation first checks map
count, so an already-over-count login causes no directory walks. At most 128
retained objects are measured for a checked login; shared measurements are reused
within an admission. Malformed/nonregular paths or exhausted scan budgets fail
closed. There is no request-path scan of all picker-root directories.

Pending creations and departure destinations, including ready pickers whose
state has not yet been initialized, reserve one configured group byte budget.
Pending frozen snapshots also reserve one group byte budget until the snapshot
exists. The reservation comes from existing durable lifecycle records and is
reconstructed after restart. It can conservatively refuse an operation whose
eventual small save might fit. Departure/rejoin services check the portable
snapshot length against that reservation before committing a new intent.
Pending joins and departures also reserve one group byte budget for roster
publication growth, including preimages, for every login controlling the changed
group. This byte-only reservation prevents a new character joining an already
controlled picker from bypassing quota and protects the other group members'
allowances. It adds no map to the count and is released when the intent completes.

First sign-in, Add character, invite admission (including direct new characters),
leave/removal, rejoin and membership changes check projected holdings before
publication. Registry admissions and positive file publications share one
process-local serialization gate for the exclusively owned registry. Two
concurrent additions cannot each spend the same remaining allowance. Gameplay
plans include their preimages/dependencies; imports, restore, regular saves,
plugin evidence (including corrupt-sidecar archives), keys/invites, overlays,
feedback/usage and dataset bindings use the same gate. Pure reads do not check
quota. Non-growing writes remain allowed. Age-based packing, explicitly requested
deletion and completion/recovery of an already-admitted lifecycle transaction
can finish after limits are lowered. These exceptions preserve records; they
never evict or truncate data to make a limit pass.

Refusal is HTTP 507 / `LOGIN_STORAGE_BUDGET_EXCEEDED` with a player-facing request
to delete an unwanted character/group or contact the operator. A login already
over either limit keeps its maps, Past maps, History and downloads, but cannot
add retained storage. Optional daily startup observations skip quota refusals.
Retired/Past map removal is not introduced here; an operator may need to raise
the allowance when no suitable user-deletable map remains. Shared registry,
non-reuse ledger, release inputs, operator snapshots/off-site backups and
diagnostic logs remain server-level operational storage, outside this login
allowance. No durable file/field, registry/ledger version or gameplay format was
added. The option-absent single-picker mode keeps its existing group budget.

`tests/login-storage-budget.test.mjs` covers synthetic map/byte admissions,
concurrent attempts across maps, pending work and restart with lowered limits,
retired onboarding and Past-map accounting, deletion over quota, bounded scans
and unchanged single-picker behavior. These checks do not establish deployed
latency or operational capacity.
An isolated headless Chrome journey also checked the visible Add character
refusal, editable name field after refusal/reload and navigation to the existing
character's map. It used synthetic accounts and temporary stores, not live saves
or outside-user acceptance.
