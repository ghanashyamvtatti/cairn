# Data model

Everything lives in one IndexedDB database named `cairn`, reached only through
`src/lib/repo`. Schema is declared in `src/lib/db/index.ts`; the TypeScript types are in
`src/lib/types.ts`.

## Shared shape

Every entity except `Setting` carries:

| field       | type             | why                                                                                                                                |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string UUID      | Auto-increment integers collide across devices.                                                                                    |
| `createdAt` | epoch ms         |                                                                                                                                    |
| `updatedAt` | epoch ms         | Last-write-wins per field, if sync is ever added.                                                                                  |
| `deletedAt` | epoch ms \| null | Soft delete. A missing row cannot be distinguished from an unseen one in a merge — and it is what makes "Undo" a one-line restore. |

## Entities

```ts
Project   { id, title, status: 'active'|'parked'|'done',
            nextActionId: Id|null, order: number, …tracked }

Task      { id, projectId: Id|null, title, notes?,
            isNextAction: boolean, completedAt: number|null,
            weekId: Id|null, …tracked }

InboxItem { id, text, parsedDate?: IsoDate, …tracked }

FixedDate { id, title, date: IsoDate /* yyyy-MM-dd */, note?, …tracked }

Week      { id, startedAt, endedAt: number|null,
            reviewCompletedAt: number|null, reviewSteps: ReviewStepId[] }

Setting   { key: SettingKey, value }   // one row per key, so settings merge field-by-field
```

`Week.reviewSteps` is an addition to the original plan: review progress has to survive a
reload mid-ritual, and the week it belongs to is its natural home.

## Relationships

- **Project 1—0..1 Task** as its Next Action. `nextActionId` is denormalised for fast
  reads; `Task.isNextAction` is the authoritative flag. They are written together in one
  transaction and must never disagree. `repairReferences` in `domain/backup.ts` re-imposes
  this on import.
- **Project 1—N Task** for everything else in the project.
- **InboxItem** belongs to nothing until triaged, then it is consumed.
- **FixedDate** is related to nothing at all. That independence _is_ the "a calendar item
  is not a task" rule — it has no completion field, and no repository method can complete
  one.
- **Week** stamps tasks via `Task.weekId`. Exactly one week has `endedAt === null`.

## Indexes

```
projects    id, status, order, updatedAt
tasks       id, projectId, weekId, updatedAt
inboxItems  id, createdAt
fixedDates  id, date
weeks       id, startedAt
settings    key
```

Notably absent: `isNextAction` and `deletedAt`. IndexedDB rejects booleans and `null` as
keys, so indexing them would silently omit exactly the rows you wanted to find. Both are
filtered in memory, which is free at a scale bounded by a three-project WIP limit.

## Derived, never stored

- **Countdowns** — `differenceInCalendarDays(parseISO(date), today)` at render.
- **Stalled** — an active project whose `nextActionId` is `null`.
- **WIP status** — a count of active projects against the `wipLimit` setting.
- **Review progress** — derived from `Week.reviewSteps`.

## Backup format

```json
{
	"format": "cairn.backup",
	"version": 1,
	"exportedAt": 0,
	"data": {
		"projects": [],
		"tasks": [],
		"inboxItems": [],
		"fixedDates": [],
		"weeks": [],
		"settings": {}
	}
}
```

The importer is deliberately forgiving — a backup that refuses to load is not a backup.
Unreadable rows are dropped, dangling references repaired, and everything it changed is
reported to the user before they commit. A file from a _newer_ format version is refused
outright rather than partially understood.
