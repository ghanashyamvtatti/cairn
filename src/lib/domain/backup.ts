import {
	DEFAULT_SETTINGS,
	type FixedDate,
	type InboxItem,
	type Project,
	type ProjectStatus,
	type ReviewStepId,
	type SettingKey,
	type SettingsMap,
	type Task,
	type Timestamp,
	type Week
} from '$lib/types';
import { parseIsoDate } from './countdown';
import { REVIEW_STEPS } from './review';
import { clampWipLimit } from './wip';

/**
 * Export and import.
 *
 * This is the app's insurance policy, and on iOS it is not optional: Safari evicts
 * script-created storage after seven days without interaction, and only Home-Screen
 * installed PWAs escape that timer. So the importer is written to be forgiving —
 * hand-edited files, files from an older version, and files with dangling references
 * all import as far as they can, dropping only what it cannot make sense of and saying
 * exactly what it dropped. A backup that refuses to load is not a backup.
 */

export const BACKUP_FORMAT = 'cairn.backup';
export const BACKUP_VERSION = 1;

export interface BackupData {
	projects: Project[];
	tasks: Task[];
	inboxItems: InboxItem[];
	fixedDates: FixedDate[];
	weeks: Week[];
	settings: Partial<SettingsMap>;
}

export interface BackupFile {
	format: typeof BACKUP_FORMAT;
	version: number;
	exportedAt: Timestamp;
	data: BackupData;
}

export function buildBackup(data: BackupData, now: Timestamp): BackupFile {
	return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, data };
}

/** Pretty-printed so a human can read and repair it in a text editor. */
export function serializeBackup(file: BackupFile): string {
	return JSON.stringify(file, null, 2);
}

export function backupFilename(now: Timestamp): string {
	const d = new Date(now);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `cairn-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export type ImportResult =
	| { ok: true; data: BackupData; exportedAt: Timestamp | null; warnings: string[] }
	| { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function nonEmptyStr(value: unknown): string | null {
	const s = str(value);
	return s !== null && s.trim() !== '' ? s : null;
}

function optionalStr(value: unknown): string | undefined {
	const s = str(value);
	return s !== null && s !== '' ? s : undefined;
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableNum(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	return num(value);
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

/** Every row needs the three tracking timestamps; missing ones default to `now`. */
function tracked(row: Record<string, unknown>, now: Timestamp) {
	return {
		createdAt: num(row.createdAt) ?? now,
		updatedAt: num(row.updatedAt) ?? num(row.createdAt) ?? now,
		deletedAt: nullableNum(row.deletedAt)
	};
}

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'parked', 'done'];

// ---------------------------------------------------------------------------
// Row validators. Each returns `null` to mean "drop this row".
// ---------------------------------------------------------------------------

function readProject(raw: unknown, now: Timestamp): Project | null {
	if (!isObject(raw)) return null;
	const id = nonEmptyStr(raw.id);
	const title = str(raw.title);
	if (!id || title === null) return null;

	const status = PROJECT_STATUSES.includes(raw.status as ProjectStatus)
		? (raw.status as ProjectStatus)
		: 'active';

	return {
		id,
		title,
		status,
		nextActionId: nonEmptyStr(raw.nextActionId),
		order: num(raw.order) ?? 0,
		...tracked(raw, now)
	};
}

function readTask(raw: unknown, now: Timestamp): Task | null {
	if (!isObject(raw)) return null;
	const id = nonEmptyStr(raw.id);
	const title = str(raw.title);
	if (!id || title === null) return null;

	return {
		id,
		projectId: nonEmptyStr(raw.projectId),
		title,
		notes: optionalStr(raw.notes),
		isNextAction: bool(raw.isNextAction, false),
		completedAt: nullableNum(raw.completedAt),
		weekId: nonEmptyStr(raw.weekId),
		...tracked(raw, now)
	};
}

function readInboxItem(raw: unknown, now: Timestamp): InboxItem | null {
	if (!isObject(raw)) return null;
	const id = nonEmptyStr(raw.id);
	const text = str(raw.text);
	if (!id || text === null) return null;

	const parsedDate = optionalStr(raw.parsedDate);

	return {
		id,
		text,
		parsedDate: parsedDate && parseIsoDate(parsedDate) ? parsedDate : undefined,
		...tracked(raw, now)
	};
}

function readFixedDate(raw: unknown, now: Timestamp): FixedDate | null {
	if (!isObject(raw)) return null;
	const id = nonEmptyStr(raw.id);
	const title = str(raw.title);
	const date = nonEmptyStr(raw.date);
	// An undated entry has no meaning on a departure board, so this one is fatal for
	// the row rather than repairable.
	if (!id || title === null || !date || !parseIsoDate(date)) return null;

	return {
		id,
		title,
		date,
		note: optionalStr(raw.note),
		...tracked(raw, now)
	};
}

function readWeek(raw: unknown, now: Timestamp): Week | null {
	if (!isObject(raw)) return null;
	const id = nonEmptyStr(raw.id);
	if (!id) return null;

	const knownSteps = new Set<string>(REVIEW_STEPS.map((s) => s.id));
	const steps = Array.isArray(raw.reviewSteps)
		? [...new Set(raw.reviewSteps.filter((s): s is ReviewStepId => knownSteps.has(s as string)))]
		: [];

	return {
		id,
		startedAt: num(raw.startedAt) ?? now,
		endedAt: nullableNum(raw.endedAt),
		reviewCompletedAt: nullableNum(raw.reviewCompletedAt),
		reviewSteps: steps
	};
}

function readSettings(raw: unknown): Partial<SettingsMap> {
	if (!isObject(raw)) return {};
	const out: Partial<SettingsMap> = {};

	const assign = <K extends SettingKey>(key: K, value: SettingsMap[K] | undefined) => {
		if (value !== undefined) out[key] = value;
	};

	if (raw.wipLimit !== undefined) {
		const n = num(raw.wipLimit);
		assign('wipLimit', n === null ? undefined : clampWipLimit(n));
	}
	if (raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark') {
		assign('theme', raw.theme);
	}
	if (raw.motion === 'system' || raw.motion === 'reduce') {
		assign('motion', raw.motion);
	}
	if (typeof raw.persistGranted === 'boolean') {
		assign('persistGranted', raw.persistGranted);
	}
	for (const key of [
		'persistNudgeDismissedAt',
		'installNudgeDismissedAt',
		'lastExportAt'
	] as const) {
		if (raw[key] !== undefined) assign(key, nullableNum(raw[key]));
	}

	return out;
}

// ---------------------------------------------------------------------------
// Whole-file import
// ---------------------------------------------------------------------------

function readCollection<T>(
	raw: unknown,
	name: string,
	read: (row: unknown, now: Timestamp) => T | null,
	now: Timestamp,
	warnings: string[]
): T[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		warnings.push(`"${name}" was not a list, so it was skipped.`);
		return [];
	}

	const out: T[] = [];
	let dropped = 0;
	for (const row of raw) {
		const parsed = read(row, now);
		if (parsed) out.push(parsed);
		else dropped += 1;
	}
	if (dropped > 0) {
		warnings.push(`Skipped ${dropped} unreadable ${name} ${dropped === 1 ? 'entry' : 'entries'}.`);
	}
	return out;
}

/**
 * Validates a parsed JSON value and repairs what it safely can.
 *
 * `now` is used to fill in missing timestamps so imported rows still sort sensibly.
 */
export function parseBackup(raw: unknown, now: Timestamp): ImportResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!isObject(raw)) {
		return { ok: false, errors: ['That file does not contain a Cairn backup.'] };
	}
	if (raw.format !== BACKUP_FORMAT) {
		return {
			ok: false,
			errors: [`Expected a "${BACKUP_FORMAT}" file but found "${String(raw.format)}".`]
		};
	}

	const version = num(raw.version);
	if (version === null) {
		errors.push('The backup is missing a version number.');
	} else if (version > BACKUP_VERSION) {
		errors.push(
			`This backup was written by a newer version of Cairn (format ${version}, this build reads ${BACKUP_VERSION}). Update the app and try again.`
		);
	}
	if (errors.length > 0) return { ok: false, errors };

	const dataRaw = isObject(raw.data) ? raw.data : null;
	if (!dataRaw) {
		return { ok: false, errors: ['The backup has no "data" section.'] };
	}

	const projects = readCollection(dataRaw.projects, 'project', readProject, now, warnings);
	const tasks = readCollection(dataRaw.tasks, 'task', readTask, now, warnings);
	const inboxItems = readCollection(dataRaw.inboxItems, 'inbox', readInboxItem, now, warnings);
	const fixedDates = readCollection(dataRaw.fixedDates, 'date', readFixedDate, now, warnings);
	const weeks = readCollection(dataRaw.weeks, 'week', readWeek, now, warnings);
	const settings = readSettings(dataRaw.settings);

	const repaired = repairReferences(
		{ projects, tasks, inboxItems, fixedDates, weeks, settings },
		warnings
	);

	return { ok: true, data: repaired, exportedAt: nullableNum(raw.exportedAt), warnings };
}

/**
 * Fixes dangling references so the app never renders a project pointing at a task that
 * is not there.
 *
 * Also enforces the core invariant — at most one Next Action per project — because a
 * merge, a partial restore, or a hand edit can easily produce two.
 */
export function repairReferences(data: BackupData, warnings: string[]): BackupData {
	const projectIds = new Set(data.projects.map((p) => p.id));
	const taskById = new Map(data.tasks.map((t) => [t.id, t]));

	let orphanedTasks = 0;
	for (const task of data.tasks) {
		if (task.projectId !== null && !projectIds.has(task.projectId)) {
			task.projectId = null;
			task.isNextAction = false;
			orphanedTasks += 1;
		}
	}
	if (orphanedTasks > 0) {
		warnings.push(
			`${orphanedTasks} task${orphanedTasks === 1 ? '' : 's'} pointed at a missing project and ${orphanedTasks === 1 ? 'was' : 'were'} moved out of any project.`
		);
	}

	let duplicateNextActions = 0;
	let danglingPointers = 0;

	for (const project of data.projects) {
		const candidates = data.tasks.filter(
			(t) => t.projectId === project.id && t.isNextAction && t.deletedAt === null
		);

		/*
		 * Only an incomplete task can actually move a project, so a finished one must
		 * never win the tie-break. Without this, a stale flag left on a completed task
		 * with a recent `updatedAt` would beat the real next action, the real one would be
		 * cleared as a duplicate, and the completed winner would then be cleared by the
		 * check below — importing the project stalled and silently losing the user's
		 * actual next step.
		 *
		 * When nothing incomplete is flagged we still fall back to the full candidate
		 * list, so the completed task reaches that check and gets its flag cleared.
		 */
		const eligible = candidates.filter((t) => t.completedAt === null);
		const pool = eligible.length > 0 ? eligible : candidates;

		// Prefer whatever the project already points at; otherwise the most recently
		// updated flagged task wins.
		let chosen = pool.find((t) => t.id === project.nextActionId) ?? null;
		if (!chosen && pool.length > 0) {
			chosen = [...pool].sort((a, b) => b.updatedAt - a.updatedAt)[0];
		}

		for (const candidate of candidates) {
			if (candidate.id !== chosen?.id) {
				candidate.isNextAction = false;
				duplicateNextActions += 1;
			}
		}

		// A completed task cannot be a next action.
		if (chosen && chosen.completedAt !== null) {
			chosen.isNextAction = false;
			chosen = null;
		}

		if (project.nextActionId !== null && !taskById.has(project.nextActionId)) {
			danglingPointers += 1;
		}

		project.nextActionId = chosen?.id ?? null;
	}

	if (duplicateNextActions > 0) {
		warnings.push(
			`${duplicateNextActions} extra next action${duplicateNextActions === 1 ? ' was' : 's were'} cleared — a project has exactly one.`
		);
	}
	if (danglingPointers > 0) {
		warnings.push(
			`${danglingPointers} project${danglingPointers === 1 ? '' : 's'} pointed at a task that is not in the backup.`
		);
	}

	const weekIds = new Set(data.weeks.map((w) => w.id));
	let unknownWeeks = 0;
	for (const task of data.tasks) {
		if (task.weekId !== null && !weekIds.has(task.weekId)) {
			task.weekId = null;
			unknownWeeks += 1;
		}
	}
	if (unknownWeeks > 0) {
		warnings.push(
			`${unknownWeeks} task${unknownWeeks === 1 ? '' : 's'} referenced a week that is not in the backup.`
		);
	}

	return data;
}

/**
 * Fills in defaults for anything the imported file did not carry.
 *
 * Copies key by key rather than spreading, and only for keys the current build knows
 * about. Object spread copies an own `__proto__` property straight through — which is
 * exactly what `JSON.parse` produces from a hand-edited file — and that value would
 * then be persisted and later assigned, invoking the prototype setter.
 */
export function withSettingDefaults(partial: Partial<SettingsMap>): SettingsMap {
	const merged = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
		if (Object.hasOwn(partial, key) && partial[key] !== undefined) {
			(merged as Record<string, unknown>)[key] = partial[key];
		}
	}
	return merged;
}

export interface BackupCounts {
	projects: number;
	tasks: number;
	inboxItems: number;
	fixedDates: number;
	weeks: number;
}

/** Shown in the "you are about to replace everything" confirmation. */
export function countBackup(data: BackupData): BackupCounts {
	return {
		projects: data.projects.filter((p) => p.deletedAt === null).length,
		tasks: data.tasks.filter((t) => t.deletedAt === null).length,
		inboxItems: data.inboxItems.filter((i) => i.deletedAt === null).length,
		fixedDates: data.fixedDates.filter((f) => f.deletedAt === null).length,
		weeks: data.weeks.length
	};
}
