import { json, type RequestHandler } from '@sveltejs/kit';
import { normaliseEmail } from '$lib/domain/credentials';
import { hashPassword, verifyPassword, type PasswordRecord } from '$lib/server/crypto';
import { requireDb } from '$lib/server/db';
import { createSession, setSessionCookie } from '$lib/server/session';

export const prerender = false;

interface AccountRow extends PasswordRecord {
	id: string;
	email: string;
}

/**
 * A hash to verify against when the account does not exist.
 *
 * Returning early on an unknown address would answer in a millisecond while a real
 * address takes the full PBKDF2 cost, and that difference is enough to enumerate who has
 * an account. Doing the same work either way removes the signal.
 */
let decoy: PasswordRecord | null = null;

export const POST: RequestHandler = async (event) => {
	const db = requireDb(event);
	const { email, password } = (await event.request.json()) as {
		email?: string;
		password?: string;
	};

	const row = await db
		.prepare(
			`SELECT id, email, password_hash AS hash, password_salt AS salt, iterations
			 FROM accounts WHERE lower(email) = ?`
		)
		.bind(normaliseEmail(email ?? ''))
		.first<AccountRow>();

	decoy ??= await hashPassword('never-matches-anything');
	const ok = await verifyPassword(password ?? '', row ?? decoy);

	// One message for both failures, so it never reveals which half was wrong.
	if (!row || !ok) {
		return json({ error: 'That email and password do not match.' }, { status: 401 });
	}

	setSessionCookie(event.cookies, await createSession(db, row.id, Date.now()));
	return json({ account: { id: row.id, email: row.email } });
};
