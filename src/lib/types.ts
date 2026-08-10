/**
 * Core entity types for Cairn.
 *
 * Every entity carries a string UUID primary key plus `createdAt` / `updatedAt` /
 * `deletedAt` (epoch milliseconds). This is deliberate: auto-increment integer keys
 * collide when two devices generate rows independently, and a hard delete is
 * unrepresentable in a merge (a missing row cannot be distinguished from a row you
 * have not seen yet). Soft deletes + UUIDs let a CRDT/sync layer drop in later
 * without a schema rewrite.
 */

export type Id = string;

/** Epoch milliseconds. */
export type Timestamp = number;

/** A calendar date with no time component, `yyyy-MM-dd`, interpreted in local time. */
export type IsoDate = string;

export interface Tracked {
	createdAt: Timestamp;
	updatedAt: Timestamp;
	/** Soft delete. `null` means live. */
	deletedAt: Timestamp | null;
}

export type ProjectStatus = 'active' | 'parked' | 'done';

export interface Project extends Tracked {
	id: Id;
	title: string;
	status: ProjectStatus;
	/**
	 * Denormalised pointer to the project's single Next Action, for fast reads.
	 * `null` means the project is stalled. The authoritative flag is
	 * `Task.isNextAction`; these are kept in sync inside a single transaction.
	 */
	nextActionId: Id | null;
	/** Manual sort position among sibling projects. */
	order: number;
}

export interface Task extends Tracked {
	id: Id;
	/** `null` only for orphaned tasks; triage always assigns a project. */
	projectId: Id | null;
	title: string;
	notes?: string;
	isNextAction: boolean;
	completedAt: Timestamp | null;
	/** The week this task was completed or carried in. Stamped by the weekly reset. */
	weekId: Id | null;
}

export interface InboxItem extends Tracked {
	id: Id;
	text: string;
	/**
	 * A date parsed out of the captured text at capture time, if any. Purely a hint
	 * offered during triage — never acted on automatically.
	 */
	parsedDate?: IsoDate;
}

export interface FixedDate extends Tracked {
	id: Id;
	title: string;
	/** `yyyy-MM-dd`. Countdowns are computed at render, never stored. */
	date: IsoDate;
	note?: string;
}

/**
 * Ordered steps of the guided weekly review. Stored as ids so progress survives
 * a reload mid-review.
 */
export type ReviewStepId = 'brain-dump' | 'sort-inbox' | 'pick-next-actions' | 'scan-manifest';

export interface Week {
	id: Id;
	startedAt: Timestamp;
	endedAt: Timestamp | null;
	reviewCompletedAt: Timestamp | null;
	/** Which review steps have been ticked for this week. */
	reviewSteps: ReviewStepId[];
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type MotionPreference = 'system' | 'reduce';

/**
 * Typed settings map. Stored one row per key so a sync layer merges settings
 * field-by-field rather than clobbering the whole blob.
 */
export interface SettingsMap {
	/** Soft cap on simultaneously active projects. Exceeding it warns but is allowed. */
	wipLimit: number;
	theme: ThemePreference;
	motion: MotionPreference;
	/** Result of the last `navigator.storage.persist()` call. */
	persistGranted: boolean;
	/** When the user last dismissed the persistence nudge, so we do not nag. */
	persistNudgeDismissedAt: Timestamp | null;
	/** When the user last dismissed the iOS install instructions. */
	installNudgeDismissedAt: Timestamp | null;
	/** When the user last exported a backup, used to nudge gently after a while. */
	lastExportAt: Timestamp | null;
}

export type SettingKey = keyof SettingsMap;

export interface Setting<K extends SettingKey = SettingKey> {
	key: K;
	value: SettingsMap[K];
}

export const DEFAULT_SETTINGS: SettingsMap = {
	wipLimit: 3,
	theme: 'system',
	motion: 'system',
	persistGranted: false,
	persistNudgeDismissedAt: null,
	installNudgeDismissedAt: null,
	lastExportAt: null
};
