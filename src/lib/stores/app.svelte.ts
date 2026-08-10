import { countdownFor, partitionFixedDates } from '$lib/domain/countdown';
import { reviewProgress, type ReviewSignals } from '$lib/domain/review';
import { isReviewDue } from '$lib/domain/week';
import { activeProjects, parkedProjects, stalledProjects, wipStatus } from '$lib/domain/wip';
import { EMPTY_SNAPSHOT, type CairnRepository, type Snapshot, type Subscription } from '$lib/repo';
import { getRepository } from '$lib/repo/dexie-repo';
import type { FixedDate, Id, InboxItem, Project, Task } from '$lib/types';

function isLive<T extends { deletedAt: number | null }>(row: T): boolean {
	return row.deletedAt === null;
}

function msUntilNextLocalMidnight(from: number): number {
	const next = new Date(from);
	next.setHours(24, 0, 0, 0);
	// Clamp: a DST spring-forward can make this slightly under a day, and a clock
	// change could in principle make it non-positive.
	return Math.max(1000, next.getTime() - from);
}

/**
 * Application state.
 *
 * A single live snapshot from the repository, plus pure projections over it. Nothing
 * here caches derived values in the database — the WIP status, the stalled list, and
 * every countdown are recomputed from the snapshot and the current time, so they
 * cannot drift out of date.
 */
class AppStore {
	private repo: CairnRepository | null = null;
	private subscription: Subscription | null = null;
	private midnightTimer: ReturnType<typeof setTimeout> | null = null;

	snapshot = $state<Snapshot>({ ...EMPTY_SNAPSHOT });
	/** False until the first emission, so the UI can avoid flashing empty states. */
	ready = $state(false);
	error = $state<string | null>(null);

	/**
	 * Reactive "now", advanced at each local midnight. Countdowns read this so an app
	 * left open overnight does not keep insisting that today is tomorrow.
	 */
	now = $state(Date.now());

	// -- projections ---------------------------------------------------------

	settings = $derived(this.snapshot.settings);
	currentWeek = $derived(this.snapshot.currentWeek);

	allProjects = $derived(this.snapshot.projects.filter(isLive));
	active = $derived(activeProjects(this.snapshot.projects));
	parked = $derived(parkedProjects(this.snapshot.projects));
	done = $derived(this.allProjects.filter((p) => p.status === 'done'));
	stalled = $derived(stalledProjects(this.snapshot.projects));

	wip = $derived(wipStatus(this.snapshot.projects, this.snapshot.settings.wipLimit));

	allTasks = $derived(this.snapshot.tasks.filter(isLive));
	inbox = $derived(this.snapshot.inboxItems.filter(isLive));
	fixedDates = $derived(this.snapshot.fixedDates.filter(isLive));

	manifest = $derived(partitionFixedDates(this.fixedDates, this.now));

	review = $derived(reviewProgress(this.snapshot.currentWeek));
	reviewDue = $derived(isReviewDue(this.snapshot.currentWeek, this.now));

	reviewSignals: ReviewSignals = $derived({
		inboxCount: this.inbox.length,
		stalledCount: this.stalled.length,
		activeProjectCount: this.active.length,
		upcomingDateCount: this.manifest.upcoming.length
	});

	/** Everything that would make the home screen worth visiting. */
	isEmpty = $derived(
		this.allProjects.length === 0 && this.inbox.length === 0 && this.fixedDates.length === 0
	);

	// -- lookups -------------------------------------------------------------

	tasksFor(projectId: Id): Task[] {
		return this.allTasks
			.filter((t) => t.projectId === projectId)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	openTasksFor(projectId: Id): Task[] {
		return this.tasksFor(projectId).filter((t) => t.completedAt === null);
	}

	/** Tasks finished during the week currently open. Shown as evidence of progress. */
	completedThisWeek(projectId?: Id): Task[] {
		const weekId = this.snapshot.currentWeek?.id ?? null;
		return this.allTasks
			.filter((t) => t.completedAt !== null && t.weekId === weekId)
			.filter((t) => (projectId ? t.projectId === projectId : true))
			.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
	}

	nextActionFor(project: Project): Task | null {
		if (!project.nextActionId) return null;
		return this.allTasks.find((t) => t.id === project.nextActionId) ?? null;
	}

	projectById(id: Id | null): Project | null {
		if (!id) return null;
		return this.allProjects.find((p) => p.id === id) ?? null;
	}

	countdown(item: Pick<FixedDate, 'date'>) {
		return countdownFor(item.date, this.now);
	}

	// -- lifecycle -----------------------------------------------------------

	/**
	 * Subscribes to the repository. Safe to call more than once; only the first call
	 * does anything. Called from the root layout once the client is running, never
	 * during prerendering.
	 */
	async start(repo: CairnRepository = getRepository()): Promise<void> {
		if (this.subscription) return;
		this.repo = repo;

		try {
			await repo.ensureCurrentWeek();
		} catch (err) {
			this.error = describeError(err);
			return;
		}

		this.subscription = repo.observeSnapshot().subscribe(
			(value) => {
				this.snapshot = value;
				this.ready = true;
				this.error = null;
			},
			(err) => {
				this.error = describeError(err);
			}
		);

		this.scheduleMidnightTick();

		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this.handleVisibility);
		}
	}

	stop(): void {
		this.subscription?.unsubscribe();
		this.subscription = null;
		if (this.midnightTimer !== null) clearTimeout(this.midnightTimer);
		this.midnightTimer = null;
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.handleVisibility);
		}
	}

	/** The repository, once started. Throws rather than silently no-op'ing. */
	get repository(): CairnRepository {
		if (!this.repo) throw new Error('App store used before start()');
		return this.repo;
	}

	private handleVisibility = () => {
		// Background tabs have their timers throttled, so a tab restored the next morning
		// may not have fired its midnight tick. Re-sync on the way back in.
		if (document.visibilityState === 'visible') {
			this.now = Date.now();
			this.scheduleMidnightTick();
		}
	};

	private scheduleMidnightTick(): void {
		if (this.midnightTimer !== null) clearTimeout(this.midnightTimer);
		const delay = msUntilNextLocalMidnight(Date.now());
		this.midnightTimer = setTimeout(() => {
			this.now = Date.now();
			this.scheduleMidnightTick();
		}, delay);
	}
}

function describeError(err: unknown): string {
	if (err instanceof Error) {
		// The most likely real-world failure is a browser that blocks IndexedDB — private
		// windows in some browsers, or storage disabled entirely.
		if (err.name === 'SecurityError' || err.name === 'InvalidStateError') {
			return 'This browser is blocking local storage, so Cairn cannot save anything. Private browsing usually causes this.';
		}
		if (err.name === 'QuotaExceededError') {
			return 'There is no room left to save. Export a backup, then remove some data.';
		}
		return err.message;
	}
	return String(err);
}

export const app = new AppStore();

export type { InboxItem, Project, Task, FixedDate };
