import type { D1Database } from '@cloudflare/workers-types';
import type { SyncPayload } from '$lib/sync/protocol';
import {
	DEFAULT_SETTINGS,
	type FixedDate,
	type InboxItem,
	type Project,
	type ProjectStatus,
	type ReviewStepId,
	type SettingKey,
	type SettingsMap,
	type Task,
	type Week
} from '$lib/types';

/**
 * Translation between D1 rows and the entities the rest of the app already speaks.
 *
 * SQLite has no boolean and no null-vs-undefined distinction, so this is the one place
 * that knows `is_next_action` is an integer and that a missing note is `NULL` on the way
 * out and `undefined` on the way in. Keeping it in a single file means the sync endpoint
 * reads as though the database stored entities directly.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const optional = (value: unknown): string | undefined =>
	typeof value === 'string' && value !== '' ? value : undefined;
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const nullableNum = (value: unknown): number | null => (typeof value === 'number' ? value : null);

// -- reading ---------------------------------------------------------------

export function toProject(row: Record<string, unknown>): Project {
	return {
		id: text(row.id),
		title: text(row.title),
		status: text(row.status) as ProjectStatus,
		nextActionId: typeof row.next_action_id === 'string' ? row.next_action_id : null,
		order: num(row.sort_order),
		createdAt: num(row.created_at),
		updatedAt: num(row.updated_at),
		deletedAt: nullableNum(row.deleted_at)
	};
}

export function toTask(row: Record<string, unknown>): Task {
	return {
		id: text(row.id),
		projectId: typeof row.project_id === 'string' ? row.project_id : null,
		title: text(row.title),
		notes: optional(row.notes),
		isNextAction: num(row.is_next_action) === 1,
		completedAt: nullableNum(row.completed_at),
		weekId: typeof row.week_id === 'string' ? row.week_id : null,
		createdAt: num(row.created_at),
		updatedAt: num(row.updated_at),
		deletedAt: nullableNum(row.deleted_at)
	};
}

export function toInboxItem(row: Record<string, unknown>): InboxItem {
	return {
		id: text(row.id),
		text: text(row.text),
		parsedDate: optional(row.parsed_date),
		createdAt: num(row.created_at),
		updatedAt: num(row.updated_at),
		deletedAt: nullableNum(row.deleted_at)
	};
}

export function toFixedDate(row: Record<string, unknown>): FixedDate {
	return {
		id: text(row.id),
		title: text(row.title),
		date: text(row.date),
		note: optional(row.note),
		createdAt: num(row.created_at),
		updatedAt: num(row.updated_at),
		deletedAt: nullableNum(row.deleted_at)
	};
}

export function toWeek(row: Record<string, unknown>): Week {
	let steps: ReviewStepId[] = [];
	try {
		const parsed: unknown = JSON.parse(text(row.review_steps) || '[]');
		if (Array.isArray(parsed))
			steps = parsed.filter((s): s is ReviewStepId => typeof s === 'string');
	} catch {
		// A hand-edited row should cost the user their review ticks, not the whole pull.
	}

	return {
		id: text(row.id),
		startedAt: num(row.started_at),
		endedAt: nullableNum(row.ended_at),
		reviewCompletedAt: nullableNum(row.review_completed_at),
		reviewSteps: steps
	};
}

/**
 * Settings are stored one row per key so two devices changing different settings do not
 * fight over a single blob. Unknown keys are dropped rather than trusted.
 */
export function toSettings(rows: Record<string, unknown>[]): Partial<SettingsMap> {
	const out: Record<string, unknown> = {};
	for (const row of rows) {
		const key = text(row.key);
		if (!Object.hasOwn(DEFAULT_SETTINGS, key)) continue;
		try {
			out[key] = JSON.parse(text(row.value));
		} catch {
			// Skip the one bad setting rather than failing the sync.
		}
	}
	return out as Partial<SettingsMap>;
}

// -- writing ---------------------------------------------------------------

/**
 * Each entry is the SQL plus the bindings for one upsert.
 *
 * `ON CONFLICT ... DO UPDATE` rather than delete-then-insert: the row keeps its identity,
 * and a concurrent read never sees a moment where it does not exist.
 */
export interface Statement {
	sql: string;
	values: unknown[];
}

export function upsertProject(accountId: string, seq: number, p: Project): Statement {
	return {
		sql: `INSERT INTO projects (account_id, id, title, status, next_action_id, sort_order, created_at, updated_at, deleted_at, seq)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT (account_id, id) DO UPDATE SET
		        title = excluded.title, status = excluded.status,
		        next_action_id = excluded.next_action_id, sort_order = excluded.sort_order,
		        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
		        seq = excluded.seq`,
		values: [
			accountId,
			p.id,
			p.title,
			p.status,
			p.nextActionId,
			p.order,
			p.createdAt,
			p.updatedAt,
			p.deletedAt,
			seq
		]
	};
}

export function upsertTask(accountId: string, seq: number, t: Task): Statement {
	return {
		sql: `INSERT INTO tasks (account_id, id, project_id, title, notes, is_next_action, completed_at, week_id, created_at, updated_at, deleted_at, seq)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT (account_id, id) DO UPDATE SET
		        project_id = excluded.project_id, title = excluded.title, notes = excluded.notes,
		        is_next_action = excluded.is_next_action, completed_at = excluded.completed_at,
		        week_id = excluded.week_id, updated_at = excluded.updated_at,
		        deleted_at = excluded.deleted_at, seq = excluded.seq`,
		values: [
			accountId,
			t.id,
			t.projectId,
			t.title,
			t.notes ?? null,
			t.isNextAction ? 1 : 0,
			t.completedAt,
			t.weekId,
			t.createdAt,
			t.updatedAt,
			t.deletedAt,
			seq
		]
	};
}

export function upsertInboxItem(accountId: string, seq: number, i: InboxItem): Statement {
	return {
		sql: `INSERT INTO inbox_items (account_id, id, text, parsed_date, created_at, updated_at, deleted_at, seq)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT (account_id, id) DO UPDATE SET
		        text = excluded.text, parsed_date = excluded.parsed_date,
		        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
		        seq = excluded.seq`,
		values: [
			accountId,
			i.id,
			i.text,
			i.parsedDate ?? null,
			i.createdAt,
			i.updatedAt,
			i.deletedAt,
			seq
		]
	};
}

export function upsertFixedDate(accountId: string, seq: number, f: FixedDate): Statement {
	return {
		sql: `INSERT INTO fixed_dates (account_id, id, title, date, note, created_at, updated_at, deleted_at, seq)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT (account_id, id) DO UPDATE SET
		        title = excluded.title, date = excluded.date, note = excluded.note,
		        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
		        seq = excluded.seq`,
		values: [
			accountId,
			f.id,
			f.title,
			f.date,
			f.note ?? null,
			f.createdAt,
			f.updatedAt,
			f.deletedAt,
			seq
		]
	};
}

export function upsertWeek(accountId: string, seq: number, w: Week): Statement {
	return {
		sql: `INSERT INTO weeks (account_id, id, started_at, ended_at, review_completed_at, review_steps, seq)
		      VALUES (?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT (account_id, id) DO UPDATE SET
		        started_at = excluded.started_at, ended_at = excluded.ended_at,
		        review_completed_at = excluded.review_completed_at,
		        review_steps = excluded.review_steps, seq = excluded.seq`,
		values: [
			accountId,
			w.id,
			w.startedAt,
			w.endedAt,
			w.reviewCompletedAt,
			JSON.stringify(w.reviewSteps ?? []),
			seq
		]
	};
}

export function upsertSetting(
	accountId: string,
	seq: number,
	key: SettingKey,
	value: unknown,
	now: number
): Statement {
	return {
		sql: `INSERT INTO settings (account_id, key, value, updated_at, seq)
		      VALUES (?, ?, ?, ?, ?)
		      ON CONFLICT (account_id, key) DO UPDATE SET
		        value = excluded.value, updated_at = excluded.updated_at, seq = excluded.seq`,
		values: [accountId, key, JSON.stringify(value), now, seq]
	};
}

// -- reading a whole payload -----------------------------------------------

/** Everything above `since`. `since = 0` is a full download. */
export async function readSince(
	db: D1Database,
	accountId: string,
	since: number
): Promise<SyncPayload> {
	const query = async (table: string) => {
		const { results } = await db
			.prepare(`SELECT * FROM ${table} WHERE account_id = ? AND seq > ?`)
			.bind(accountId, since)
			.all<Record<string, unknown>>();
		return results ?? [];
	};

	return {
		projects: (await query('projects')).map(toProject),
		tasks: (await query('tasks')).map(toTask),
		inboxItems: (await query('inbox_items')).map(toInboxItem),
		fixedDates: (await query('fixed_dates')).map(toFixedDate),
		weeks: (await query('weeks')).map(toWeek),
		settings: toSettings(await query('settings'))
	};
}
