import { getDb, type CairnDatabase } from '$lib/db';
import type { BackupData, BackupFile } from '$lib/domain/backup';
import type { WeekResetSummary } from '$lib/domain/week';
import { SyncClient, SyncConflict, syncClient } from '$lib/sync/client';
import { countPayload, diffSnapshots, isEmptyPayload } from '$lib/sync/diff';
import type { SyncPayload } from '$lib/sync/protocol';
import type {
	FixedDate,
	Id,
	InboxItem,
	IsoDate,
	ProjectStatus,
	ReviewStepId,
	SettingKey,
	SettingsMap,
	Task,
	Project,
	Week
} from '$lib/types';
import { DexieRepository } from './dexie-repo';
import type {
	CairnRepository,
	ImportSummary,
	NewFixedDateInput,
	NewTaskInput,
	Observable,
	Snapshot,
	TriageAction
} from './index';

/**
 * The server decides; IndexedDB remembers.
 *
 * Reads never touch the network — they come from the local database, so the app opens
 * instantly and still shows your work with no connection. Writes go to the server, and
 * only survive locally if the server accepted them. That ordering is what makes two
 * devices agree: there is exactly one place where the order of events is decided, so
 * there is no merge algorithm that can be wrong.
 *
 * Each write runs against the local database first — not to commit it, but to *compute*
 * it. Every rule in `src/lib/domain` therefore stays the single implementation. The rows
 * that moved are diffed out and pushed; if the push fails the local write is rolled back
 * by re-pulling, so the screen never shows something the server does not hold.
 */
export class SyncingRepository implements CairnRepository {
	private readonly local: DexieRepository;
	private readonly db: CairnDatabase;
	private readonly client: SyncClient;

	/** Serialises writes. Two overlapping pushes would race on the cursor. */
	private queue: Promise<unknown> = Promise.resolve();

	/** Called whenever sync state changes, so the UI can show it. */
	onstatus: ((status: SyncStatus) => void) | null = null;

	constructor(
		local: DexieRepository = new DexieRepository(),
		db: CairnDatabase = getDb(),
		client: SyncClient = syncClient
	) {
		this.local = local;
		this.db = db;
		this.client = client;
	}

	// -----------------------------------------------------------------------
	// Cursor
	// -----------------------------------------------------------------------

	private async cursor(): Promise<number> {
		const row = await this.db.meta.get('cursor');
		return typeof row?.value === 'number' ? row.value : 0;
	}

	private async setCursor(seq: number): Promise<void> {
		await this.db.meta.put({ key: 'cursor', value: seq });
	}

	/**
	 * Drops everything local and starts from nothing.
	 *
	 * Used when signing in as a different account: the previous account's rows must not
	 * bleed into the new one, and a cursor from another account's sequence would silently
	 * skip real data.
	 */
	/**
	 * Remembers who this device belongs to, locally.
	 *
	 * The session cookie is httpOnly and the server is the only thing that can read it —
	 * which is fine until the server is unreachable. Without a local note of the account,
	 * opening the app on a train shows the sign-in screen over a database full of the
	 * user's own cached work.
	 */
	async rememberAccount(id: string, email: string): Promise<void> {
		await this.db.meta.put({ key: 'accountId', value: `${id}\u0000${email}` });
	}

	async cachedAccount(): Promise<{ id: string; email: string } | null> {
		const row = await this.db.meta.get('accountId');
		if (typeof row?.value !== 'string') return null;
		const [id, email] = row.value.split('\u0000');
		return id && email ? { id, email } : null;
	}

	async resetLocal(): Promise<void> {
		await this.local.clearAll();
		await this.db.meta.clear();
		await this.db.outbox.clear();
	}

	// -----------------------------------------------------------------------
	// Pull
	// -----------------------------------------------------------------------

	/** Fetches everything above the cursor and folds it into the local cache. */
	async pull(): Promise<void> {
		this.report({ state: 'syncing' });
		try {
			const since = await this.cursor();
			const incoming = await this.client.pull(since);
			await this.absorb(incoming, incoming.seq);

			/*
			 * A brand-new account has no week, and `importAll` creates one locally so the
			 * app has somewhere to file work. It has to reach the server too — otherwise the
			 * second device creates its own, and the one-open-week index rejects whichever
			 * pushes second, permanently.
			 */
			if (since === 0 && incoming.weeks.length === 0) {
				const local = await this.local.readSnapshot();
				if (local.weeks.length > 0) {
					const seeded = await this.client.push(
						{
							projects: [],
							tasks: [],
							inboxItems: [],
							fixedDates: [],
							weeks: local.weeks,
							settings: {}
						},
						await this.cursor()
					);
					await this.absorb(seeded, seeded.seq);
				}
			}

			this.report({ state: 'synced', at: Date.now() });
		} catch (error) {
			this.report({ state: 'error', message: describe(error) });
			throw error;
		}
	}

	/**
	 * Writes server rows into the local cache.
	 *
	 * A pull is partial, so this is an upsert of what arrived rather than a replacement.
	 * Tombstones come through as ordinary rows carrying `deletedAt` — which is exactly why
	 * nothing is ever hard-deleted.
	 */
	private async absorb(incoming: SyncPayload, seq: number): Promise<void> {
		await this.local.applyServerRows(incoming);
		await this.setCursor(seq);
	}

	// -----------------------------------------------------------------------
	// Write
	// -----------------------------------------------------------------------

	/**
	 * Runs a local mutation, then pushes whatever it changed.
	 *
	 * On failure the local database is put back by re-pulling from the server, so a
	 * rejected write never lingers on screen as though it had worked.
	 */
	private mutate<T>(run: () => Promise<T>, options: { offline?: 'queue' } = {}): Promise<T> {
		const task = this.queue.then(async () => {
			const before = await this.local.readSnapshot();
			const result = await run();
			const after = await this.local.readSnapshot();
			const payload = diffSnapshots(before, after);

			if (isEmptyPayload(payload)) return result;

			// Captures are appends and may wait for a connection. Everything else needs the
			// server now, because it depends on state another device could be changing.
			if (options.offline === 'queue' && !navigator.onLine) {
				await this.enqueue(payload);
				this.report({ state: 'queued', pending: await this.db.outbox.count() });
				return result;
			}

			this.report({ state: 'syncing' });
			try {
				const response = await this.client.push(payload, await this.cursor());
				await this.absorb(response, response.seq);
				this.report({ state: 'synced', at: Date.now() });
				return result;
			} catch (error) {
				if (options.offline === 'queue' && isOffline(error)) {
					await this.enqueue(payload);
					this.report({ state: 'queued', pending: await this.db.outbox.count() });
					return result;
				}

				// Put the screen back to what the server actually holds.
				await this.pull().catch(() => undefined);
				this.report({
					state: 'error',
					message:
						error instanceof SyncConflict
							? 'Another device changed that first. Cairn has refreshed — try again.'
							: describe(error)
				});
				throw error;
			}
		});

		this.queue = task.catch(() => undefined);
		return task;
	}

	private async enqueue(payload: SyncPayload): Promise<void> {
		const now = Date.now();
		await this.db.outbox.bulkPut(
			payload.inboxItems.map((item) => ({ id: item.id, queuedAt: now }))
		);
	}

	/**
	 * Pushes anything captured while offline, oldest first, then pulls.
	 *
	 * Safe to call repeatedly: the rows are read fresh from the local database each time,
	 * and an item already on the server upserts to the same value.
	 */
	async flushOutbox(): Promise<void> {
		const queued = await this.db.outbox.orderBy('queuedAt').toArray();
		if (queued.length === 0) return;

		const items = (await this.db.inboxItems.bulkGet(queued.map((row) => row.id))).filter(
			(item): item is InboxItem => item !== undefined
		);

		if (items.length > 0) {
			const response = await this.client.push(
				{ projects: [], tasks: [], inboxItems: items, fixedDates: [], weeks: [], settings: {} },
				await this.cursor()
			);
			await this.absorb(response, response.seq);
		}

		await this.db.outbox.bulkDelete(queued.map((row) => row.id));
		this.report({ state: 'synced', at: Date.now() });
	}

	async pendingCount(): Promise<number> {
		return this.db.outbox.count();
	}

	private report(status: SyncStatus): void {
		this.onstatus?.(status);
	}

	// -----------------------------------------------------------------------
	// CairnRepository — reads are local, writes go through `mutate`
	// -----------------------------------------------------------------------

	observeSnapshot(): Observable<Snapshot> {
		return this.local.observeSnapshot();
	}

	readSnapshot(): Promise<Snapshot> {
		return this.local.readSnapshot();
	}

	createProject(title: string): Promise<Project> {
		return this.mutate(() => this.local.createProject(title));
	}

	renameProject(id: Id, title: string): Promise<void> {
		return this.mutate(() => this.local.renameProject(id, title));
	}

	setProjectStatus(id: Id, status: ProjectStatus): Promise<void> {
		return this.mutate(() => this.local.setProjectStatus(id, status));
	}

	reorderProjects(orderedIds: readonly Id[]): Promise<void> {
		return this.mutate(() => this.local.reorderProjects(orderedIds));
	}

	deleteProject(id: Id): Promise<void> {
		return this.mutate(() => this.local.deleteProject(id));
	}

	restoreProject(id: Id): Promise<void> {
		return this.mutate(() => this.local.restoreProject(id));
	}

	addTask(input: NewTaskInput): Promise<Task> {
		return this.mutate(() => this.local.addTask(input));
	}

	updateTask(id: Id, patch: Partial<Pick<Task, 'title' | 'notes'>>): Promise<void> {
		return this.mutate(() => this.local.updateTask(id, patch));
	}

	setNextAction(projectId: Id, taskId: Id | null): Promise<void> {
		return this.mutate(() => this.local.setNextAction(projectId, taskId));
	}

	completeTask(id: Id): Promise<void> {
		return this.mutate(() => this.local.completeTask(id));
	}

	reopenTask(id: Id): Promise<void> {
		return this.mutate(() => this.local.reopenTask(id));
	}

	deleteTask(id: Id): Promise<void> {
		return this.mutate(() => this.local.deleteTask(id));
	}

	restoreTask(id: Id): Promise<void> {
		return this.mutate(() => this.local.restoreTask(id));
	}

	/** The one write that may happen without a connection. */
	captureInboxItem(text: string, parsedDate?: IsoDate): Promise<InboxItem> {
		return this.mutate(() => this.local.captureInboxItem(text, parsedDate), { offline: 'queue' });
	}

	updateInboxItem(id: Id, text: string): Promise<void> {
		return this.mutate(() => this.local.updateInboxItem(id, text));
	}

	deleteInboxItem(id: Id): Promise<void> {
		return this.mutate(() => this.local.deleteInboxItem(id));
	}

	restoreInboxItem(id: Id): Promise<void> {
		return this.mutate(() => this.local.restoreInboxItem(id));
	}

	triageInboxItem(id: Id, action: TriageAction): Promise<void> {
		return this.mutate(() => this.local.triageInboxItem(id, action));
	}

	addFixedDate(input: NewFixedDateInput): Promise<FixedDate> {
		return this.mutate(() => this.local.addFixedDate(input));
	}

	updateFixedDate(
		id: Id,
		patch: Partial<Pick<FixedDate, 'title' | 'date' | 'note'>>
	): Promise<void> {
		return this.mutate(() => this.local.updateFixedDate(id, patch));
	}

	deleteFixedDate(id: Id): Promise<void> {
		return this.mutate(() => this.local.deleteFixedDate(id));
	}

	restoreFixedDate(id: Id): Promise<void> {
		return this.mutate(() => this.local.restoreFixedDate(id));
	}

	/**
	 * Not wrapped: called during start-up before the first pull, and creating a week
	 * locally that the server then also creates would violate the one-open-week index.
	 * The pull brings the account's real week; this only guarantees the app has somewhere
	 * to file work when the account is brand new.
	 */
	ensureCurrentWeek(): Promise<Week> {
		return this.local.ensureCurrentWeek();
	}

	setReviewStep(step: ReviewStepId, done: boolean): Promise<void> {
		return this.mutate(() => this.local.setReviewStep(step, done));
	}

	completeReview(): Promise<void> {
		return this.mutate(() => this.local.completeReview());
	}

	startNewWeek(): Promise<WeekResetSummary> {
		return this.mutate(() => this.local.startNewWeek());
	}

	setSetting<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void> {
		return this.mutate(() => this.local.setSetting(key, value));
	}

	exportAll(): Promise<BackupFile> {
		return this.local.exportAll();
	}

	/** Replaces everything locally, then pushes the lot. */
	importAll(data: BackupData): Promise<ImportSummary> {
		return this.mutate(() => this.local.importAll(data));
	}

	clearAll(): Promise<void> {
		return this.mutate(() => this.local.clearAll());
	}
}

export type SyncStatus =
	| { state: 'idle' }
	| { state: 'syncing' }
	| { state: 'synced'; at: number }
	| { state: 'queued'; pending: number }
	| { state: 'offline' }
	| { state: 'error'; message: string };

function isOffline(error: unknown): boolean {
	// A dropped connection surfaces as a TypeError from fetch, not as a status code.
	return !navigator.onLine || (error instanceof TypeError && /fetch|network/i.test(error.message));
}

function describe(error: unknown): string {
	if (error instanceof SyncConflict) return error.message;
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * The count of rows a push carried, for logging and tests. Exported so the sync status
 * can say something more useful than "syncing".
 */
export { countPayload };
