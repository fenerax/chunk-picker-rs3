# Duo coordination

Player-linked invitations default to their player's map. A valid remembered map
choice still takes precedence, and the private master link keeps its existing
first-player default. Session lookup runs alongside startup's existing requests.
The session exposes its safe History actor and linked member ID, without secrets.

The map's Undo button names its exact action and author. Partner Undo opens an
in-page review; Cancel saves nothing. Toolbar, History and review controls capture
the displayed target and state revision, so a later save cannot substitute a new
action. “Undo my last change” uses the newest active undoable event by the viewer.
It appears only when the store's shared preview/apply check accepts that target.
A blocked older own change has an explanation in History and the partner review.

Selected Undo preserves the existing latest-global default when no revision is
given. Sparse personal inverses require their saved after values and cannot cross
overlapping later changes, including the chunk arrays' shared exclusivity rules.
Older full snapshots, shared rules and catalogue changes remain conservative:
undo newer changes first. Ordinary revision checks and monotonic History markers
still apply. Older own targets are searched in active History; archived records
remain in full backups.

An explicit retained personal Undo without archive references shares untouched
task rows and History read-only. It copies the changed members and the target's
History marker, avoiding a whole-state copy and archive replay. Failed saves leave
the committed marker untouched; restart and backup checks cover this path.

Other-player notices use History's sentence formatter. Tick bursts within three
seconds group by actor and target player; a cross-player action retains its target
name. Live notes hold at most 30 events, show three summaries and disappear after
ten seconds. The dismissible return list shows five summaries with Open History.
The per-browser last-seen key uses the linked player (or stable invite/master
identity), with every localStorage access protected against blocked storage.
First visits do not show historical catch-up.

`GET /api/coordination` reads committed compact metadata. It filters partner
changes before limiting its response to 100 retained events, so a burst of the
viewer's own changes cannot hide partner activity. Only the latest global and
latest own targets get safety previews. No archive hydration, task calculation,
map request or additional worker is required. A transient metadata failure leaves
Retry Undo available; an SSE reconnect also retries. Task loading starts before
the metadata request and does not await it.

Invitation labels are convenient attribution, not verified personal identity.
Matching uses stable invite IDs and saved linked member IDs. Distinct unlinked
invites with the same label do not become the same actor.

See [sharing](sharing.md) for invitation permissions and operator procedures.
The [copied-save review](research/duonow-2026-10-10.md) records screenshots,
verification and the paired performance measurements.
