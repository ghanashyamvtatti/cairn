# Cairn

A calm, private, local-first task manager. Three projects. One next action each. A board
of hard deadlines. A place to dump your brain. One fifteen-minute review to reset the week.

The app opens on **Today** (`/`): one next action per active project, tickable in place,
plus the dates arriving within a fortnight. Management lives one tab away — Projects
(`/projects`), Dates (labelled "Dates" everywhere, route kept at `/manifest`), Inbox and
Review.

## Stack

SvelteKit 2 (Svelte 5 runes) · TypeScript · `adapter-cloudflare` · Dexie (IndexedDB) ·
Cloudflare D1 · `@vite-pwa/sveltekit` (Workbox) · date-fns · chrono-node · Vitest ·
Playwright. Deployed to Cloudflare Pages; pages are prerendered static files and only
`/api` reaches the Worker.

There is no `svelte.config.js` — SvelteKit config lives inline in `sveltekit()` inside
`vite.config.ts`.

## Commands

```
npm run dev            # dev server
npm run test:unit      # vitest, runs the suite under 3 timezones
npm run test:e2e       # playwright, builds and previews first
npm run check          # svelte-check
npm run lint           # prettier --check && eslint
npm run build          # static output to build/
npm run icons          # regenerate PWA icons from assets/icon.svg
```

## Non-goals — deliberately NOT built

Team collaboration. Unlimited projects. Sub-tasks or dependencies. A tags/labels
taxonomy. Time tracking. Gantt or Kanban boards. AI auto-scheduling. Calendar sync or
integrations. Per-task notifications.

Every "no" protects the opinion. Judge any proposed feature by one question: **does this
reduce or increase overwhelm?** If it increases it, it is a non-goal.

## Architecture rules

- Business logic lives in `src/lib/domain` as **pure functions** with no DB imports, unit
  tested without a database.
- `src/lib/repo` is the **only** thing that touches Dexie. `SyncingRepository` wraps
  `DexieRepository` and implements the same interface, which is why adding sync changed
  no route and no component.
- **The server decides; IndexedDB remembers.** Reads come from the local cache so the app
  opens instantly and works offline. Writes go to D1 and only survive locally if it
  accepted them. Capture is the sole exception: inbox items are appends, so they queue
  offline and flush on reconnect.
- A write is _computed_ by running it against the local database, then the moved rows are
  diffed out and pushed. A new repository method therefore needs no new sync code.
- Every entity has a string UUID `id` plus `createdAt` / `updatedAt` / `deletedAt`. Never
  hard-delete; never use auto-increment keys. This is what lets sync drop in later.
- Countdowns are **computed at render, never stored**.
- Time is an argument, not an ambient global: domain functions take `now`, and the store
  exposes a reactive `app.now` that advances at local midnight.
- No analytics and no telemetry. The app talks to its own API and nothing else.
- Invariants that must hold across devices live in SQL as partial unique indexes, not
  only in a Dexie transaction — one writer's transaction cannot constrain another's.
- The linter and formatter are the source of truth for style.

## Things that will bite you

- **IndexedDB cannot index booleans or `null`.** Declaring `isNextAction` or `deletedAt`
  as a Dexie index silently omits those rows from the index. Filter live/deleted in memory.
- **Never hand a `$state` value to Dexie.** `$state` deep-proxies its value and the
  structured clone algorithm cannot clone a Proxy — you get `DataCloneError`. Use
  `$state.raw` for anything destined for storage.
- **Never use the `autofocus` attribute inside a closed `<dialog>`.** The browser defers
  it and honours it on the next interaction, moving focus into an invisible field, which
  swallows keystrokes and disables every single-key shortcut. Focus imperatively instead.
- **`in` walks the prototype chain.** Use `Object.hasOwn` when gating on known keys, or a
  backup file keyed `__proto__` will reshape the object.
- Single-letter shortcuts are only safe because `isTypingTarget` suppresses them in
  fields. Keep that guard.
- **The repository reports a failed write and then RETHROWS.** Never assume the line
  after an `await app.repository.*` runs. Swallowing the error was worse than useless:
  a failed capture still said "saved", a failed restore still said "restored", and a
  failed export downloaded a file containing the word `undefined`. Use `fireAndForget`
  only where the toast is the whole response.
- `clientsClaim: true` is load-bearing. Without it the first page load is uncontrolled
  and installing then going offline gives a blank app.
- **`platform.env` throws during prerendering**, and optional chaining does not help
  because the access itself is the error. `hooks.server.ts` guards with `building`.
- **`@cloudflare/workers-types` must not be referenced globally.** It replaces the DOM
  lib, and client code loses `document`. Import `D1Database` inline instead.
- **Cloudflare caps PBKDF2 at 100,000 iterations, and only in production.** Above it,
  `crypto.subtle.deriveBits` throws `NotSupportedError`. The standalone workerd behind
  `wrangler pages dev` overrides the cap to no limit, so a higher count passes every unit
  test and all 52 e2e tests against a real Worker, then answers 500 to every sign-up on
  the deployed app. The cap is undocumented in Cloudflare's Web Crypto page. Local
  parity is not evidence for anything a limit enforcer governs.
- **SQLite checks unique indexes per statement, not at commit.** Moving a next action
  must write the demotion before the promotion, or the index sees two flagged tasks.
- **Never key UI off "the app looks empty" while signing in.** The cache is wiped before
  the pull, so anything reactive catches that gap — that is how the first-run welcome
  kept appearing on second devices, and being modal it made the page inert.
- Anything that dismisses a modal must not await a network write first.

## Onboarding

`/guide` is the reference; the spotlight tour in `components/Tour.svelte` is the
walkthrough; the welcome in `components/WelcomeDialog.svelte` fires once on an empty
database. Tour steps and the example week are plain data in `domain/tour.ts` and
`domain/example.ts`, so both are unit-tested without a browser. A tour step whose target
selector matches nothing degrades to a centred card rather than breaking the sequence —
keep it that way.

## Invariants worth protecting

- A project has **at most one** next action, and `project.nextActionId` always agrees
  with exactly one `task.isNextAction`. Both live in one Dexie transaction.
- A `FixedDate` has no completion field and no repository method can complete one. The
  "a calendar item is not a task" rule is enforced by the schema, not by hiding a button.
- The weekly reset never deletes, never marks anything late, and cannot retroactively
  move older history.
- Nothing in the UI is red, and nothing counts overdue items.
