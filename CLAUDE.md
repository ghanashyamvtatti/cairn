# Cairn

A calm, private, local-first task manager. Three projects. One next action each. A board
of hard deadlines. A place to dump your brain. One fifteen-minute review to reset the week.

## Stack

SvelteKit 2 (Svelte 5 runes) · TypeScript · `adapter-static` · Dexie (IndexedDB) ·
`@vite-pwa/sveltekit` (Workbox) · date-fns · chrono-node · Vitest · Playwright.
Deployed as static files to Cloudflare Pages.

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
- `src/lib/repo` is the **only** thing that touches Dexie. It is the single swap point
  for a future sync layer.
- Every entity has a string UUID `id` plus `createdAt` / `updatedAt` / `deletedAt`. Never
  hard-delete; never use auto-increment keys. This is what lets sync drop in later.
- Countdowns are **computed at render, never stored**.
- Time is an argument, not an ambient global: domain functions take `now`, and the store
  exposes a reactive `app.now` that advances at local midnight.
- No analytics, no telemetry, no network calls, no account.
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
