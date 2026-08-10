import type { BackupData, BackupFile } from '$lib/domain/backup';
import type { WeekResetSummary } from '$lib/domain/week';
import type {
	FixedDate,
	Id,
	InboxItem,
	IsoDate,
	Project,
	ProjectStatus,
	ReviewStepId,
	SettingKey,
	SettingsMap,
	Task,
	Week
} from '$lib/types';

/**
 * The repository interface is the single swap point for storage.
 *
 * Nothing outside `src/lib/repo` imports Dexie. When sync arrives — Dexie Cloud, a
 * CRDT store, or an end-to-end-encrypted blob on a Durable Object — it replaces this
 * one implementation and every route and component is untouched.
 */

export interface Subscription {
	unsubscribe(): void;
}

/**
 * Minimal observable contract, structurally satisfied by Dexie's `liveQuery` so no
 * adapter is needed, and by anything else that can push values.
 */
export interface Observable<T> {
	subscribe(next: (value: T) => void, error?: (err: unknown) => void): Subscription;
}

/**
 * Everything the UI needs, read together.
 *
 * One consistent snapshot rather than six independent subscriptions: derived views
 * cannot then disagree with each other mid-transaction, and every projection over it
 * is a pure function.
 */
export interface Snapshot {
	projects: Project[];
	tasks: Task[];
	inboxItems: InboxItem[];
	fixedDates: FixedDate[];
	weeks: Week[];
	currentWeek: Week | null;
	settings: SettingsMap;
}

export const EMPTY_SNAPSHOT: Snapshot & { settings: SettingsMap } = {
	projects: [],
	tasks: [],
	inboxItems: [],
	fixedDates: [],
	weeks: [],
	currentWeek: null,
	// Replaced with real defaults by the repository on first read; this shape only
	// exists so components can render before the first emission.
	settings: {
		wipLimit: 3,
		theme: 'system',
		motion: 'system',
		persistGranted: false,
		persistNudgeDismissedAt: null,
		installNudgeDismissedAt: null,
		lastExportAt: null
	}
};

export interface NewTaskInput {
	projectId: Id | null;
	title: string;
	notes?: string;
	/** Promote straight to Next Action, replacing whatever the project points at. */
	asNextAction?: boolean;
}

export interface NewFixedDateInput {
	title: string;
	date: IsoDate;
	note?: string;
}

/**
 * What to do with an inbox item during triage.
 *
 * `to-manifest` exists because capture is the only sub-second entry point in the app;
 * a date you dumped into the inbox has to be able to reach the departure board without
 * being retyped.
 */
export type TriageAction =
	| { kind: 'to-next-action'; projectId: Id }
	| { kind: 'to-project'; projectId: Id }
	| { kind: 'to-new-project'; title?: string }
	| { kind: 'to-manifest'; date: IsoDate }
	| { kind: 'delete' };

export interface ImportSummary {
	projects: number;
	tasks: number;
	inboxItems: number;
	fixedDates: number;
	weeks: number;
}

export interface CairnRepository {
	// -- reads ---------------------------------------------------------------
	/** Live snapshot; re-emits on any write, including from another tab. */
	observeSnapshot(): Observable<Snapshot>;
	readSnapshot(): Promise<Snapshot>;

	// -- projects ------------------------------------------------------------
	createProject(title: string): Promise<Project>;
	renameProject(id: Id, title: string): Promise<void>;
	setProjectStatus(id: Id, status: ProjectStatus): Promise<void>;
	reorderProjects(orderedIds: readonly Id[]): Promise<void>;
	/** Soft-deletes the project and everything filed under it. */
	deleteProject(id: Id): Promise<void>;

	// -- tasks ---------------------------------------------------------------
	addTask(input: NewTaskInput): Promise<Task>;
	updateTask(id: Id, patch: Partial<Pick<Task, 'title' | 'notes'>>): Promise<void>;
	/**
	 * Designates a project's single Next Action. The previous one is demoted back to
	 * an ordinary task in the same project — never completed, never discarded.
	 * Passing `null` clears it, leaving the project stalled.
	 */
	setNextAction(projectId: Id, taskId: Id | null): Promise<void>;
	/**
	 * Completing a Next Action clears the project's pointer, so the project shows as
	 * stalled until you decide what moves it next. That prompt is the mechanism.
	 */
	completeTask(id: Id): Promise<void>;
	reopenTask(id: Id): Promise<void>;
	deleteTask(id: Id): Promise<void>;

	// -- inbox ---------------------------------------------------------------
	captureInboxItem(text: string, parsedDate?: IsoDate): Promise<InboxItem>;
	updateInboxItem(id: Id, text: string): Promise<void>;
	deleteInboxItem(id: Id): Promise<void>;
	triageInboxItem(id: Id, action: TriageAction): Promise<void>;

	// -- manifest ------------------------------------------------------------
	addFixedDate(input: NewFixedDateInput): Promise<FixedDate>;
	updateFixedDate(
		id: Id,
		patch: Partial<Pick<FixedDate, 'title' | 'date' | 'note'>>
	): Promise<void>;
	deleteFixedDate(id: Id): Promise<void>;

	// -- weeks ---------------------------------------------------------------
	ensureCurrentWeek(): Promise<Week>;
	setReviewStep(step: ReviewStepId, done: boolean): Promise<void>;
	completeReview(): Promise<void>;
	startNewWeek(): Promise<WeekResetSummary>;

	// -- settings ------------------------------------------------------------
	setSetting<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void>;

	// -- backup --------------------------------------------------------------
	exportAll(): Promise<BackupFile>;
	/** Replaces all local data. The caller is responsible for confirming intent. */
	importAll(data: BackupData): Promise<ImportSummary>;
	clearAll(): Promise<void>;
}
