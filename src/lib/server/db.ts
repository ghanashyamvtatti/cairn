import type { D1Database } from '@cloudflare/workers-types';
import { error, type RequestEvent } from '@sveltejs/kit';

/**
 * Access to the database and the signed-in account, in the two forms endpoints need.
 *
 * Every server route goes through one of these rather than reaching into `platform`
 * directly, so "did I remember to scope this to the account?" has a single answer.
 */

export function requireDb(event: RequestEvent): D1Database {
	const db = event.platform?.env?.DB;
	if (!db) {
		// Reached when the D1 binding is missing — running `vite dev` without wrangler, or
		// a deployment where the binding was never attached. Say which, because the
		// alternative is a generic 500 that looks like a bug in the app.
		error(
			503,
			'The database is not connected. Run the app through wrangler, or attach the D1 binding.'
		);
	}
	return db;
}

export interface AuthedContext {
	db: D1Database;
	accountId: string;
}

/** Throws 401 unless the request carries a valid session. */
export function requireAccount(event: RequestEvent): AuthedContext {
	const db = requireDb(event);
	const account = event.locals.account;
	if (!account) error(401, 'Sign in to continue.');
	return { db, accountId: account.id };
}

/**
 * Claims the next sequence number for an account.
 *
 * One `UPDATE ... RETURNING` so the read and the increment cannot interleave with a
 * concurrent request from the user's other device. Every row written by a mutation
 * carries the number this returns, and clients pull everything above the cursor they
 * last saw.
 */
export async function nextSeq(db: D1Database, accountId: string): Promise<number> {
	const row = await db
		.prepare('UPDATE accounts SET seq = seq + 1 WHERE id = ? RETURNING seq')
		.bind(accountId)
		.first<{ seq: number }>();

	if (!row) error(401, 'That account no longer exists.');
	return row.seq;
}

export async function currentSeq(db: D1Database, accountId: string): Promise<number> {
	const row = await db
		.prepare('SELECT seq FROM accounts WHERE id = ?')
		.bind(accountId)
		.first<{ seq: number }>();
	return row?.seq ?? 0;
}
