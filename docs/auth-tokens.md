# Generated authentication tokens

Ordinary 32-byte base64url tokens use `generateToken` in
`app/security/tokens.mjs`. It draws again while `/^gpk_/i` matches. Length,
encoding and entropy source otherwise stay the same. The reserved prefix is
case-insensitive because plugin credential detection is case-insensitive.

| Token | Generation site | Presentation and persistence |
| --- | --- | --- |
| Master access token | `app/storage/store.mjs` | Private picker bearer, join URL or legacy `duo_access` cookie; plaintext `access-token` file. Applies to shared and owned stores. |
| Invitation token | `app/storage/invites.mjs`, `create` | Join URL; only its hash is saved in `invites.json`. Not accepted as a picker bearer. |
| Browser session token | `app/storage/invites.mjs`, `addSession` | `duo_access` cookie for master, invitation, linked account and owned picker sessions; only hashes are saved in `invites.json`. Not accepted as a session bearer. |
| Overlay link key | `app/overlays.mjs` | Link fragment, then overlay bearer; only its hash is saved in `overlays.json`. |
| OAuth preauth key, state, PKCE verifier and Google nonce | `app/signin.mjs` | `__Host-rs3_preauth` cookie and provider exchange; pending values stay in process memory. Provider access/ID tokens come from the provider, not this service. |
| Account relink recovery code | `app/storage/registry.mjs`, `issueRelinkCode` | Sign-in reclaim flow; only its hash and expiry are saved in the registry. Not bearer authentication. |
| Account deletion confirmation | `app/picker-router-deletion.mjs` | Request body, bound to an authenticated session; process memory only. |
| Transfer review token and progress preview IDs | `app/save-transfer.mjs`, `app/picker-context.mjs`, `app/integrations/game-plugin.mjs` | Request bodies, bound to the reviewed operation; process memory only. UUIDs already cannot start with `gpk_`, so their generation is unchanged. |
| Save action session scope and request IDs | `app/storage/action-receipts.mjs` | Authenticated save coordination, not bearer authentication; UUID scope and `v2.`/`v3.` request IDs already cannot match the prefix. Persisted with the receipt ledger. |
| Game plugin key | `app/plugin-keys.mjs` | Deliberate `gpk_` plus 32 random bytes encoded as base64url; plugin bearer only, hash saved in `plugin-keys.json`. Generation is unchanged. |

`isCredential` and `bearerHash` inspect the Authorization header, not cookies,
URLs or request bodies. Any bearer starting with `gpk_`, including malformed,
unknown or revoked keys, still fails picker authentication before cookie
fallback. Ordinary tokens presented in that header must therefore avoid the
namespace even when their intended authentication channel is different.

## Existing credentials

The saved master token can already have the reserved prefix. There is no
existing master-token rotation path: loading preserves the file byte-for-byte
and does not silently invalidate clients. A colliding saved master token thus
still cannot authenticate as a picker bearer; this change prevents new
collisions rather than repairing that existing credential. Any remediation
needs a separately designed rotation path.

Existing invitation, session, overlay and recovery tokens are saved only as
hashes, so their prefixes cannot be inspected or selectively migrated. They are
left intact. Cookie, invitation-link and recovery authentication does not itself inspect the
plugin prefix. Existing colliding overlay keys remain subject to the picker
route guard; their existing revoke/create flow can replace them. OAuth and
deletion pending values expire in memory, and new values use the helper.

Temporary-file randomness, lock nonces, picker/account IDs and internal cache
ownership IDs are not authentication credentials; their hex/UUID/fixed-prefix
formats cannot collide with the plugin namespace. Synthetic operator and
benchmark fixture scripts are not service credential issuers.
