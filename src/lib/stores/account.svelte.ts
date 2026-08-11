import { SyncingRepository, type SyncStatus } from '$lib/repo/syncing-repo';
import { syncClient, type Account } from '$lib/sync/client';
import { app } from './app.svelte';

/**
 * Who is signed in, and how the sync is going.
 *
 * Separate from the app store on purpose: the app store owns *what the data is*, this
 * owns *whether we are allowed to see it and whether it is current*. Mixing them would
 * mean every component that reads a project also depends on connection state.
 */
class AccountStore {
	account = $state<Account | null>(null);
	/** False until the first session check answers, so the UI can avoid flashing sign-in. */
	resolved = $state(false);
	/**
	 * False until the first pull for this account has finished.
	 *
	 * Between signing in and the data arriving, the app is legitimately empty — and
	 * anything that keys off emptiness will fire wrongly. The first-run welcome did
	 * exactly that on every second device, and because it is a modal `<dialog>` it made
	 * the page behind it inert, so the app silently ignored typing until it was dismissed.
	 */
	hydrated = $state(false);
	/**
	 * True only for an account that has genuinely never been used.
	 *
	 * Decided once, from the database straight after the first pull, rather than from the
	 * reactive snapshot. The snapshot passes through an empty state on every sign-in —
	 * the local cache is wiped before the pull — and anything reading emptiness reactively
	 * will catch that moment and act on it. That is how the first-run welcome kept
	 * appearing on second devices.
	 */
	freshAccount = $state(false);
	status = $state<SyncStatus>({ state: 'idle' });
	online = $state(true);
	pending = $state(0);

	private repo: SyncingRepository | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;

	get signedIn(): boolean {
		return this.account !== null;
	}

	attach(repo: SyncingRepository): void {
		this.repo = repo;
		repo.onstatus = (status) => {
			this.status = status;
			if (status.state === 'queued') this.pending = status.pending;
			if (status.state === 'synced') this.pending = 0;
		};
	}

	/**
	 * Establishes who is signed in, then does the first pull.
	 *
	 * The session cookie is httpOnly, so asking the server is the only way to know — the
	 * client genuinely cannot see whether it holds a valid session.
	 */
	async start(): Promise<void> {
		if (typeof window === 'undefined') return;

		this.online = navigator.onLine;
		window.addEventListener('online', this.handleOnline);
		window.addEventListener('offline', this.handleOffline);
		document.addEventListener('visibilitychange', this.handleVisible);

		try {
			this.account = await syncClient.session();
			if (this.account) await this.repo?.rememberAccount(this.account.id, this.account.email);
		} catch {
			/*
			 * The server is unreachable. Fall back to the account this device last used, so
			 * an offline launch opens the app over its cached data instead of demanding a
			 * sign-in it cannot possibly complete. Nothing is trusted from this: every
			 * request still carries the real cookie, and the server still decides.
			 */
			this.account = (await this.repo?.cachedAccount()) ?? null;
			this.status = { state: 'offline' };
		}
		this.resolved = true;

		if (this.account) {
			await this.refresh();
			await this.assessAccount();
		}
		this.hydrated = true;

		// A slow background poll so a change made on the other device turns up without
		// having to touch anything. Five minutes: often enough to feel live on a second
		// device, rare enough to be invisible on a phone battery.
		this.pollTimer = setInterval(() => void this.refresh(), 5 * 60 * 1000);
	}

	stop(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('online', this.handleOnline);
		window.removeEventListener('offline', this.handleOffline);
		document.removeEventListener('visibilitychange', this.handleVisible);
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = null;
	}

	/** Flush anything captured offline, then pull. Never throws at the caller. */
	async refresh(): Promise<void> {
		if (!this.repo || !this.account || !navigator.onLine) return;
		try {
			await this.repo.flushOutbox();
			await this.repo.pull();
			this.pending = await this.repo.pendingCount();
		} catch {
			// Already reported through onstatus; a failed refresh must never break the page.
		}
	}

	async signIn(email: string, password: string): Promise<void> {
		await this.adopt(await syncClient.signIn(email, password));
	}

	async signUp(email: string, password: string): Promise<void> {
		await this.adopt(await syncClient.signUp(email, password));
	}

	/**
	 * Switches the local cache over to an account.
	 *
	 * Wipes first, always. Signing in on a device that already holds another account's
	 * data — or anonymous data from before sync existed — would otherwise push that data
	 * into whichever account signed in next.
	 */
	private async adopt(account: Account): Promise<void> {
		if (!this.repo) throw new Error('Account store used before start()');
		await this.repo.resetLocal();
		this.hydrated = false;
		this.freshAccount = false;
		this.account = account;
		await this.repo.rememberAccount(account.id, account.email);
		try {
			await this.repo.pull();
			await this.assessAccount();
			// Let the pulled rows reach the store before the gate opens, so nothing renders
			// against the pre-sync snapshot.
			await app.waitForSnapshot(1500);
		} finally {
			// Even a failed first pull has to release the gate, or the app is stuck showing
			// nothing with no way forward.
			this.hydrated = true;
		}
	}

	/** Reads the database directly — no reactivity, no intermediate states. */
	private async assessAccount(): Promise<void> {
		if (!this.repo) return;
		try {
			const snapshot = await this.repo.readSnapshot();
			this.freshAccount =
				snapshot.settings.onboardedAt === null &&
				snapshot.projects.length === 0 &&
				snapshot.inboxItems.length === 0 &&
				snapshot.fixedDates.length === 0;
		} catch {
			this.freshAccount = false;
		}
	}

	async signOut(): Promise<void> {
		await syncClient.signOut();
		// The cache goes too. Leaving one account's data readable on a shared machine
		// after signing out would be its own kind of leak.
		await this.repo?.resetLocal();
		this.account = null;
		this.hydrated = false;
		this.freshAccount = false;
		this.status = { state: 'idle' };
	}

	private handleOnline = () => {
		this.online = true;
		void this.refresh();
	};

	private handleOffline = () => {
		this.online = false;
		this.status = { state: 'offline' };
	};

	private handleVisible = () => {
		if (document.visibilityState === 'visible') void this.refresh();
	};
}

export const account = new AccountStore();
