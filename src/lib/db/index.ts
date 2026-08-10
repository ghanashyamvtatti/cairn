import Dexie, { type Table } from 'dexie';
import type { FixedDate, InboxItem, Project, Setting, Task, Week } from '$lib/types';

/**
 * Dexie schema.
 *
 * Two IndexedDB rules drive what is indexed here: booleans and `null` are not valid
 * keys. Declaring `isNextAction` or `deletedAt` as an index compiles happily but
 * silently omits every row holding `false`/`null` from that index, so a query like
 * `where('deletedAt').equals(null)` would return nothing at all. Only real key types
 * are indexed; live-vs-deleted filtering happens in memory, which costs nothing at a
 * scale bounded by a three-project WIP limit.
 */

export const DB_NAME = 'cairn';

export class CairnDatabase extends Dexie {
	projects!: Table<Project, string>;
	tasks!: Table<Task, string>;
	inboxItems!: Table<InboxItem, string>;
	fixedDates!: Table<FixedDate, string>;
	weeks!: Table<Week, string>;
	settings!: Table<Setting, string>;

	constructor(name: string = DB_NAME) {
		super(name);

		this.version(1).stores({
			projects: 'id, status, order, updatedAt',
			tasks: 'id, projectId, weekId, updatedAt',
			inboxItems: 'id, createdAt',
			fixedDates: 'id, date',
			weeks: 'id, startedAt',
			settings: 'key'
		});
	}
}

let instance: CairnDatabase | null = null;

/**
 * Lazily opens the database.
 *
 * Deferred rather than created at module scope so that importing anything from the
 * repository layer during prerendering cannot try to touch IndexedDB in Node.
 */
export function getDb(): CairnDatabase {
	instance ??= new CairnDatabase();
	return instance;
}

/** Test seam: swap in a uniquely named database per test file. */
export function setDb(db: CairnDatabase | null): void {
	instance = db;
}
