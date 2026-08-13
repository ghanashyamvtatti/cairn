import { building } from '$app/environment';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { SESSION_COOKIE, resolveSession } from '$lib/server/session';

/**
 * Puts the real exception in the Worker log, and nothing new on the wire.
 *
 * Without this, an unexpected throw in an endpoint reaches the client as SvelteKit's
 * bare `{"message":"Internal Error"}` and is written down nowhere. That is what a
 * platform-level `NotSupportedError` from `crypto.subtle` looked like from the outside:
 * a 500 with no cause, on a route whose validation and database access both demonstrably
 * worked. The message and stack belong in `wrangler pages deployment tail`, not in the
 * response — the client shape is deliberately unchanged.
 */
export const handleError: HandleServerError = ({ error, event }) => {
	console.error(`[${event.request.method}] ${event.url.pathname}`, error);
	return { message: 'Internal Error' };
};

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
