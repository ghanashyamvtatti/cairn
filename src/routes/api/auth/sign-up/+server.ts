import { json, type RequestHandler } from '@sveltejs/kit';
import { checkCredentials, normaliseEmail } from '$lib/domain/credentials';
import { hashPassword } from '$lib/server/crypto';
import { requireDb } from '$lib/server/db';
import { newId } from '$lib/domain/ids';
import { createSession, setSessionCookie } from '$lib/server/session';

export const prerender = false;

export const POST: RequestHandler = async (event) => {
	const db = requireDb(event);
	const { email, password } = (await event.request.json()) as {
		email?: string;
		password?: string;
	};

	const problem = checkCredentials(email ?? '', password ?? '');
	if (problem) return json({ error: problem.message, field: problem.field }, { status: 400 });

	const address = normaliseEmail(email!);
	const now = Date.now();
	const record = await hashPassword(password!);
	const id = newId();

	try {
		await db
			.prepare(
				`INSERT INTO accounts (id, email, password_hash, password_salt, iterations, created_at, seq)
				 VALUES (?, ?, ?, ?, ?, ?, 0)`
			)
			.bind(id, address, record.hash, record.salt, record.iterations, now)
			.run();
	} catch (cause) {
		// The unique index on lower(email) is the only constraint that can fire here.
		const message = cause instanceof Error ? cause.message : '';
		if (/UNIQUE|constraint/i.test(message)) {
			return json(
				{ error: 'There is already an account with that address.', field: 'email' },
				{ status: 409 }
			);
		}
		throw cause;
	}

	setSessionCookie(event.cookies, await createSession(db, id, now));
	return json({ account: { id, email: address } }, { status: 201 });
};
