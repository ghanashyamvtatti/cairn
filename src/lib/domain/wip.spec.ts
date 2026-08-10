import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WIP_LIMIT,
	MAX_WIP_LIMIT,
	MIN_WIP_LIMIT,
	activeProjects,
	clampWipLimit,
	decideAddProject,
	isLive,
	overLimitMessage,
	parkedProjects,
	stalledProjects,
	wipStatus,
	type AddProjectDecision
} from '$lib/domain/wip';
import { DEFAULT_SETTINGS, type Project, type Timestamp } from '$lib/types';

/**
 * Local-time timestamp helper. Built with `new Date(y, m, d, h)` so the ordering these
 * tests rely on holds identically in every timezone the suite runs under.
 */
function at(day: number, hour = 9): Timestamp {
	return new Date(2026, 0, day, hour).getTime();
}

let nextFixtureNumber = 0;

function makeProject(overrides: Partial<Project> = {}): Project {
	nextFixtureNumber += 1;
	const n = nextFixtureNumber;

	return {
		id: `project-${n}`,
		title: `Project ${n}`,
		status: 'active',
		nextActionId: `task-${n}`,
		order: n,
		createdAt: at(1),
		updatedAt: at(1),
		deletedAt: null,
		...overrides
	} satisfies Project;
}

function idsOf(projects: readonly Project[]): string[] {
	return projects.map((p) => p.id);
}

/** Asserts a warn decision and narrows it, so the branch data can be inspected. */
function expectWarn(
	decision: AddProjectDecision
): Extract<AddProjectDecision, { kind: 'warn' }> {
	expect(decision.kind).toBe('warn');
	if (decision.kind !== 'warn') throw new Error('expected a warn decision');
	return decision;
}

/** N live, active projects, each with a next action. */
function activeFixtures(count: number): Project[] {
	return Array.from({ length: count }, () => makeProject());
}

describe('isLive', () => {
	it('treats a project with a null deletedAt as live', () => {
		expect(isLive(makeProject({ deletedAt: null }))).toBe(true);
	});

	it('treats a soft-deleted project as not live', () => {
		expect(isLive(makeProject({ deletedAt: at(2) }))).toBe(false);
	});

	it('treats a deletion stamped at the epoch as not live rather than falsy-live', () => {
		expect(isLive(makeProject({ deletedAt: 0 }))).toBe(false);
	});
});

describe('activeProjects', () => {
	it('returns only the live projects whose status is active', () => {
		const active = makeProject({ id: 'a', status: 'active' });
		const parked = makeProject({ id: 'p', status: 'parked' });
		const done = makeProject({ id: 'd', status: 'done' });

		expect(idsOf(activeProjects([active, parked, done]))).toEqual(['a']);
	});

	it('excludes a soft-deleted active project', () => {
		const live = makeProject({ id: 'live', status: 'active' });
		const deleted = makeProject({ id: 'deleted', status: 'active', deletedAt: at(3) });

		expect(idsOf(activeProjects([live, deleted]))).toEqual(['live']);
	});

	it('preserves the input order of the projects it keeps', () => {
		const first = makeProject({ id: 'first', order: 3, updatedAt: at(9) });
		const second = makeProject({ id: 'second', order: 1, updatedAt: at(2) });
		const third = makeProject({ id: 'third', order: 2, updatedAt: at(5) });

		expect(idsOf(activeProjects([first, second, third]))).toEqual(['first', 'second', 'third']);
	});

	it('returns an empty list for an empty input', () => {
		expect(activeProjects([])).toEqual([]);
	});
});

describe('parkedProjects', () => {
	it('returns only the live projects whose status is parked', () => {
		const active = makeProject({ id: 'a', status: 'active' });
		const parked = makeProject({ id: 'p', status: 'parked' });
		const done = makeProject({ id: 'd', status: 'done' });

		expect(idsOf(parkedProjects([active, parked, done]))).toEqual(['p']);
	});

	it('excludes a soft-deleted parked project', () => {
		const live = makeProject({ id: 'live', status: 'parked' });
		const deleted = makeProject({ id: 'deleted', status: 'parked', deletedAt: at(4) });

		expect(idsOf(parkedProjects([live, deleted]))).toEqual(['live']);
	});

	it('returns an empty list for an empty input', () => {
		expect(parkedProjects([])).toEqual([]);
	});
});

describe('stalledProjects', () => {
	it('returns active projects that have no next action', () => {
		const stalled = makeProject({ id: 'stalled', status: 'active', nextActionId: null });
		const moving = makeProject({ id: 'moving', status: 'active', nextActionId: 'task-x' });

		expect(idsOf(stalledProjects([moving, stalled]))).toEqual(['stalled']);
	});

	it('does not consider a parked project without a next action stalled', () => {
		const parked = makeProject({ id: 'parked', status: 'parked', nextActionId: null });

		expect(stalledProjects([parked])).toEqual([]);
	});

	it('does not consider a done project without a next action stalled', () => {
		const done = makeProject({ id: 'done', status: 'done', nextActionId: null });

		expect(stalledProjects([done])).toEqual([]);
	});

	it('excludes a soft-deleted active project that has no next action', () => {
		const deleted = makeProject({
			id: 'deleted',
			status: 'active',
			nextActionId: null,
			deletedAt: at(6)
		});

		expect(stalledProjects([deleted])).toEqual([]);
	});

	it('returns every stalled project, in input order', () => {
		const one = makeProject({ id: 'one', nextActionId: null });
		const two = makeProject({ id: 'two', nextActionId: 'task-y' });
		const three = makeProject({ id: 'three', nextActionId: null });

		expect(idsOf(stalledProjects([one, two, three]))).toEqual(['one', 'three']);
	});
});

describe('clampWipLimit', () => {
	it.each([
		{ label: 'floors a limit of zero to the minimum', input: 0, expected: MIN_WIP_LIMIT },
		{ label: 'floors a negative limit to the minimum', input: -7, expected: MIN_WIP_LIMIT },
		{ label: 'leaves the minimum untouched', input: MIN_WIP_LIMIT, expected: MIN_WIP_LIMIT },
		{ label: 'leaves the maximum untouched', input: MAX_WIP_LIMIT, expected: MAX_WIP_LIMIT },
		{ label: 'caps a limit above the maximum', input: MAX_WIP_LIMIT + 1, expected: MAX_WIP_LIMIT },
		{ label: 'caps an absurdly large limit', input: 9001, expected: MAX_WIP_LIMIT },
		{ label: 'rounds 2.4 down to 2', input: 2.4, expected: 2 },
		{ label: 'rounds 2.6 up to 3', input: 2.6, expected: 3 }
	])('$label', ({ input, expected }) => {
		expect(clampWipLimit(input)).toBe(expected);
	});

	it.each([
		{ label: 'NaN', input: Number.NaN },
		{ label: 'Infinity', input: Number.POSITIVE_INFINITY },
		{ label: '-Infinity', input: Number.NEGATIVE_INFINITY }
	])('falls back to the default limit for $label', ({ input }) => {
		expect(clampWipLimit(input)).toBe(DEFAULT_WIP_LIMIT);
	});

	it('exposes a default limit that sits inside the allowed range', () => {
		expect(DEFAULT_WIP_LIMIT).toBeGreaterThanOrEqual(MIN_WIP_LIMIT);
		expect(DEFAULT_WIP_LIMIT).toBeLessThanOrEqual(MAX_WIP_LIMIT);
	});

	it('agrees with the shipped default setting for wipLimit', () => {
		expect(DEFAULT_WIP_LIMIT).toBe(DEFAULT_SETTINGS.wipLimit);
	});
});

describe('wipStatus', () => {
	it('reports headroom and no warning state below the limit', () => {
		const status = wipStatus(activeFixtures(1), 3);

		expect(status).toEqual({
			activeCount: 1,
			limit: 3,
			isOverLimit: false,
			isAtLimit: false,
			headroom: 2,
			excess: 0
		});
	});

	it('is at the limit, but not over it, when the counts match exactly', () => {
		const status = wipStatus(activeFixtures(3), 3);

		expect(status).toEqual({
			activeCount: 3,
			limit: 3,
			isOverLimit: false,
			isAtLimit: true,
			headroom: 0,
			excess: 0
		});
	});

	it('is over the limit, and no longer at it, once strictly above', () => {
		const status = wipStatus(activeFixtures(5), 3);

		expect(status).toEqual({
			activeCount: 5,
			limit: 3,
			isOverLimit: true,
			isAtLimit: false,
			headroom: 0,
			excess: 2
		});
	});

	it('never reports negative headroom when well over the limit', () => {
		const status = wipStatus(activeFixtures(9), 2);

		expect(status.headroom).toBe(0);
		expect(status.excess).toBe(7);
	});

	it('reports zero excess whenever the user is not over the limit', () => {
		expect(wipStatus(activeFixtures(2), 3).excess).toBe(0);
	});

	it('does not count parked or done projects towards the limit', () => {
		const projects: Project[] = [
			makeProject({ status: 'active' }),
			makeProject({ status: 'parked' }),
			makeProject({ status: 'parked' }),
			makeProject({ status: 'done' })
		];

		const status = wipStatus(projects, 2);

		expect(status.activeCount).toBe(1);
		expect(status.isAtLimit).toBe(false);
		expect(status.headroom).toBe(1);
	});

	it('does not count soft-deleted active projects towards the limit', () => {
		const projects: Project[] = [
			makeProject({ status: 'active' }),
			makeProject({ status: 'active', deletedAt: at(7) }),
			makeProject({ status: 'active', deletedAt: at(8) })
		];

		expect(wipStatus(projects, 3).activeCount).toBe(1);
	});

	it('counts zero active projects for an empty list', () => {
		const status = wipStatus([], DEFAULT_WIP_LIMIT);

		expect(status.activeCount).toBe(0);
		expect(status.headroom).toBe(DEFAULT_WIP_LIMIT);
	});

	it('clamps a limit of 0 up to the minimum before comparing', () => {
		const status = wipStatus(activeFixtures(1), 0);

		expect(status.limit).toBe(MIN_WIP_LIMIT);
		expect(status.isAtLimit).toBe(true);
		expect(status.isOverLimit).toBe(false);
		expect(status.headroom).toBe(0);
	});

	it('clamps a limit of 99 down to the maximum before comparing', () => {
		const status = wipStatus(activeFixtures(11), 99);

		expect(status.limit).toBe(MAX_WIP_LIMIT);
		expect(status.isOverLimit).toBe(true);
		expect(status.excess).toBe(1);
	});

	it('clamps a fractional limit the same way clampWipLimit does', () => {
		expect(wipStatus(activeFixtures(3), 2.6).limit).toBe(3);
	});
});

describe('decideAddProject', () => {
	it('is ok when there is still room below the limit', () => {
		const decision = decideAddProject(activeFixtures(2), 3);

		expect(decision).toEqual({ kind: 'ok', status: wipStatus(activeFixtures(2), 3) });
	});

	it('is ok for an empty project list', () => {
		const decision = decideAddProject([], DEFAULT_WIP_LIMIT);

		expect(decision.kind).toBe('ok');
	});

	it('warns exactly at the limit, so the prompt lands before the line is crossed', () => {
		const decision = decideAddProject(activeFixtures(3), 3);

		const warn = expectWarn(decision);
		expect(warn.status.isAtLimit).toBe(true);
		expect(warn.status.isOverLimit).toBe(false);
	});

	it('keeps warning once already above the limit', () => {
		const decision = decideAddProject(activeFixtures(4), 3);

		const warn = expectWarn(decision);
		expect(warn.status.isOverLimit).toBe(true);
		expect(warn.status.excess).toBe(1);
	});

	it('uses the clamped limit, so a limit of 0 still warns at one active project', () => {
		const warn = expectWarn(decideAddProject(activeFixtures(1), 0));

		expect(warn.status.limit).toBe(MIN_WIP_LIMIT);
	});

	it('offers the least-recently-updated active project first as a park candidate', () => {
		const projects: Project[] = [
			makeProject({ id: 'middle', updatedAt: at(10) }),
			makeProject({ id: 'stale', updatedAt: at(2) }),
			makeProject({ id: 'fresh', updatedAt: at(20) })
		];

		const warn = expectWarn(decideAddProject(projects, 3));

		expect(idsOf(warn.parkCandidates)).toEqual(['stale', 'middle', 'fresh']);
	});

	it('offers only active projects as park candidates', () => {
		const projects: Project[] = [
			makeProject({ id: 'parked', status: 'parked', updatedAt: at(2) }),
			makeProject({ id: 'done', status: 'done', updatedAt: at(3) }),
			makeProject({ id: 'deleted', status: 'active', updatedAt: at(4), deletedAt: at(5) }),
			makeProject({ id: 'active-stale', status: 'active', updatedAt: at(6) }),
			makeProject({ id: 'active-fresh', status: 'active', updatedAt: at(12) })
		];

		const warn = expectWarn(decideAddProject(projects, 2));

		expect(idsOf(warn.parkCandidates)).toEqual(['active-stale', 'active-fresh']);
	});

	it('does not reorder the array it was given while building park candidates', () => {
		const projects: Project[] = [
			makeProject({ id: 'fresh', updatedAt: at(20) }),
			makeProject({ id: 'stale', updatedAt: at(2) })
		];

		expectWarn(decideAddProject(projects, 2));

		expect(idsOf(projects)).toEqual(['fresh', 'stale']);
	});

	it('never returns park candidates on the ok branch', () => {
		const decision = decideAddProject(activeFixtures(1), 3);

		expect(decision).not.toHaveProperty('parkCandidates');
	});
});

describe('overLimitMessage', () => {
	it('names both the active count and the limit', () => {
		const message = overLimitMessage(wipStatus(activeFixtures(5), 2));

		expect(message).toMatch(/\b5\b/);
		expect(message).toMatch(/\b2\b/);
	});

	it('attributes each number to its own role rather than merely mentioning both', () => {
		const message = overLimitMessage(wipStatus(activeFixtures(5), 2));

		// 5 is the count of active projects; 2 is the limit. Reading the banner with the
		// two transposed ("2 active projects, 5 is your limit") would be worse than no
		// banner at all, so pin which number carries which meaning.
		expect(message).toMatch(/\b5 active projects\b/);
		expect(message).not.toMatch(/\b2 active projects\b/);
		expect(message.indexOf('5')).toBeLessThan(message.indexOf('2'));
	});

	it('offers parking as the way out instead of stating the problem alone', () => {
		const message = overLimitMessage(wipStatus(activeFixtures(5), 2));

		expect(message).toMatch(/\bpark/i);
	});

	it('reflects the clamped limit rather than the raw one', () => {
		const message = overLimitMessage(wipStatus(activeFixtures(11), 99));

		expect(message).toMatch(/\b11\b/);
		expect(message).toMatch(/\b10\b/);
		expect(message).not.toMatch(/\b99\b/);
	});

	it('never scolds: the sentence contains no exclamation mark', () => {
		const message = overLimitMessage(wipStatus(activeFixtures(7), 3));

		expect(message).not.toContain('!');
	});

	it('reads as a plain sentence about active projects', () => {
		const message = overLimitMessage(wipStatus(activeFixtures(4), 3));

		expect(message).toContain('active projects');
		expect(message.trim()).toBe(message);
		expect(message.length).toBeGreaterThan(0);
	});
});
