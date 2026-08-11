# Cairn

**Three projects. One next action each. A board of hard deadlines. A place to dump your
brain. One fifteen-minute review to reset the week.**

A calm, private, local-first task manager for people juggling too much. No account, no
server, no telemetry. Everything lives in your browser; nothing is ever sent anywhere.

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

Static output, so anything that serves files will do. No environment variables, no
server, no bindings, no secrets.

**Cloudflare Pages, from the dashboard (recommended).** Create a Pages project, connect
this repository, and set:

- Build command: `npm run build`
- Build output directory: `build`
- Deploy command: `npx wrangler pages deploy` — or leave it empty

Every push to `main` then deploys itself.

If a deploy command field exists and Cloudflare has pre-filled it with `npx wrangler
deploy`, change it. That is the _Workers_ command; it needs a Worker entrypoint, which a
static site does not have, so it fails with "Missing entry-point" immediately after a
build that succeeded — which reads like a build failure and is not one.

**Cloudflare Pages, from the CLI.** `wrangler.jsonc` already points at `build/`, so:

```bash
npm run build && npx wrangler pages deploy
```

This needs an API token with the **Cloudflare Pages → Edit** permission. A token with
only account-read scope authenticates successfully and then fails the deploy with
`Authentication error [code: 10000]`, which is easy to misread as a login problem — add
the Pages permission at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

## How it is built

```
src/lib/domain    pure logic — countdowns, week reset, WIP, triage, backup. No DB imports.
src/lib/repo      the only code that touches Dexie. One swap point for future sync.
src/lib/db        Dexie schema and migrations.
src/lib/stores    Svelte 5 runes over one live snapshot.
src/routes        six prerendered, client-rendered routes.
```

See [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) for the schema and its invariants, and
[`CLAUDE.md`](CLAUDE.md) for the architecture rules and the sharp edges worth knowing
about.

Tests: 1779 unit assertions run under Europe/London, America/Los_Angeles and
Pacific/Chatham (a 45-minute offset that observes DST), plus 45 Playwright tests covering
the core flows, onboarding, offline behaviour, installability, the export/import round
trip, and what happens when a write fails.
