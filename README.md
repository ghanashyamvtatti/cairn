# Cairn

**Three projects. One next action each. A board of hard deadlines. A place to dump your
brain. One fifteen-minute review to reset the week.**

A calm, private task manager for people juggling too much. One account keeps your laptop
and your phone showing the same thing; a copy stays in the browser so it opens instantly
and still works offline. No analytics, no telemetry, nothing shared or sold.

## The opinion

Most task managers fail the same way: you miss a few days, come back to a wall of red
overdue items, feel bad, and stop opening the app. Cairn is built so that cannot happen.

- **A limit on what is running.** Three active projects by default. Start a fourth and it
  says so, offers to park one, and then gets out of your way. The limit is yours to break
  — but going over it stays visible on the home screen instead of being a dialog you
  clicked past once and forgot.
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

## Finding your way in

First run opens a short welcome, and from there you can take a spotlight tour of the four
screens, load an example week to poke at, or read [the guide](src/routes/guide) — which is
also always available from the ⓘ in the header, from the `?` shortcut sheet, or by
pressing `g` then `?`.

## Running it

```bash
npm install
npm run dev
```

| command              | what it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | dev server on :5173                                    |
| `npm run build`      | static site to `build/`                                |
| `npm run preview`    | serve the production build                             |
| `npm run test:unit`  | Vitest, run under three timezones                      |
| `npm run test:e2e`   | Playwright against the production build                |
| `npm run check`      | svelte-check                                           |
| `npm run lint`       | prettier + eslint                                      |
| `npm run icons`      | regenerate PWA icons from `assets/icon.svg`            |
| `npm run dev:worker` | run the real Worker with D1 (needed for auth and sync) |
| `npm run db:local`   | apply D1 migrations locally                            |
| `npm run db:remote`  | apply D1 migrations to the deployed database           |

## Your data

In Cloudflare D1 under your account, so your devices agree, plus a cache in each browser's
IndexedDB so the app opens instantly and stays readable offline.

**The server is the arbiter and writes need a connection** — except capture, which is
append-only and therefore cannot conflict, so it queues offline and flushes on reconnect.
That is the whole consistency model: one place decides the order of events, so no merge
algorithm can be wrong. See [`docs/SYNC.md`](docs/SYNC.md).

There is no password reset yet, so **export a backup** from Settings now and then. It is
the only copy that survives losing access to the account.

Adding Cairn to your Home Screen or dock is still worth it — on iOS it exempts the offline
cache from Safari's seven-day storage eviction.

## Deploying

Static output, so anything that serves files will do. No environment variables, no
server, no bindings, no secrets.

**Cloudflare Pages, from the dashboard.** Connect this repository and set:

| Setting                | Value           |
| ---------------------- | --------------- |
| Framework preset       | None            |
| Build command          | `npm run build` |
| Build output directory | `build`         |
| Root directory         | (blank)         |

Leave any deploy command empty. Pages uploads `build/` itself using its own credentials,
so nothing else is needed and every push to `main` deploys itself.

Framework preset stays **None**: the SvelteKit preset assumes `adapter-cloudflare`, and
this is a pure static build via `adapter-static`.

**There is deliberately no `wrangler.jsonc` in this repo.** Cloudflare's build system
reads the presence of one as "this project deploys itself with wrangler" and fills in a
deploy command, which then needs an API token the build container does not necessarily
hold. The result is `Authentication error [code: 10000]` against `/pages/projects/...`
immediately after a build that succeeded — an error that reads like a login problem and
is really a wrong-tool problem. Without the file, Pages simply uploads the directory.

Vite 8 also needs Node >= 20.19. `.nvmrc` pins 22; without it the build fails on a syntax
error that says nothing about versions.

**From your own machine**, if you would rather not wire up Git:

```bash
npm run build && npx wrangler pages deploy build --project-name=cairn
```

That path does need a token with **Cloudflare Pages -> Edit**. A token with only
account-read scope authenticates fine and then fails the deploy — check it at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

## How it is built

```
src/lib/domain    pure logic — countdowns, week reset, WIP, triage, backup, credentials.
src/lib/repo      the only code that touches Dexie; SyncingRepository wraps DexieRepository.
src/lib/sync      the wire protocol, the HTTP client, and the snapshot diff.
src/lib/server    D1 access, password hashing, sessions. Never imported by client code.
src/lib/db        Dexie schema and migrations.
src/lib/stores    Svelte 5 runes over one live snapshot.
src/routes        six prerendered pages plus /api for auth and sync.
migrations        D1 schema.
```

See [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) for the schema and its invariants, and
[`CLAUDE.md`](CLAUDE.md) for the architecture rules and the sharp edges worth knowing
about.

Tests: 1779 unit assertions run under Europe/London, America/Los_Angeles and
Pacific/Chatham (a 45-minute offset that observes DST), plus 45 Playwright tests covering
the core flows, onboarding, offline behaviour, installability, the export/import round
trip, and what happens when a write fails.
