import { json, type RequestHandler } from '@sveltejs/kit';

export const prerender = false;

/**
 * Who am I?
 *
 * The client asks once on start-up. It cannot read the session cookie itself — that is
 * the point of httpOnly — so this is the only way to know whether to show the app or the
 * sign-in screen.
 */
export const GET: RequestHandler = async (event) => {
	return json({ account: event.locals.account });
};
