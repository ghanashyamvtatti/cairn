import { json, type RequestHandler } from '@sveltejs/kit';
import { currentSeq, nextSeq, requireAccount } from '$lib/server/db';
import {
	readSince,
	upsertFixedDate,
	upsertInboxItem,
	upsertProject,
	upsertSetting,
	upsertTask,
	upsertWeek,
	type Statement
} from '$lib/server/rows';
import type { SyncPush } from '$lib/sync/protocol';
import { DEFAULT_SETTINGS, type SettingKey } from '$lib/types';

export const prerender = false;

/** Pull everything above the cursor. `?since=0`, or omitted, is a full download. */
export const GET: RequestHandler = async (event) => {
	const { db, accountId } = requireAccount(event);
	const since = Number(event.url.searchParams.get('since') ?? 0);

	const payload = await readSince(db, accountId, Number.isFinite(since) ? since : 0);
	return json({ ...payload, seq: await currentSeq(db, accountId) });
};

/**
 * The only write path.
 *
 * Three steps: refuse if anything the client is writing has moved on since the cursor it
 * based the change on, claim a new sequence number, then write every row at that number
 * in one batch. D1 runs a batch as a single transaction, so a partially applied push is
 * not a state anyone can observe.
 */
export const POST: RequestHandler = async (event) => {
	const { db, accountId } = requireAccount(event);
	const push = (await event.request.json()) as SyncPush;
	const baseSeq = Number.isFinite(push.baseSeq) ? push.baseSeq : 0;

	// --- has anyone else touched these rows since the client last looked?
	const touched: Array<[table: string, ids: string[]]> = [
		['projects', (push.projects ?? []).map((r) => r.id)],
		['tasks', (push.tasks ?? []).map((r) => r.id)],
		['inbox_items', (push.inboxItems ?? []).map((r) => r.id)],
		['fixed_dates', (push.fixedDates ?? []).map((r) => r.id)],
		['weeks', (push.weeks ?? []).map((r) => r.id)]
	];

	for (const [table, ids] of touched) {
		if (ids.length === 0) continue;
		const placeholders = ids.map(() => '?').join(',');
		const clash = await db
			.prepare(
				`SELECT 1 FROM ${table} WHERE account_id = ? AND seq > ? AND id IN (${placeholders}) LIMIT 1`
			)
			.bind(accountId, baseSeq, ...ids)
			.first();
		if (clash) {
			return json(
				{ ok: false, conflict: true, seq: await currentSeq(db, accountId) },
				{ status: 409 }
			);
		}
	}

	const settingKeys = Object.keys(push.settings ?? {}).filter((key): key is SettingKey =>
		Object.hasOwn(DEFAULT_SETTINGS, key)
	);
	if (settingKeys.length > 0) {
		const placeholders = settingKeys.map(() => '?').join(',');
		const clash = await db
			.prepare(
				`SELECT 1 FROM settings WHERE account_id = ? AND seq > ? AND key IN (${placeholders}) LIMIT 1`
			)
			.bind(accountId, baseSeq, ...settingKeys)
			.first();
		if (clash) {
			return json(
				{ ok: false, conflict: true, seq: await currentSeq(db, accountId) },
				{ status: 409 }
			);
		}
	}

	// --- claim a sequence number and write everything at it
	const seq = await nextSeq(db, accountId);
	const now = Date.now();
	/*
	 * Demotions before promotions.
	 *
	 * `tasks_one_next_action` is checked per statement, not deferred to the end of the
	 * transaction. Moving a project's next action means one row loses the flag and another
	 * gains it, and if the gain is written first there is an instant where two live tasks
	 * in the same project carry it — which the index correctly refuses. Ordering the
	 * batch removes the instant. The same reasoning applies to closing one week and
	 * opening the next.
	 */
	const tasks = [...(push.tasks ?? [])].sort(
		(a, b) => Number(a.isNextAction) - Number(b.isNextAction)
	);
	const weeks = [...(push.weeks ?? [])].sort(
		(a, b) => Number(a.endedAt === null) - Number(b.endedAt === null)
	);

	const statements: Statement[] = [
		...(push.projects ?? []).map((r) => upsertProject(accountId, seq, r)),
		...tasks.map((r) => upsertTask(accountId, seq, r)),
		...(push.inboxItems ?? []).map((r) => upsertInboxItem(accountId, seq, r)),
		...(push.fixedDates ?? []).map((r) => upsertFixedDate(accountId, seq, r)),
		...weeks.map((r) => upsertWeek(accountId, seq, r)),
		...settingKeys.map((key) => upsertSetting(accountId, seq, key, (push.settings ?? {})[key], now))
	];

	if (statements.length > 0) {
		try {
			await db.batch(statements.map((s) => db.prepare(s.sql).bind(...s.values)));
		} catch (cause) {
			/*
			 * A constraint violation here is not a server fault — it is another device
			 * having already claimed something exclusive: the single next action on a
			 * project, or the single open week. The partial unique indexes are what make
			 * that race impossible to win twice, and the right answer is the same as for a
			 * stale cursor: tell the client to re-pull and replay. Reporting it as a 500
			 * would look like the app was broken and give the client nothing to do.
			 */
			const message = cause instanceof Error ? cause.message : String(cause);
			if (/UNIQUE|constraint/i.test(message)) {
				return json(
					{ ok: false, conflict: true, seq: await currentSeq(db, accountId) },
					{ status: 409 }
				);
			}
			throw cause;
		}
	}

	// Return everything the client has not seen — its own write, plus anything another
	// device did to rows it did not touch.
	const payload = await readSince(db, accountId, baseSeq);
	return json({ ok: true, ...payload, seq });
};
