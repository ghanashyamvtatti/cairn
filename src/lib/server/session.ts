import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies } from '@sveltejs/kit';
import { hashSessionToken, randomHex } from './crypto';

/**
 * Session handling.
 *
 * Opaque random tokens in an httpOnly cookie rather than a JWT. There is exactly one
 * server and one database, so there is nothing to gain from a self-describing token and
 * a real cost: a JWT cannot be revoked before it expires, whereas deleting a row here
 * ends the session immediately.
 */

export const SESSION_COOKIE = 'cairn_session';
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Refresh a session's expiry once it is over halfway through its life. */
const REFRESH_AFTER_MS = SESSION_TTL_MS / 2;

export interface Account {
	id: string;
	email: string;
}

export interface SessionRow {
	account_id: string;
	email: string;
	expires_at: number;
}

export async function createSession(
	db: D1Database,
	accountId: string,
	now: number
): Promise<string> {
	const token = randomHex(32);
	await db
		.prepare(
			'INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
		)
		.bind(await hashSessionToken(token), accountId, now, now + SESSION_TTL_MS)
		.run();
	return token;
}

/**
 * Resolves a cookie value to an account, or `null`.
 *
 * Expired rows are deleted on sight rather than left to a scheduled job — there is no
 * scheduled job, and an expired session is the one moment we are certainly looking at
 * the row anyway.
 */
export async function resolveSession(
	db: D1Database,
	token: string | undefined,
	now: number
): Promise<Account | null> {
	if (!token) return null;

	const tokenHash = await hashSessionToken(token);
	const row = await db
		.prepare(
			`SELECT s.account_id, s.expires_at, a.email
			 FROM sessions s JOIN accounts a ON a.id = s.account_id
			 WHERE s.token_hash = ?`
		)
		.bind(tokenHash)
		.first<SessionRow>();

	if (!row) return null;

	if (row.expires_at <= now) {
		await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
		return null;
	}

	// Sliding expiry, but only written when it has actually moved meaningfully. Writing
	// on every request would put a D1 write in front of every read.
	if (row.expires_at - now < REFRESH_AFTER_MS) {
		await db
			.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
			.bind(now + SESSION_TTL_MS, tokenHash)
			.run();
	}

	return { id: row.account_id, email: row.email };
}

export async function destroySession(db: D1Database, token: string | undefined): Promise<void> {
	if (!token) return;
	await db
		.prepare('DELETE FROM sessions WHERE token_hash = ?')
		.bind(await hashSessionToken(token))
		.run();
}

export function setSessionCookie(cookies: Cookies, token: string): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		// `lax` rather than `strict`: the app is a PWA that gets opened from a home-screen
		// icon and from links, and `strict` would drop the cookie on those first requests.
		sameSite: 'lax',
		secure: true,
		maxAge: SESSION_TTL_MS / 1000
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
