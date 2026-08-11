import { json, type RequestHandler } from '@sveltejs/kit';
import { requireDb } from '$lib/server/db';
import { SESSION_COOKIE, clearSessionCookie, destroySession } from '$lib/server/session';

export const prerender = false;

export const POST: RequestHandler = async (event) => {
	// Deleted server-side as well as cleared client-side: an httpOnly cookie the browser
	// forgets is still a valid credential to anyone who copied it.
	await destroySession(requireDb(event), event.cookies.get(SESSION_COOKIE));
	clearSessionCookie(event.cookies);
	return json({ ok: true });
};
