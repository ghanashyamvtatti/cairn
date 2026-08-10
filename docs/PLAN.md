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

## Deferred, behind the repository interface

- **Sync.** `CairnRepository` in `src/lib/repo/index.ts` is the only thing that touches
  Dexie. Dexie Cloud, a CRDT store, or an end-to-end-encrypted blob on a Cloudflare
  Durable Object all replace one file. Add it only when two devices are in daily use.
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
