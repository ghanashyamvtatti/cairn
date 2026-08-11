import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, resolveSession } from '$lib/server/session';

/**
 * Resolves the session once per request and hands it to endpoints via `locals`.
 *
 * Deliberately does not guard anything: every page is prerendered and client-rendered, so
 * there is no server-rendered content to protect. Authorisation lives in the `/api`
 * endpoints, each of which scopes its queries to `locals.account.id`. Putting it here as
 * well would give two places to forget it.
 */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.account = null;

	/*
	 * Skip entirely while prerendering.
	 *
	 * `platform.env` is a getter that *throws* during a prerender pass — optional chaining
	 * does not save you, because the access itself is the error. Every page is prerendered
	 * at build time, so without this guard the whole build fails with a 500 on each route.
	 */
	if (!building) {
		const db = event.platform?.env?.DB;
		if (db) {
			event.locals.account = await resolveSession(
				db,
				event.cookies.get(SESSION_COOKIE),
				Date.now()
			);
		}
	}

	return resolve(event);
};
