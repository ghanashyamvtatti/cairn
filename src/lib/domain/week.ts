import type { Id, Project, Task, Timestamp, Week } from '$lib/types';
import { stalledProjects } from './wip';

/**
 * The graceful reset.
 *
 * Missing a week must not produce a wall of overdue items, because that is the exact
 * mechanic that makes people abandon task managers. Starting a new week closes the old
 * one, files everything you finished under it, and carries everything you did not
 * forward *without* marking it late. Nothing turns red; nothing accumulates.
 *
 * This module is pure. It computes a plan; the repository applies it in one
 * transaction. That split is what makes the carryover rules unit-testable without a
 * database.
 */

export interface WeekResetInput {
	/** All live tasks. Deleted rows are ignored. */
	tasks: readonly Task[];
	projects: readonly Project[];
	/** The week being closed, or `null` on the very first reset. */
	currentWeek: Week | null;
	now: Timestamp;
	/** Pre-generated so callers control identity and tests stay deterministic. */
	newWeekId: Id;
}

export interface WeekResetSummary {
	/** Finished tasks filed under the week just closed. */
	archived: number;
	/** Unfinished tasks moved into the new week, guilt-free. */
	carried: number;
	/** Of those carried, how many were a project's Next Action. */
	carriedNextActions: number;
	/** Active projects that still have no Next Action. */
	stalled: number;
}

export interface WeekResetPlan {
	newWeek: Week;
	/** The previous week with `endedAt` stamped, or `null` if there was none. */
	closedWeek: Week | null;
	/**
	 * Completed tasks that still need a week stamped on them. Tasks completed during
	 * the week being closed normally already carry its id, so this list is usually
	 * short — it exists to catch rows imported or created before any week existed.
	 */
	archive: Array<{ id: Id; weekId: Id }>;
	/** Unfinished tasks and the new week id they carry into. */
	carry: Array<{ id: Id; weekId: Id }>;
	summary: WeekResetSummary;
}

function isLive<T extends { deletedAt: Timestamp | null }>(row: T): boolean {
	return row.deletedAt === null;
}

export function startWeek(id: Id, now: Timestamp): Week {
	return { id, startedAt: now, endedAt: null, reviewCompletedAt: null, reviewSteps: [] };
}

/**
 * Computes every mutation the weekly reset should make.
 *
 * A completed task keeps the week it was already filed under, so re-running the reset
 * is idempotent for history and cannot retroactively move last month's finished work
 * into last week.
 */
export function planWeekReset(input: WeekResetInput): WeekResetPlan {
	const { tasks, projects, currentWeek, now, newWeekId } = input;

	const closingWeekId = currentWeek?.id ?? null;
	const newWeek = startWeek(newWeekId, now);
	const closedWeek: Week | null = currentWeek ? { ...currentWeek, endedAt: now } : null;

	const archive: Array<{ id: Id; weekId: Id }> = [];
	const carry: Array<{ id: Id; weekId: Id }> = [];
	let carriedNextActions = 0;
	let archivedThisWeek = 0;

	for (const task of tasks) {
		if (!isLive(task)) continue;

		if (task.completedAt !== null) {
			// A task completed during the week normally already carries that week's id;
			// leave it alone, so re-running the reset cannot retroactively move last
			// month's finished work into last week. Only unstamped rows get a stamp, and
			// they fall back to the new week when no week has ever existed.
			const weekId = task.weekId ?? closingWeekId ?? newWeekId;
			if (task.weekId === null) archive.push({ id: task.id, weekId });
			if (weekId === closingWeekId) archivedThisWeek += 1;
			continue;
		}

		carry.push({ id: task.id, weekId: newWeekId });
		if (task.isNextAction) carriedNextActions += 1;
	}

	return {
		newWeek,
		closedWeek,
		archive,
		carry,
		summary: {
			archived: archivedThisWeek,
			carried: carry.length,
			carriedNextActions,
			stalled: stalledProjects(projects).length
		}
	};
}

/**
 * "Week of 10 Aug" — short enough for a header, unambiguous across months.
 *
 * `Intl.DateTimeFormat` rather than date-fns' `format`, which is the single heaviest
 * thing date-fns pulls into the bundle and was being used for two short labels. The
 * formatter is constructed once: building one is comparatively expensive and this is
 * called on every render.
 *
 * The locale is pinned rather than taken from the browser so that day-then-month order
 * is guaranteed — "10 Aug" cannot be misread, whereas a numeric 10/08 can.
 */
const weekLabelFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function formatWeekLabel(week: Pick<Week, 'startedAt'>): string {
	return `Week of ${weekLabelFormat.format(new Date(week.startedAt))}`;
}

/** Whole days the current week has been running. Used only for gentle prompting. */
export function daysIntoWeek(week: Pick<Week, 'startedAt'>, now: Timestamp): number {
	const ms = now - week.startedAt;
	return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Whether to suggest a review. Seven days, and only ever a suggestion — there is no
 * penalty for a long week and nothing expires.
 */
export const REVIEW_SUGGESTED_AFTER_DAYS = 7;

export function isReviewDue(week: Week | null, now: Timestamp): boolean {
	if (!week) return true;
	return daysIntoWeek(week, now) >= REVIEW_SUGGESTED_AFTER_DAYS;
}
