# Implementation status

Source of truth for what is built, what was decided, and what is deliberately deferred.
The original product research and rationale live in the strategy document this was built
from; this file records the decisions that shaped the code.

## Built — MVP v0.1

| Acceptance criterion                          | Where it lives                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| Projects with a WIP limit and one next action | `domain/wip.ts`, `components/ProjectCard.svelte`, `NewProjectDialog.svelte` |
| Fixed-dates manifest with live countdowns     | `domain/countdown.ts`, `routes/manifest`, `components/ManifestRow.svelte`   |
| Brain-dump inbox with triage                  | `routes/inbox`, `components/CaptureField.svelte`, `InboxItemRow.svelte`     |
| Weekly review ritual and new-week reset       | `domain/review.ts`, `domain/week.ts`, `routes/review`                       |
| Offline-first installable PWA                 | `vite.config.ts`, `src/app.html`                                            |
| Data export and import                        | `domain/backup.ts`, `routes/settings`                                       |

## Built — v1.0 polish

Natural-language capture (chrono-node, lazily loaded), full keyboard navigation with a
`g`-prefixed chord and a `?` help sheet, light/dark themes honouring the system setting
with an explicit override, `prefers-reduced-motion` support from both the system and an
in-app toggle, a well-timed `navigator.storage.persist()` request, coaching empty states,
gentle non-guilt styling throughout, an iOS install nudge worded as the storage-durability
feature it actually is, and Playwright coverage of every core flow.

## Decisions taken during the build

**The WIP cap is soft, and legible.** The plan contradicted itself — a "configurable soft
cap" in the acceptance criteria against "three projects" in the positioning. Resolved in
favour of soft: exceeding it is allowed. But the escape hatch is a persistent banner
rather than a one-time dialog, because a dialog you dismiss once stops constraining
anything by the second week.

**Setting a new next action demotes the old one.** "Archives/replaces" was ambiguous. The
previous next action stays in the project as an ordinary task — not completed, not
discarded. Losing work you had already decided on would be the wrong reading.

**Triage can send an item to the manifest.** The acceptance criteria list three
destinations; capture is the only sub-second entry point in the app, so a date you dumped
into the inbox has to reach the departure board without being retyped.

**No SPA fallback.** Every route is prerendered to its own HTML file, so Workbox
precaches each by name and a cold offline deep-link to `/inbox` works. A fallback rewrite
would have served the home page instead.

**`Week` gained a `reviewSteps` field.** Review progress must survive a reload mid-ritual,
and the week it belongs to is its natural home.

## Built — accounts and sync

The deferral below was taken up: two devices are now the point. `SyncingRepository` wraps
`DexieRepository` behind the same interface, which is why no route and no component
changed. The full design, including what was rejected, is in [`SYNC.md`](SYNC.md).

| Piece                   | Where it lives                                     |
| ----------------------- | -------------------------------------------------- |
| Wire protocol and diff  | `src/lib/sync/protocol.ts`, `diff.ts`, `client.ts` |
| Server-first writes     | `src/lib/repo/syncing-repo.ts`                     |
| Auth, sessions, hashing | `src/lib/server/`, `src/routes/api/auth/`          |
| The sync endpoint       | `src/routes/api/sync/+server.ts`                   |
| Schema and invariants   | `migrations/0001_initial.sql`                      |

**The server is the arbiter; there is no merge algorithm.** Writes go to D1 first and are
kept locally only if it accepted them, so there is never a divergent history to reconcile.
The cost is that most writes need a connection — accepted deliberately, because the
alternative is a CRDT whose conflict rules would have to encode "one next action per
project", and a rule that subtle is not something to infer from concurrent edits.

**Capture is the sole exception.** Inbox items are appends and therefore cannot conflict,
so they queue offline and flush on reconnect. Capture is also the one write that must
never fail — it is the whole promise of the brain dump.

**Invariants moved into SQL.** A Dexie transaction constrains one device; a partial unique
index constrains the account. Both `tasks_one_next_action` and `weeks_one_open` are
enforced by the database, which is what makes the two-device tests meaningful.

**Deliberately still missing: password reset.** It needs email, which means a provider, a
domain, and deliverability. Export from Settings is the answer until then, and the app
says so rather than implying otherwise.

## Deferred, behind the repository interface

- **Android Web Share Target.** A `share_target` entry in the manifest plus a `/share`
  route writing to the inbox. Requires an installed PWA; absent on iOS, so it needs a
  clipboard-paste fallback.
- **Web push.** A weekly-review nudge only, never per-task. Android and Home-Screen
  installed iOS 16.4+. Only worth adding if review completion turns out to be low without
  a reminder.

## Change triggers

- Wanting more than three active projects, or more than one next action per project, is a
  signal to revisit the _opinion_ before adding features. The constraint is the product.
- If iOS eviction bites during dogfooding, escalate the install nudge and add a recurring
  export reminder before anything else.
- Add sync only when you personally use two devices daily.

## Testing

1698 unit assertions run three times, under `Europe/London`, `America/Los_Angeles` and
`Pacific/Chatham` — the last has a 45-minute offset and observes DST, which is where
naive countdown arithmetic breaks. Repository tests run against real Dexie on
`fake-indexeddb`, and cover the one-next-action invariant, cascade deletes, triage, the
weekly reset, and the import round trip. Playwright covers the four critical flows plus
offline deep-linking, installability, export/import, and keyboard behaviour.
