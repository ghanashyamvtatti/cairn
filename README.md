# Cairn

**Three projects. One next action each. A board of hard deadlines. A place to dump your
brain. One fifteen-minute review to reset the week.**

A calm, private, local-first task manager for people juggling too much. No account, no
server, no telemetry. Everything lives in your browser; nothing is ever sent anywhere.

## The opinion

Most task managers fail the same way: you miss a few days, come back to a wall of red
overdue items, feel bad, and stop opening the app. Cairn is built so that cannot happen.

- **A hard cap on what is running.** Three active projects by default. Start a fourth and
  it tells you, offers to park one, and then gets out of the way — the limit is soft, but
  going over it stays visible instead of being a dialog you clicked past.
- **Exactly one next action per project.** A project with none is _stalled_, and the flag
  is an input box, because the only useful response to "this is stalled" is deciding what
  moves it.
- **Deadlines live somewhere else.** A departure board of dates counting down, entirely
  separate from tasks. Manifest items cannot be completed — a calendar item is not a
  to-do, and the schema enforces it.
- **Capture first, decide later.** One field, no required fields, under a second. Sorting
  is a different job from thinking of things.
- **A graceful reset.** Starting a new week files what you finished and carries what you
  did not — unchanged, unmarked, and never late. Nothing turns red. Nothing accumulates.

Deliberately absent: collaboration, sub-tasks, tags, time tracking, Kanban boards, AI
scheduling, calendar sync, and per-task notifications.

## Running it

```bash
npm install
npm run dev
```

| command             | what it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | dev server on :5173                         |
| `npm run build`     | static site to `build/`                     |
| `npm run preview`   | serve the production build                  |
| `npm run test:unit` | Vitest, run under three timezones           |
| `npm run test:e2e`  | Playwright against the production build     |
| `npm run check`     | svelte-check                                |
| `npm run lint`      | prettier + eslint                           |
| `npm run icons`     | regenerate PWA icons from `assets/icon.svg` |

## Your data

It is in this browser's IndexedDB and nowhere else. That is the point, and it is also the
risk, so **export a backup** from Settings: one JSON file, written entirely client-side.

On iPhone and iPad this matters more than usual. Safari clears a website's storage after
seven days without a visit. Web apps added to the Home Screen are not part of Safari and
are exempt from that timer — so if you use Cairn on iOS, add it to your Home Screen. The
app says so too, at the point where it matters.

## Deploying

Static output, so anything that serves files will do. For Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `build`
- No environment variables, no server, no bindings.

## How it is built

```
src/lib/domain    pure logic — countdowns, week reset, WIP, triage, backup. No DB imports.
src/lib/repo      the only code that touches Dexie. One swap point for future sync.
src/lib/db        Dexie schema and migrations.
src/lib/stores    Svelte 5 runes over one live snapshot.
src/routes        five prerendered, client-rendered routes.
```

See [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) for the schema and its invariants, and
[`CLAUDE.md`](CLAUDE.md) for the architecture rules and the sharp edges worth knowing
about.

Tests: 1698 unit assertions run under Europe/London, America/Los_Angeles and
Pacific/Chatham (a 45-minute offset that observes DST), plus 23 Playwright tests covering
the core flows, offline behaviour, installability, and the export/import round trip.
