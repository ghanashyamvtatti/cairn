import { describe, expect, it } from 'vitest';
import {
	REVIEW_SUGGESTED_AFTER_DAYS,
	daysIntoWeek,
	formatWeekLabel,
	isReviewDue,
	planWeekReset,
	startWeek,
	type WeekResetInput,
	type WeekResetPlan
} from '$lib/domain/week';
import type { Id, Project, Task, Timestamp, Week } from '$lib/types';

/*
 * Every instant in this file is built from *local* calendar parts via
 * `new Date(y, m, d, h)`, so it denotes the same wall-clock moment in each of the three
 * timezones the suite runs under. Durations are then expressed as explicit millisecond
 * offsets, which is exactly the arithmetic `daysIntoWeek` performs.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Mon 3 Aug 2026, 09:00 local — the start of the week being closed. */
const WEEK_START: Timestamp = new Date(2026, 7, 3, 9).getTime();
/** Mon 10 Aug 2026, 09:00 local — "now" for the reset. */
const NOW: Timestamp = new Date(2026, 7, 10, 9).getTime();

const OLD_WEEK_ID: Id = 'week-july';
const CURRENT_WEEK_ID: Id = 'week-august-1';
const NEW_WEEK_ID: Id = 'week-august-2';
const THIRD_WEEK_ID: Id = 'week-august-3';

function makeTask(id: Id, overrides: Partial<Omit<Task, 'id'>> = {}): Task {
	return {
		id,
		projectId: 'p-moving',
		title: id,
		isNextAction: false,
		completedAt: null,
		weekId: null,
		createdAt: WEEK_START,
		updatedAt: WEEK_START,
		deletedAt: null,
		...overrides
	} satisfies Task;
}

function makeProject(id: Id, overrides: Partial<Omit<Project, 'id'>> = {}): Project {
	return {
		id,
		title: id,
		status: 'active',
		nextActionId: null,
		order: 0,
		createdAt: WEEK_START,
		updatedAt: WEEK_START,
		deletedAt: null,
		...overrides
	} satisfies Project;
}

function makeCurrentWeek(): Week {
	return {
		id: CURRENT_WEEK_ID,
		startedAt: WEEK_START,
		endedAt: null,
		reviewCompletedAt: new Date(2026, 7, 4, 20).getTime(),
		reviewSteps: ['brain-dump', 'sort-inbox']
	} satisfies Week;
}

/**
 * A week's worth of realistic rows:
 * - three unfinished live tasks, two of them a project's Next Action;
 * - one finished task already filed under the closing week;
 * - one finished task that never got a week stamped on it;
 * - one finished task filed under an older week;
 * - two soft-deleted rows that must be invisible to the reset.
 */
function fixtureTasks(): Task[] {
	return [
		makeTask('t-carry-plain'),
		makeTask('t-carry-next', { isNextAction: true, weekId: OLD_WEEK_ID }),
		makeTask('t-carry-next-2', { isNextAction: true, projectId: 'p-moving-2' }),
		makeTask('t-done-current', {
			completedAt: new Date(2026, 7, 6, 14).getTime(),
			weekId: CURRENT_WEEK_ID
		}),
		makeTask('t-done-unstamped', { completedAt: new Date(2026, 7, 7, 11).getTime() }),
		makeTask('t-done-old', {
			completedAt: new Date(2026, 6, 20, 11).getTime(),
			weekId: OLD_WEEK_ID
		}),
		makeTask('t-deleted-open', {
			isNextAction: true,
			deletedAt: new Date(2026, 7, 5, 8).getTime()
		}),
		makeTask('t-deleted-done', {
			completedAt: new Date(2026, 7, 5, 8).getTime(),
			deletedAt: new Date(2026, 7, 5, 9).getTime()
		})
	];
}

/** Two stalled active projects, plus rows that must not count as stalled. */
function fixtureProjects(): Project[] {
	return [
		makeProject('p-stalled-a'),
		makeProject('p-stalled-b'),
		makeProject('p-moving', { nextActionId: 't-carry-next' }),
		makeProject('p-moving-2', { nextActionId: 't-carry-next-2' }),
		makeProject('p-parked', { status: 'parked' }),
		makeProject('p-done', { status: 'done' }),
		makeProject('p-deleted', { deletedAt: new Date(2026, 7, 2, 8).getTime() })
	];
}

function baseInput(overrides: Partial<WeekResetInput> = {}): WeekResetInput {
	return {
		tasks: fixtureTasks(),
		projects: fixtureProjects(),
		currentWeek: makeCurrentWeek(),
		now: NOW,
		newWeekId: NEW_WEEK_ID,
		...overrides
	} satisfies WeekResetInput;
}

/**
 * The repository's job, in miniature: stamp every `archive` and `carry` entry onto a
 * *copy* of the row it names. Nothing else about a task ever changes.
 */
function applyPlan(tasks: readonly Task[], plan: WeekResetPlan): Task[] {
	const stamps = new Map<Id, Id>();
	for (const entry of [...plan.archive, ...plan.carry]) stamps.set(entry.id, entry.weekId);

	return tasks.map((task) => {
		const weekId = stamps.get(task.id);
		return weekId === undefined ? { ...task } : { ...task, weekId };
	});
}

function byId(tasks: readonly Task[], id: Id): Task {
	const found = tasks.find((task) => task.id === id);
	if (!found) throw new Error(`no fixture task ${id}`);
	return found;
}

function idsOf(entries: ReadonlyArray<{ id: Id }>): Id[] {
	return entries.map((entry) => entry.id);
}

describe('startWeek', () => {
	it('opens a week that has started and not ended, with no review progress', () => {
		const week = startWeek('week-1', NOW);

		expect(week).toEqual({
			id: 'week-1',
			startedAt: NOW,
			endedAt: null,
			reviewCompletedAt: null,
			reviewSteps: []
		} satisfies Week);
	});

	it('gives each week its own review-steps array so progress cannot leak between weeks', () => {
		const first = startWeek('week-1', NOW);
		const second = startWeek('week-2', NOW + DAY_MS);

		first.reviewSteps.push('brain-dump');

		expect(second.reviewSteps).toEqual([]);
		expect(second.reviewSteps).not.toBe(first.reviewSteps);
	});
});

describe('planWeekReset — the new week', () => {
	it('opens the supplied week id at `now`, unended and unreviewed', () => {
		const plan = planWeekReset(baseInput());

		expect(plan.newWeek).toEqual({
			id: NEW_WEEK_ID,
			startedAt: NOW,
			endedAt: null,
			reviewCompletedAt: null,
			reviewSteps: []
		} satisfies Week);
	});
});

describe('planWeekReset — closing the old week', () => {
	it('stamps `endedAt` and preserves every other field of the closing week', () => {
		const currentWeek = makeCurrentWeek();
		const plan = planWeekReset(baseInput({ currentWeek }));

		expect(plan.closedWeek).toEqual({ ...makeCurrentWeek(), endedAt: NOW });
	});

	it('does not mutate the week it was handed', () => {
		const currentWeek = makeCurrentWeek();
		planWeekReset(baseInput({ currentWeek }));

		expect(currentWeek).toEqual(makeCurrentWeek());
	});

	it('has no week to close on the very first reset', () => {
		const plan = planWeekReset(baseInput({ currentWeek: null }));

		expect(plan.closedWeek).toBeNull();
	});
});

describe('planWeekReset — carrying unfinished work', () => {
	it('carries every live unfinished task into the new week', () => {
		const plan = planWeekReset(baseInput());

		expect(idsOf(plan.carry)).toEqual(['t-carry-plain', 't-carry-next', 't-carry-next-2']);
		expect(plan.carry.every((entry) => entry.weekId === NEW_WEEK_ID)).toBe(true);
	});

	it('describes a carry as nothing but an id and the new week id', () => {
		const plan = planWeekReset(baseInput());

		for (const entry of plan.carry) {
			expect(Object.keys(entry).sort()).toEqual(['id', 'weekId']);
		}
	});

	it('never completes, deletes or unflags the work it carries', () => {
		const tasks = fixtureTasks();
		const plan = planWeekReset(baseInput({ tasks }));
		const after = applyPlan(tasks, plan);

		for (const id of idsOf(plan.carry)) {
			const before = byId(tasks, id);
			const carried = byId(after, id);

			expect(carried.completedAt).toBeNull();
			expect(carried.deletedAt).toBeNull();
			expect(carried.isNextAction).toBe(before.isNextAction);
			expect(carried.title).toBe(before.title);
			expect(carried.weekId).toBe(NEW_WEEK_ID);
		}
	});

	it('carries unfinished work even when there is no week to close', () => {
		const plan = planWeekReset(baseInput({ currentWeek: null }));

		expect(idsOf(plan.carry)).toEqual(['t-carry-plain', 't-carry-next', 't-carry-next-2']);
	});
});

describe('planWeekReset — filing finished work', () => {
	it('leaves finished work that already carries the closing week alone', () => {
		const plan = planWeekReset(baseInput());

		expect(idsOf(plan.archive)).not.toContain('t-done-current');
	});

	it('still counts already-filed work in the archived total', () => {
		const plan = planWeekReset(
			baseInput({
				tasks: [makeTask('t-done-current', { completedAt: NOW - HOUR_MS, weekId: CURRENT_WEEK_ID })]
			})
		);

		expect(plan.archive).toEqual([]);
		expect(plan.summary.archived).toBe(1);
	});

	it('stamps the closing week onto finished work that has no week yet', () => {
		const plan = planWeekReset(baseInput());

		expect(plan.archive).toEqual([{ id: 't-done-unstamped', weekId: CURRENT_WEEK_ID }]);
	});

	it('keeps finished work filed under an older week where it is, uncounted', () => {
		const plan = planWeekReset(
			baseInput({
				tasks: [makeTask('t-done-old', { completedAt: WEEK_START, weekId: OLD_WEEK_ID })]
			})
		);

		expect(plan.archive).toEqual([]);
		expect(plan.summary.archived).toBe(0);
	});

	it('falls back to the new week when nothing has ever been closed', () => {
		const plan = planWeekReset(
			baseInput({
				currentWeek: null,
				tasks: [makeTask('t-done-unstamped', { completedAt: NOW - HOUR_MS })]
			})
		);

		expect(plan.archive).toEqual([{ id: 't-done-unstamped', weekId: NEW_WEEK_ID }]);
		expect(plan.summary.archived).toBe(0);
	});
});

describe('planWeekReset — soft-deleted rows', () => {
	it('neither carries, archives nor counts a soft-deleted task', () => {
		const plan = planWeekReset(baseInput());
		const touched = [...idsOf(plan.carry), ...idsOf(plan.archive)];

		expect(touched).not.toContain('t-deleted-open');
		expect(touched).not.toContain('t-deleted-done');
	});

	it('reports an empty reset when every row is soft-deleted', () => {
		const deletedAt = new Date(2026, 7, 5, 8).getTime();
		const plan = planWeekReset(
			baseInput({
				tasks: [
					makeTask('t-open', { isNextAction: true, deletedAt }),
					makeTask('t-done', { completedAt: WEEK_START, weekId: CURRENT_WEEK_ID, deletedAt })
				],
				projects: []
			})
		);

		expect(plan.carry).toEqual([]);
		expect(plan.archive).toEqual([]);
		expect(plan.summary).toEqual({ archived: 0, carried: 0, carriedNextActions: 0, stalled: 0 });
	});
});

describe('planWeekReset — the summary', () => {
	it('counts carried tasks, carried next actions, archived tasks and stalled projects', () => {
		const plan = planWeekReset(baseInput());

		expect(plan.summary).toEqual({
			// `t-done-current` (already filed) plus `t-done-unstamped` (filed just now).
			archived: 2,
			carried: 3,
			carriedNextActions: 2,
			stalled: 2
		});
	});

	it('counts only active projects with no next action as stalled', () => {
		const plan = planWeekReset(baseInput({ tasks: [] }));

		expect(plan.summary.stalled).toBe(2);
	});

	it('reports all zeroes for an empty board', () => {
		const plan = planWeekReset(baseInput({ tasks: [], projects: [] }));

		expect(plan.summary).toEqual({ archived: 0, carried: 0, carriedNextActions: 0, stalled: 0 });
		expect(plan.carry).toEqual([]);
		expect(plan.archive).toEqual([]);
	});

	it('does not mutate the tasks or projects it was handed', () => {
		const tasks = fixtureTasks();
		const projects = fixtureProjects();

		planWeekReset(baseInput({ tasks, projects }));

		expect(tasks).toEqual(fixtureTasks());
		expect(projects).toEqual(fixtureProjects());
	});
});

describe('planWeekReset — history is immutable', () => {
	it('never moves a finished task between weeks when the reset is run again', () => {
		const tasks = fixtureTasks();

		const firstPlan = planWeekReset(baseInput({ tasks }));
		const afterFirst = applyPlan(tasks, firstPlan);

		const secondPlan = planWeekReset(
			baseInput({
				tasks: afterFirst,
				currentWeek: firstPlan.newWeek,
				now: NOW + 7 * DAY_MS,
				newWeekId: THIRD_WEEK_ID
			})
		);
		const afterSecond = applyPlan(afterFirst, secondPlan);

		const finished = afterFirst.filter((task) => task.completedAt !== null);
		expect(finished.length).toBeGreaterThan(0);

		for (const task of finished) {
			expect(byId(afterSecond, task.id).weekId).toBe(task.weekId);
		}
	});

	it('has nothing left to file on a second run, because every finish is already stamped', () => {
		const tasks = fixtureTasks();
		const firstPlan = planWeekReset(baseInput({ tasks }));
		const afterFirst = applyPlan(tasks, firstPlan);

		const secondPlan = planWeekReset(
			baseInput({
				tasks: afterFirst,
				currentWeek: firstPlan.newWeek,
				now: NOW + 7 * DAY_MS,
				newWeekId: THIRD_WEEK_ID
			})
		);

		expect(secondPlan.archive).toEqual([]);
	});

	it('keeps carrying the still-unfinished work into each fresh week', () => {
		const tasks = fixtureTasks();
		const firstPlan = planWeekReset(baseInput({ tasks }));
		const afterFirst = applyPlan(tasks, firstPlan);

		const secondPlan = planWeekReset(
			baseInput({
				tasks: afterFirst,
				currentWeek: firstPlan.newWeek,
				now: NOW + 7 * DAY_MS,
				newWeekId: THIRD_WEEK_ID
			})
		);

		expect(idsOf(secondPlan.carry)).toEqual(idsOf(firstPlan.carry));
		expect(secondPlan.carry.every((entry) => entry.weekId === THIRD_WEEK_ID)).toBe(true);
		expect(secondPlan.summary.carriedNextActions).toBe(2);
	});
});

describe('formatWeekLabel', () => {
	it('reads "Week of <day> <month>"', () => {
		const label = formatWeekLabel({ startedAt: new Date(2026, 7, 10, 9).getTime() });

		expect(label).toBe('Week of 10 Aug');
	});

	it.each([
		{ label: 'just after local midnight', hour: 0, minute: 0 },
		{ label: 'mid-morning', hour: 9, minute: 30 },
		{ label: 'the last minute of the local day', hour: 23, minute: 59 }
	])('uses the local calendar day $label', ({ hour, minute }) => {
		const startedAt = new Date(2026, 7, 10, hour, minute).getTime();

		const label = formatWeekLabel({ startedAt });

		expect(label.startsWith('Week of ')).toBe(true);
		expect(label).toMatch(/^Week of \d{1,2} [A-Za-z]{3}$/);
		expect(label).toContain(String(new Date(startedAt).getDate()));
		expect(label).toContain('10');
	});
});

describe('daysIntoWeek', () => {
	it.each([
		{ label: 'the moment it starts', offset: 0, expected: 0 },
		{ label: 'a few hours in', offset: 5 * HOUR_MS, expected: 0 },
		{ label: 'one millisecond short of a day', offset: DAY_MS - 1, expected: 0 },
		{ label: 'exactly one day', offset: DAY_MS, expected: 1 },
		{ label: 'three and a bit days', offset: 3 * DAY_MS + 22 * HOUR_MS, expected: 3 },
		{ label: 'a fortnight', offset: 14 * DAY_MS, expected: 14 }
	])('reports $expected whole days $label', ({ offset, expected }) => {
		expect(daysIntoWeek({ startedAt: WEEK_START }, WEEK_START + offset)).toBe(expected);
	});

	it.each([
		{ label: 'an hour', offset: HOUR_MS },
		{ label: 'a day', offset: DAY_MS },
		{ label: 'a fortnight', offset: 14 * DAY_MS }
	])('clamps to zero when the clock is $label behind the start', ({ offset }) => {
		expect(daysIntoWeek({ startedAt: WEEK_START }, WEEK_START - offset)).toBe(0);
	});

	/*
	 * DST contract, asserted deliberately.
	 *
	 * A seven-calendar-day local span is 167 hours across a spring-forward, 168 with no
	 * transition and 169 across a fall-back. `daysIntoWeek` divides *elapsed
	 * milliseconds* by a fixed 86_400_000, so it reports 6 for the short span and 7 for
	 * the other two. That is the behaviour under test: whole 24-hour periods elapsed,
	 * not calendar days turned over. It is the right contract here because the number
	 * only ever drives a gentle "shall we review?" nudge, and being an hour late with
	 * that suggestion twice a year costs nothing.
	 *
	 * Which of the three windows below is short/long depends on the timezone, so the
	 * expectation is derived from the elapsed hours rather than hardcoded.
	 */
	it.each([
		{ label: 'a spring-forward window', from: [2026, 2, 26], to: [2026, 3, 2] },
		{ label: 'a fall-back window', from: [2026, 9, 22], to: [2026, 9, 29] },
		{ label: 'a window with no transition', from: [2026, 7, 3], to: [2026, 7, 10] }
	] satisfies Array<{ label: string; from: number[]; to: number[] }>)(
		'measures $label of seven calendar days in elapsed 24-hour periods',
		({ from, to }) => {
			const startedAt = new Date(from[0], from[1], from[2], 9).getTime();
			const now = new Date(to[0], to[1], to[2], 9).getTime();
			const elapsedHours = (now - startedAt) / HOUR_MS;

			expect([167, 168, 169]).toContain(elapsedHours);
			expect(daysIntoWeek({ startedAt }, now)).toBe(elapsedHours < 168 ? 6 : 7);
		}
	);
});

describe('isReviewDue', () => {
	it('suggests a review when no week has ever been started', () => {
		expect(isReviewDue(null, NOW)).toBe(true);
	});

	it('suggests one after seven days', () => {
		expect(REVIEW_SUGGESTED_AFTER_DAYS).toBe(7);
	});

	it.each([
		{ label: 'the day the week opens', offset: 0, due: false },
		{ label: 'six days in', offset: 6 * DAY_MS, due: false },
		{ label: 'one millisecond short of seven days', offset: 7 * DAY_MS - 1, due: false },
		{ label: 'exactly seven days', offset: 7 * DAY_MS, due: true },
		{ label: 'a month in', offset: 30 * DAY_MS, due: true }
	])('is $due at $label', ({ offset, due }) => {
		const week = startWeek(CURRENT_WEEK_ID, WEEK_START);

		expect(isReviewDue(week, WEEK_START + offset)).toBe(due);
	});

	it('turns on exactly at the REVIEW_SUGGESTED_AFTER_DAYS threshold', () => {
		const week = startWeek(CURRENT_WEEK_ID, WEEK_START);
		const threshold = WEEK_START + REVIEW_SUGGESTED_AFTER_DAYS * DAY_MS;

		expect(isReviewDue(week, threshold - 1)).toBe(false);
		expect(isReviewDue(week, threshold)).toBe(true);
	});

	it('never suggests a review for a week whose start is in the future', () => {
		const week = startWeek(CURRENT_WEEK_ID, NOW + 30 * DAY_MS);

		expect(daysIntoWeek(week, NOW)).toBe(0);
		expect(isReviewDue(week, NOW)).toBe(false);
	});

	it('is due for the week a fresh reset just opened only once seven days have passed', () => {
		const plan = planWeekReset(baseInput());

		expect(isReviewDue(plan.newWeek, NOW)).toBe(false);
		expect(isReviewDue(plan.newWeek, NOW + 7 * DAY_MS)).toBe(true);
	});
});
