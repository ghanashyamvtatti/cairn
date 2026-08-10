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
			await this.db.projects.update(id, { deletedAt: now, updatedAt: now, nextActionId: null });
			const tasks = await this.db.tasks.where('projectId').equals(id).toArray();
			for (const task of tasks) {
				if (task.deletedAt !== null) continue;
				await this.db.tasks.update(task.id, {
					deletedAt: now,
					updatedAt: now,
					isNextAction: false
				});
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

	async triageInboxItem(id: Id, action: TriageAction): Promise<void> {
		const item = await this.db.inboxItems.get(id);
		if (!item || item.deletedAt !== null) return;

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

		await this.deleteInboxItem(id);
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

	// -----------------------------------------------------------------------
	// Weeks
	// -----------------------------------------------------------------------

	async ensureCurrentWeek(): Promise<Week> {
		const open = await this.db.weeks.filter((w) => w.endedAt === null).toArray();
		if (open.length > 0) {
			return open.sort((a, b) => b.startedAt - a.startedAt)[0];
		}

		const week = startWeek(newId(), this.now());
		await this.db.weeks.add(week);
		return week;
	}

	async setReviewStep(step: ReviewStepId, done: boolean): Promise<void> {
		const week = await this.ensureCurrentWeek();
		await this.db.weeks.update(week.id, {
			reviewSteps: toggleReviewStep(week.reviewSteps, step, done)
		});
	}

	async completeReview(): Promise<void> {
		const week = await this.ensureCurrentWeek();
		await this.db.weeks.update(week.id, { reviewCompletedAt: this.now() });
	}

	async startNewWeek(): Promise<WeekResetSummary> {
		const now = this.now();
		const newWeekId = newId();

		return this.db.transaction(
			'rw',
			this.db.projects,
			this.db.tasks,
			this.db.weeks,
			async () => {
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
			}
		);
	}

	// -----------------------------------------------------------------------
	// Settings
	// -----------------------------------------------------------------------

	async setSetting<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void> {
		await this.db.settings.put({ key, value } as Setting);
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

		await this.db.transaction(
			'rw',
			this.db.projects,
			this.db.tasks,
			this.db.inboxItems,
			this.db.fixedDates,
			this.db.weeks,
			this.db.settings,
			async () => {
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
					(Object.entries(settings) as Array<[SettingKey, never]>).map(([key, value]) => ({
						key,
						value
					}))
				);
			}
		);

		// An import with no open week would leave the app with nowhere to file new work.
		await this.ensureCurrentWeek();

		return {
			projects: data.projects.length,
			tasks: data.tasks.length,
			inboxItems: data.inboxItems.length,
			fixedDates: data.fixedDates.length,
			weeks: data.weeks.length
		};
	}

	async clearAll(): Promise<void> {
		await this.db.transaction(
			'rw',
			this.db.projects,
			this.db.tasks,
			this.db.inboxItems,
			this.db.fixedDates,
			this.db.weeks,
			this.db.settings,
			async () => {
				await this.db.projects.clear();
				await this.db.tasks.clear();
				await this.db.inboxItems.clear();
				await this.db.fixedDates.clear();
				await this.db.weeks.clear();
				await this.db.settings.clear();
			}
		);
	}
}

function mergeSettings(rows: readonly Setting[]): SettingsMap {
	const merged: SettingsMap = { ...DEFAULT_SETTINGS };
	for (const row of rows) {
		if (row.key in merged) {
			(merged as Record<string, unknown>)[row.key] = row.value;
		}
	}
	return merged;
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
