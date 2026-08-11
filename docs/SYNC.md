# Sync

Cairn was local-only until this point. This document is the design for making one
account's data consistent across devices, and the reasoning behind each choice — the
protocol details matter far less than getting the consistency model right, so that part
is stated first.

## What changes, and what does not

|                        | Before       | After                                           |
| ---------------------- | ------------ | ----------------------------------------------- |
| Source of truth        | IndexedDB    | D1, per account                                 |
| Reads                  | IndexedDB    | IndexedDB, as a cache refreshed from the server |
| Writes                 | IndexedDB    | Server, then the cache on success               |
| Account                | none         | required                                        |
| Offline                | fully usable | readable, plus capture — see below              |
| Data leaves the device | never        | yes, to your own Cloudflare account             |

The last row is the one that must be reflected in the UI copy. The guide currently says
"in this browser, on this device, and nowhere else", and that stops being true.

## The consistency model

**The server is the arbiter, and writes require connectivity.**

This is the deliberate choice. The alternative — accept writes locally and merge later —
means conflicts, and conflicts mean either a merge UI or silent data loss. Since the
stated priority is that two devices agree, the simplest way to guarantee that is to have
exactly one place where order is decided. No merge algorithm can be wrong if there is
nothing to merge.

**With one exception: capture is append-only, so it works offline.**

Requiring a network round trip to write down a passing thought would break the one
promise the product cannot break. Inbox items are appends — they reference nothing and
nothing references them — so two devices creating items offline can never conflict.
Captured items queue locally and flush on reconnect, in creation order.

Everything else — completing a task, setting a next action, starting a week — needs
connectivity, and the UI says so plainly rather than accepting the input and losing it.

## The cursor

Every mutation the server accepts increments a per-account counter and stamps the row
with it. Clients pull with `?since=<seq>` and get everything above that number.

A sequence number, not a timestamp. Client clocks disagree by seconds to minutes, and a
timestamp cursor silently skips rows written during the skew window. The counter is
assigned by one process and is monotonic by construction.

`updatedAt` stays on every row, but it is now display and audit metadata rather than
something correctness depends on.

## Endpoints

All same-origin SvelteKit server routes, all requiring a valid session.

```
POST /api/auth/sign-up      { email, password }         -> sets session cookie
POST /api/auth/sign-in      { email, password }         -> sets session cookie
POST /api/auth/sign-out                                 -> clears it

GET  /api/sync?since=<seq>                              -> { rows, seq }
POST /api/sync              { mutations: [...] }        -> { applied, rows, seq }
```

`POST /api/sync` is the only write path. A mutation names an entity, an id and a patch;
the server validates it, applies it inside one D1 transaction, and returns the resulting
rows so the client cache never has to guess what the server did.

Mutations carry a client-generated UUID. Replaying one is a no-op, so a retry after a
dropped connection cannot double-apply.

## Invariants the server must enforce

These are currently enforced in `DexieRepository` inside a Dexie transaction. They do not
survive being moved to a client that another client can contradict, so they move server-
side and are enforced in SQL:

- A project has **at most one** next action, and `project.nextActionId` agrees with
  exactly one `task.isNextAction`.
- A `FixedDate` has no completion field — unchanged, still enforced by the schema.
- Exactly one week per account has `endedAt IS NULL`.
- Every row belongs to exactly one account, and no query may omit the account filter.

The client keeps its own copies of these checks for immediate feedback, but the server's
answer is the one that counts.

## Tombstones

Soft deletes were already the rule and now earn their keep properly: a deleted row has to
travel to the other device _as_ a deletion. A row that simply vanished from a pull could
not be distinguished from one the client had not seen yet. `deletedAt` rows sync like any
other.

## What this costs

- **A lost password is a lost account.** Password reset needs email, which needs a mail
  provider. Until that exists, an export is the only recovery.
- **The app is no longer usable end-to-end offline.** Reads and capture work; nothing
  else does.
- **The data is readable by whoever controls the D1 database.** That is you, on your own
  Cloudflare account, but it is no longer a mathematical guarantee — it is a trust
  statement, and the copy must say so.

## Rejected alternatives

**CRDTs (Yjs, TinyBase MergeableStore).** Genuine offline-first multi-device merge, no
server arbitration. Rejected because the consistency question becomes "what does the CRDT
decide" rather than "what did the server decide", which is harder to reason about and
much harder to test, for a benefit — full offline writes — that was explicitly not the
priority.

**End-to-end encryption.** Compatible with accounts, and keeps the privacy claim literally
true. Rejected for now because it makes password reset impossible and roughly triples the
work. The schema does not preclude adding it later: the server treats row contents as
opaque in almost every endpoint already.

**Dexie Cloud.** Fastest path, but adds a third party holding the data and a per-seat
cost, when the same account already has D1 sitting free.
