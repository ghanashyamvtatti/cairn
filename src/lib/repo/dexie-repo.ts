import { liveQuery } from 'dexie';
import { getDb, type CairnDatabase } from '$lib/db';
import {
	buildBackup,
	withSettingDefaults,
	type BackupData,
	type BackupFile
} from '$lib/domain/backup';
import { systemClock, type Clock } from '$lib/domain/clock';
import { parseIsoDate } from '$lib/domain/countdown';
import { newId } from '$lib/domain/ids';
import { toggleReviewStep } from '$lib/domain/review';
import { planWeekReset, startWeek, type WeekResetSummary } from '$lib/domain/week';
import { clampWipLimit } from '$lib/domain/wip';
import {
	DEFAULT_SETTINGS,
	type FixedDate,
	type Id,
	type InboxItem,
	type IsoDate,
	type Project,
	type ProjectStatus,
	type ReviewStepId,
	type Setting,
	type SettingKey,
	type SettingsMap,
	type Task,
	type Timestamp,
	type Week
} from '$lib/types';
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
 * The only module in the app that knows Dexie exists.
 *
 * Every operation that touches more than one row runs inside a transaction, because
 * the app's core invariant — a project has at most one Next Action, and
 * `project.nextActionId` agrees with `task.isNextAction` — spans two tables and must
 * never be observable in a half-applied state.
 */
export class DexieRepository implements CairnRepository {
	private readonly db: CairnDatabase;
	private readonly clock: Clock;

	constructor(db: CairnDatabase = getDb(), clock: Clock = systemClock) {
		this.db = db;
		this.clock = clock;
	}

	private now(): Timestamp {
		return this.clock.now();
	}

	// -----------------------------------------------------------------------
	// Reads
	// -----------------------------------------------------------------------

	observeSnapshot(): Observable<Snapshot> {
		return liveQuery(() => this.readSnapshot()) as unknown as Observable<Snapshot>;
	}

	/**
	 * Reads every table.
	 *
	 * Awaited sequentially rather than through `Promise.all` so that Dexie's
	 * `liveQuery` reliably observes each table in its tracking zone and re-emits when
	 * any of them changes — including from another tab.
	 */
	async readSnapshot(): Promise<Snapshot> {
		const projects = await this.db.projects.toArray();
		const tasks = await this.db.tasks.toArray();
		const inboxItems = await this.db.inboxItems.toArray();
		const fixedDates = await this.db.fixedDates.toArray();
		const weeks = await this.db.weeks.toArray();
		const settingRows = await this.db.settings.toArray();

		projects.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
		inboxItems.sort((a, b) => b.createdAt - a.createdAt);
		weeks.sort((a, b) => b.startedAt - a.startedAt);

		return {
			projects,
			tasks,
			inboxItems,
			fixedDates,
			weeks,
			currentWeek: weeks.find((w) => w.endedAt === null) ?? null,
			settings: mergeSettings(settingRows)
		};
	}

	// -----------------------------------------------------------------------
	// Projects
	// -----------------------------------------------------------------------

	async createProject(title: string): Promise<Project> {
		const now = this.now();
		const maxOrder = await this.db.projects.orderBy('order').last();

		const project: Project = {
			id: newId(),
			title: title.trim(),
			status: 'active',
			nextActionId: null,
			order: (maxOrder?.order ?? -1) + 1,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		await this.db.projects.add(project);
		return project;
	}

	async renameProject(id: Id, title: string): Promise<void> {
		await this.db.projects.update(id, { title: title.trim(), updatedAt: this.now() });
	}

	async setProjectStatus(id: Id, status: ProjectStatus): Promise<void> {
		await this.db.projects.update(id, { status, updatedAt: this.now() });
	}

	async reorderProjects(orderedIds: readonly Id[]): Promise<void> {
		const now = this.now();
		await this.db.transaction('rw', this.db.projects, async () => {
			for (const [index, id] of orderedIds.entries()) {
				await this.db.projects.update(id, { order: index, updatedAt: now });
			}
		});
	}

	async deleteProject(id: Id): Promise<void> {
		const now = this.now();
		await this.db.transaction('rw', this.db.projects, this.db.tasks, async () => {
			/*
			 * Tombstone only. The next-action pointer and flag are deliberately preserved:
			 * a soft delete has to be exactly reversible, and clearing them meant an undo
			 * brought the project back stalled with its chosen next step forgotten. Nothing
			 * reads either field while the rows are deleted, because every projection
			 * filters tombstones out first.
			 */
			await this.db.projects.update(id, { deletedAt: now, updatedAt: now });

			const tasks = await this.db.tasks.where('projectId').equals(id).toArray();
			for (const task of tasks) {
				if (task.deletedAt !== null) continue;
				await this.db.tasks.update(task.id, { deletedAt: now, updatedAt: now });
			}
		});
	}

	/**
	 * Reverses `deleteProject`, including the tasks it cascaded over.
	 *
	 * The cascade stamps every task with the same instant as the project, so that
	 * timestamp identifies exactly what the delete took — and nothing a later, unrelated
	 * delete removed.
	 */
	async restoreProject(id: Id): Promise<void> {
		const now = this.now();
		await this.db.transaction('rw', this.db.projects, this.db.tasks, async () => {
			const project = await this.db.projects.get(id);
			if (!project || project.deletedAt === null) return;
			const deletedAt = project.deletedAt;

			await this.db.projects.update(id, { deletedAt: null, updatedAt: now });

			const tasks = await this.db.tasks.where('projectId').equals(id).toArray();
			for (const task of tasks) {
				if (task.deletedAt === deletedAt) {
					await this.db.tasks.update(task.id, { deletedAt: null, updatedAt: now });
				}
			}
		});
	}

	// -----------------------------------------------------------------------
	// Tasks
	// -----------------------------------------------------------------------

	async addTask(input: NewTaskInput): Promise<Task> {
		const now = this.now();
		const week = await this.ensureCurrentWeek();

		const task: Task = {
			id: newId(),
			projectId: input.projectId,
			title: input.title.trim(),
			notes: input.notes?.trim() || undefined,
			isNextAction: false,
			completedAt: null,
			weekId: week.id,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		await this.db.tasks.add(task);

		if (input.asNextAction && input.projectId) {
			await this.setNextAction(input.projectId, task.id);
			task.isNextAction = true;
		}

		return task;
	}

	async updateTask(id: Id, patch: Partial<Pick<Task, 'title' | 'notes'>>): Promise<void> {
		const changes: Partial<Task> = { updatedAt: this.now() };
		if (patch.title !== undefined) changes.title = patch.title.trim();
		if (patch.notes !== undefined) changes.notes = patch.notes.trim() || undefined;
		await this.db.tasks.update(id, changes);
	}

	async setNextAction(projectId: Id, taskId: Id | null): Promise<void> {
		const now = this.now();

		await this.db.transaction('rw', this.db.projects, this.db.tasks, async () => {
			// Demote whatever currently holds the flag. Queried by project rather than by
			// the denormalised pointer so a pointer that has drifted still gets repaired.
			const existing = await this.db.tasks.where('projectId').equals(projectId).toArray();
			for (const task of existing) {
				if (task.isNextAction && task.id !== taskId) {
					// Demoted, not completed and not discarded — it stays in the project.
					await this.db.tasks.update(task.id, { isNextAction: false, updatedAt: now });
				}
			}

			if (taskId !== null) {
				await this.db.tasks.update(taskId, {
					isNextAction: true,
					// Re-opening a finished task as the next action is a legitimate move.
					completedAt: null,
					updatedAt: now
				});
			}

			await this.db.projects.update(projectId, { nextActionId: taskId, updatedAt: now });
		});
	}

	async completeTask(id: Id): Promise<void> {
		const now = this.now();
		const week = await this.ensureCurrentWeek();

		await this.db.transaction('rw', this.db.projects, this.db.tasks, async () => {
			const task = await this.db.tasks.get(id);
			if (!task) return;

			await this.db.tasks.update(id, {
				completedAt: now,
				isNextAction: false,
				weekId: task.weekId ?? week.id,
				updatedAt: now
			});

			// Finishing the next action leaves the project stalled on purpose: the home
			// screen then asks what moves it next, which is the whole ritual in miniature.
			if (task.isNextAction && task.projectId) {
				await this.db.projects.update(task.projectId, { nextActionId: null, updatedAt: now });
			}
		});
	}

	async reopenTask(id: Id): Promise<void> {
		await this.db.tasks.update(id, { completedAt: null, updatedAt: this.now() });
	}

	async deleteTask(id: Id): Promise<void> {
		const now = this.now();
		await this.db.transaction('rw', this.db.projects, this.db.tasks, async () => {
			const task = await this.db.tasks.get(id);
			if (!task) return;

			await this.db.tasks.update(id, { deletedAt: now, isNextAction: false, updatedAt: now });

			if (task.isNextAction && task.projectId) {
				await this.db.projects.update(task.projectId, { nextActionId: null, updatedAt: now });
			}
		});
	}

	async restoreTask(id: Id): Promise<void> {
		await this.db.tasks.update(id, { deletedAt: null, updatedAt: this.now() });
	}

	// -----------------------------------------------------------------------
	// Inbox
	// -----------------------------------------------------------------------

	async captureInboxItem(text: string, parsedDate?: IsoDate): Promise<InboxItem> {
		const now = this.now();
		const item: InboxItem = {
			id: newId(),
			text: text.trim(),
			parsedDate: parsedDate && parseIsoDate(parsedDate) ? parsedDate : undefined,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		await this.db.inboxItems.add(item);
		return item;
	}

	async updateInboxItem(id: Id, text: string): Promise<void> {
		await this.db.inboxItems.update(id, { text: text.trim(), updatedAt: this.now() });
	}

	async deleteInboxItem(id: Id): Promise<void> {
		const now = this.now();
		await this.db.inboxItems.update(id, { deletedAt: now, updatedAt: now });
	}

	async restoreInboxItem(id: Id): Promise<void> {
		await this.db.inboxItems.update(id, { deletedAt: null, updatedAt: this.now() });
	}

	async triageInboxItem(id: Id, action: TriageAction): Promise<void> {
		/*
		 * Claim the item first, in its own transaction.
		 *
		 * Reading it, acting on it and then deleting it is a read-check-act race: two
		 * clicks in the same tick both saw a live item and both filed it, producing two
		 * tasks — or two projects — from one thought. Tombstoning up front means the second
		 * caller finds nothing to claim and does nothing.
		 */
		const item = await this.db.transaction('rw', this.db.inboxItems, async () => {
			const row = await this.db.inboxItems.get(id);
			if (!row || row.deletedAt !== null) return null;
			const now = this.now();
			await this.db.inboxItems.update(id, { deletedAt: now, updatedAt: now });
			return row;
		});

		if (!item) return;

		try {
			await this.fileTriagedItem(item, action);
		} catch (error) {
			// The claim is only safe because it is reversible. Without this, a destination
			// write that fails leaves the thought tombstoned and nothing created — it is
			// simply gone, with no undo anywhere in the UI.
			await this.db.inboxItems.update(id, { deletedAt: null, updatedAt: this.now() });
			throw error;
		}
	}

	private async fileTriagedItem(item: InboxItem, action: TriageAction): Promise<void> {
		switch (action.kind) {
			case 'delete':
				break;

			case 'to-project':
				await this.addTask({ projectId: action.projectId, title: item.text });
				break;

			case 'to-next-action':
				await this.addTask({
					projectId: action.projectId,
					title: item.text,
					asNextAction: true
				});
				break;

			case 'to-new-project': {
				// Naming the project separately means the captured text is the first thing
				// that moves it, so the project does not appear stalled seconds after being
				// created. Reusing the captured text as the name leaves it stalled, which is
				// honest — you have named an outcome but not yet decided on a step.
				const projectTitle = action.title?.trim() || item.text;
				const project = await this.createProject(projectTitle);

				if (projectTitle !== item.text) {
					await this.addTask({ projectId: project.id, title: item.text, asNextAction: true });
				}
				break;
			}

			case 'to-manifest':
				await this.addFixedDate({ title: item.text, date: action.date });
				break;
		}
	}

	// -----------------------------------------------------------------------
	// Manifest
	// -----------------------------------------------------------------------

	async addFixedDate(input: NewFixedDateInput): Promise<FixedDate> {
		const now = this.now();
		const entry: FixedDate = {
			id: newId(),
			title: input.title.trim(),
			date: input.date,
			note: input.note?.trim() || undefined,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		await this.db.fixedDates.add(entry);
		return entry;
	}

	async updateFixedDate(
		id: Id,
		patch: Partial<Pick<FixedDate, 'title' | 'date' | 'note'>>
	): Promise<void> {
		const changes: Partial<FixedDate> = { updatedAt: this.now() };
		if (patch.title !== undefined) changes.title = patch.title.trim();
		if (patch.date !== undefined) changes.date = patch.date;
		if (patch.note !== undefined) changes.note = patch.note.trim() || undefined;
		await this.db.fixedDates.update(id, changes);
	}

	async deleteFixedDate(id: Id): Promise<void> {
		const now = this.now();
		await this.db.fixedDates.update(id, { deletedAt: now, updatedAt: now });
	}

	async restoreFixedDate(id: Id): Promise<void> {
		await this.db.fixedDates.update(id, { deletedAt: null, updatedAt: this.now() });
	}

	// -----------------------------------------------------------------------
	// Weeks
	// -----------------------------------------------------------------------

	async ensureCurrentWeek(): Promise<Week> {
		// Read and create in ONE transaction. Split across two, a second tab opening the
		// app at the same moment also sees "no open week" and adds its own, leaving two
		// open weeks that no later reset can reconcile.
		return this.db.transaction('rw', this.db.weeks, async () => {
			const open = await this.db.weeks.filter((w) => w.endedAt === null).toArray();
			if (open.length > 0) {
				return open.sort((a, b) => b.startedAt - a.startedAt)[0];
			}

			const week = startWeek(newId(), this.now());
			await this.db.weeks.add(week);
			return week;
		});
	}

	async setReviewStep(step: ReviewStepId, done: boolean): Promise<void> {
		const { id } = await this.ensureCurrentWeek();
		// Re-read inside the transaction: this is a read-modify-write on an array, and
		// two ticks landing together would otherwise lose one.
		await this.db.transaction('rw', this.db.weeks, async () => {
			const current = await this.db.weeks.get(id);
			if (!current) return;
			await this.db.weeks.update(id, {
				reviewSteps: toggleReviewStep(current.reviewSteps, step, done)
			});
		});
	}

	async completeReview(): Promise<void> {
		const week = await this.ensureCurrentWeek();
		await this.db.weeks.update(week.id, { reviewCompletedAt: this.now() });
	}

	async startNewWeek(): Promise<WeekResetSummary> {
		const now = this.now();
		const newWeekId = newId();

		return this.db.transaction('rw', this.db.projects, this.db.tasks, this.db.weeks, async () => {
			const currentWeek = await this.ensureCurrentWeek();
			const tasks = await this.db.tasks.toArray();
			const projects = await this.db.projects.toArray();

			const plan = planWeekReset({ tasks, projects, currentWeek, now, newWeekId });

			if (plan.closedWeek) {
				await this.db.weeks.update(plan.closedWeek.id, { endedAt: plan.closedWeek.endedAt });
			}
			await this.db.weeks.add(plan.newWeek);

			for (const { id, weekId } of plan.archive) {
				await this.db.tasks.update(id, { weekId });
			}
			for (const { id, weekId } of plan.carry) {
				// Deliberately no `updatedAt` bump and no status change: carrying work
				// forward is not an edit, and nothing about it should read as late.
				await this.db.tasks.update(id, { weekId });
			}

			return plan.summary;
		});
	}

	// -----------------------------------------------------------------------
	// Settings
	// -----------------------------------------------------------------------

	async setSetting<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void> {
		// Clamp here rather than at the input, so a number typed into Settings can never
		// be stored and displayed as a limit the app is not actually enforcing.
		const stored = key === 'wipLimit' ? clampWipLimit(value as number) : value;
		await this.db.settings.put({ key, value: stored } as Setting);
	}

	// -----------------------------------------------------------------------
	// Backup
	// -----------------------------------------------------------------------

	async exportAll(): Promise<BackupFile> {
		const snapshot = await this.readSnapshot();
		return buildBackup(
			{
				projects: snapshot.projects,
				tasks: snapshot.tasks,
				inboxItems: snapshot.inboxItems,
				fixedDates: snapshot.fixedDates,
				weeks: snapshot.weeks,
				settings: snapshot.settings
			},
			this.now()
		);
	}

	async importAll(data: BackupData): Promise<ImportSummary> {
		const settings = withSettingDefaults(data.settings);

		// Dexie's variadic `transaction` overload tops out at five tables; past that the
		// array form is required. All six are listed because a partially-replaced
		// database is worse than a failed import.
		await this.db.transaction('rw', this.allTables(), async () => {
			await this.db.projects.clear();
			await this.db.tasks.clear();
			await this.db.inboxItems.clear();
			await this.db.fixedDates.clear();
			await this.db.weeks.clear();
			await this.db.settings.clear();

			await this.db.projects.bulkAdd(data.projects);
			await this.db.tasks.bulkAdd(data.tasks);
			await this.db.inboxItems.bulkAdd(data.inboxItems);
			await this.db.fixedDates.bulkAdd(data.fixedDates);
			await this.db.weeks.bulkAdd(data.weeks);
			await this.db.settings.bulkAdd(
				Object.entries(settings).map(([key, value]) => ({ key, value }) as Setting)
			);
		});

		// A backup can carry zero open weeks, or several. Exactly one must survive: close
		// every extra, keeping the most recent, then create one if none remained.
		await this.db.transaction('rw', this.db.weeks, async () => {
			const open = (await this.db.weeks.filter((w) => w.endedAt === null).toArray()).sort(
				(a, b) => b.startedAt - a.startedAt
			);
			for (const stale of open.slice(1)) {
				await this.db.weeks.update(stale.id, { endedAt: this.now() });
			}
		});
		await this.ensureCurrentWeek();

		return {
			projects: data.projects.length,
			tasks: data.tasks.length,
			inboxItems: data.inboxItems.length,
			fixedDates: data.fixedDates.length,
			weeks: data.weeks.length
		};
	}

	/**
	 * Folds rows arriving from the server into the local cache.
	 *
	 * Upserts only, never a clear. `importAll` empties every table first, and doing that on
	 * each pull made the UI flicker through an empty state — which destroys keyed
	 * components and, with them, whatever the user was in the middle of typing. Tombstones
	 * arrive as ordinary rows carrying `deletedAt`, so nothing ever needs removing.
	 */
	async applyServerRows(payload: {
		projects: Project[];
		tasks: Task[];
		inboxItems: InboxItem[];
		fixedDates: FixedDate[];
		weeks: Week[];
		settings: Partial<SettingsMap>;
	}): Promise<void> {
		await this.db.transaction('rw', this.allTables(), async () => {
			if (payload.projects.length) await this.db.projects.bulkPut(payload.projects);
			if (payload.tasks.length) await this.db.tasks.bulkPut(payload.tasks);
			if (payload.inboxItems.length) await this.db.inboxItems.bulkPut(payload.inboxItems);
			if (payload.fixedDates.length) await this.db.fixedDates.bulkPut(payload.fixedDates);
			if (payload.weeks.length) await this.db.weeks.bulkPut(payload.weeks);

			const settings = Object.entries(payload.settings);
			if (settings.length) {
				await this.db.settings.bulkPut(settings.map(([key, value]) => ({ key, value }) as Setting));
			}
		});
	}

	async clearAll(): Promise<void> {
		await this.db.transaction('rw', this.allTables(), async () => {
			await this.db.projects.clear();
			await this.db.tasks.clear();
			await this.db.inboxItems.clear();
			await this.db.fixedDates.clear();
			await this.db.weeks.clear();
			await this.db.settings.clear();
		});
	}

	private allTables() {
		return [
			this.db.projects,
			this.db.tasks,
			this.db.inboxItems,
			this.db.fixedDates,
			this.db.weeks,
			this.db.settings
		];
	}
}

/**
 * Layers stored settings over the defaults, ignoring keys the current build does not
 * know about — a backup from a newer version must not inject junk into the map.
 *
 * The gate is `Object.hasOwn`, not `in`. `in` walks the prototype chain, so a row keyed
 * `constructor`, `toString` or `__proto__` would pass as "known"; worse, assigning to
 * `__proto__` invokes the inherited setter and replaces the object's prototype instead
 * of adding a property. A hand-edited backup file is untrusted input and can contain
 * exactly that.
 */
function mergeSettings(rows: readonly Setting[]): SettingsMap {
	const merged = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
	for (const row of rows) {
		if (Object.hasOwn(DEFAULT_SETTINGS, row.key)) {
			Object.defineProperty(merged, row.key, {
				value: row.value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
	}
	return merged as unknown as SettingsMap;
}

let repository: CairnRepository | null = null;

/** Lazily constructed so nothing touches IndexedDB during prerendering. */
export function getRepository(): CairnRepository {
	repository ??= new DexieRepository();
	return repository;
}

/** Test seam. */
export function setRepository(repo: CairnRepository | null): void {
	repository = repo;
}
