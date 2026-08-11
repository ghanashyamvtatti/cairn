import type { SyncPayload, SyncPull, SyncPush } from './protocol';

/**
 * The HTTP half of sync. Knows about fetch and status codes and nothing about Dexie.
 *
 * Every call is same-origin and relies on the session cookie, which is httpOnly — the
 * client cannot read it, and does not need to. That is the whole reason the API lives on
 * this origin rather than a separate Worker: no token to store, and nothing for a script
 * injection to steal.
 */

export interface Account {
	id: string;
	email: string;
}

/** Thrown when another device changed a row first. The caller re-pulls and retries. */
export class SyncConflict extends Error {
	constructor(readonly seq: number) {
		super('Another device changed this first.');
		this.name = 'SyncConflict';
	}
}

export class NotSignedIn extends Error {
	constructor() {
		super('Sign in to sync.');
		this.name = 'NotSignedIn';
	}
}

async function readError(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string; message?: string };
		return body.error ?? body.message ?? fallback;
	} catch {
		return fallback;
	}
}

export class SyncClient {
	async session(): Promise<Account | null> {
		const response = await fetch('/api/auth/session');
		if (!response.ok) return null;
		const body = (await response.json()) as { account: Account | null };
		return body.account;
	}

	async signUp(email: string, password: string): Promise<Account> {
		return this.authenticate('/api/auth/sign-up', email, password);
	}

	async signIn(email: string, password: string): Promise<Account> {
		return this.authenticate('/api/auth/sign-in', email, password);
	}

	private async authenticate(url: string, email: string, password: string): Promise<Account> {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password })
		});

		if (!response.ok) throw new Error(await readError(response, 'That did not work.'));
		const body = (await response.json()) as { account: Account };
		return body.account;
	}

	async signOut(): Promise<void> {
		await fetch('/api/auth/sign-out', { method: 'POST' });
	}

	async pull(since: number): Promise<SyncPull> {
		const response = await fetch(`/api/sync?since=${since}`);
		if (response.status === 401) throw new NotSignedIn();
		if (!response.ok) throw new Error(await readError(response, 'Could not reach the server.'));
		return (await response.json()) as SyncPull;
	}

	async push(payload: SyncPayload, baseSeq: number): Promise<SyncPull> {
		const body: SyncPush = { baseSeq, ...payload };
		const response = await fetch('/api/sync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (response.status === 401) throw new NotSignedIn();
		if (response.status === 409) {
			const conflict = (await response.json()) as { seq: number };
			throw new SyncConflict(conflict.seq);
		}
		if (!response.ok) throw new Error(await readError(response, 'Could not save to the server.'));

		return (await response.json()) as SyncPull;
	}
}

export const syncClient = new SyncClient();
