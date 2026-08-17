import { describe, expect, it } from 'vitest';
import { EXAMPLE_DATES, EXAMPLE_INBOX, EXAMPLE_PROJECTS, exampleDate } from '$lib/domain/example';
import { TOUR_STEPS, clampStepIndex, tourStepAt } from '$lib/domain/tour';
import { countdownFor, parseIsoDate } from '$lib/domain/countdown';
import { ROUTES } from '$lib/routes';

describe('the tour', () => {
	const routes = new Set<string>(Object.values(ROUTES));

	it('visits every surface of the app', () => {
		const visited = new Set(TOUR_STEPS.map((s) => s.route));

		// The guide is read, not toured; everything else must be introduced.
		expect(visited).toEqual(
			new Set(['/', '/projects', '/inbox', '/manifest', '/review', '/settings'])
		);
	});

	it('only points at real routes', () => {
		for (const step of TOUR_STEPS) {
			expect(routes.has(step.route)).toBe(true);
		}
	});

	it('has a unique id and non-empty copy for every step', () => {
		const ids = TOUR_STEPS.map((s) => s.id);

		expect(new Set(ids).size).toBe(ids.length);
		for (const step of TOUR_STEPS) {
			expect(step.title.trim().length).toBeGreaterThan(0);
			expect(step.body.trim().length).toBeGreaterThan(0);
		}
	});

	it('never groups steps for one route out of order', () => {
		// Steps for the same route must be contiguous, or the tour navigates back and
		// forth and feels broken even though every individual step is correct.
		const seen: string[] = [];
		for (const step of TOUR_STEPS) {
			if (seen[seen.length - 1] !== step.route) seen.push(step.route);
		}

		expect(new Set(seen).size).toBe(seen.length);
	});

	it('explains itself without scolding', () => {
		const copy = TOUR_STEPS.map((s) => `${s.title} ${s.body}`).join(' ');

		expect(copy).not.toMatch(/overdue|you failed|behind schedule/i);
	});

	it('reads a step by index and refuses one that does not exist', () => {
		expect(tourStepAt(0)).toBe(TOUR_STEPS[0]);
		expect(tourStepAt(TOUR_STEPS.length)).toBeNull();
		expect(tourStepAt(-1)).toBeNull();
	});

	it.each([
		{ input: -5, expected: 0 },
		{ input: 0, expected: 0 },
		{ input: 2.4, expected: 2 },
		{ input: 999, expected: TOUR_STEPS.length - 1 },
		{ input: Number.NaN, expected: 0 },
		{ input: Number.POSITIVE_INFINITY, expected: 0 }
	])('clamps a step index of $input to $expected', ({ input, expected }) => {
		expect(clampStepIndex(input)).toBe(expected);
	});
});

describe('the example week', () => {
	it('fills the default WIP limit exactly, so the board looks like the product describes', () => {
		expect(EXAMPLE_PROJECTS).toHaveLength(3);
	});

	it('gives all but one project a next action', () => {
		const withNext = EXAMPLE_PROJECTS.filter((p) => p.tasks.some((t) => t.isNextAction));

		// One is deliberately left stalled: it is the hardest idea to convey in the
		// abstract, and the tour points straight at it.
		expect(withNext).toHaveLength(EXAMPLE_PROJECTS.length - 1);
	});

	it('never gives a project two next actions', () => {
		// At most one — the stalled project deliberately has none, which is the point of it.
		for (const project of EXAMPLE_PROJECTS) {
			expect(project.tasks.filter((t) => t.isNextAction).length).toBeLessThanOrEqual(1);
		}
	});

	it('has something in every project and no blank titles', () => {
		for (const project of EXAMPLE_PROJECTS) {
			expect(project.title.trim().length).toBeGreaterThan(0);
			expect(project.tasks.length).toBeGreaterThan(0);
			for (const task of project.tasks) expect(task.title.trim().length).toBeGreaterThan(0);
		}
		for (const text of EXAMPLE_INBOX) expect(text.trim().length).toBeGreaterThan(0);
	});

	it('puts every example date in the future so the board is never seeded with regret', () => {
		for (const entry of EXAMPLE_DATES) {
			expect(entry.inDays).toBeGreaterThan(0);
		}
	});

	it('spreads the dates across the countdown tones so the board is legible at a glance', () => {
		const now = new Date(2026, 7, 10, 9);
		const tones = new Set(
			EXAMPLE_DATES.map((e) => countdownFor(exampleDate(e.inDays, now), now)?.tone)
		);

		expect(tones.size).toBeGreaterThanOrEqual(3);
	});

	it.each([0, 1, 5, 23, 96, 400])('resolves an offset of %i days to a readable date', (offset) => {
		const now = new Date(2026, 7, 10, 23, 45);
		const iso = exampleDate(offset, now);

		expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(parseIsoDate(iso)).not.toBeNull();
		expect(countdownFor(iso, now)?.days).toBe(offset);
	});

	it('uses local date parts, not UTC ones', () => {
		// Late evening is where a UTC-based implementation slips to the next day.
		const lateEvening = new Date(2026, 7, 10, 23, 59);

		expect(exampleDate(0, lateEvening)).toBe('2026-08-10');
	});
});
