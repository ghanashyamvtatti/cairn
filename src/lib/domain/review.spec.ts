import { describe, expect, it } from 'vitest';
import {
	REVIEW_STEPS,
	REVIEW_TOTAL_MINUTES,
	reviewProgress,
	stepSignal,
	toggleReviewStep,
	type ReviewSignals,
	type ReviewStep
} from '$lib/domain/review';
import type { ReviewStepId, Week } from '$lib/types';

/** The documented order of the ritual, spelled out independently of the module. */
const CANONICAL_ORDER = [
	'brain-dump',
	'sort-inbox',
	'pick-next-actions',
	'scan-manifest'
] as const satisfies readonly ReviewStepId[];

/**
 * Widen through `string` so an id that is *not* part of the union can still be handed
 * to the module — this is exactly what an imported/corrupted file would contain.
 */
function foreignId(raw: string): ReviewStepId {
	const widened: string = raw;
	return widened as ReviewStepId;
}

function makeWeek(reviewSteps: readonly ReviewStepId[]): Week {
	// Timezone-relative construction on purpose: the same wall-clock moment in every
	// project the suite runs under.
	const startedAt = new Date(2026, 0, 5, 9, 0, 0).getTime();
	return {
		id: 'week-2026-01-05',
		startedAt,
		endedAt: null,
		reviewCompletedAt: null,
		reviewSteps: [...reviewSteps]
	} satisfies Week;
}

const NO_SIGNALS = {
	inboxCount: 0,
	stalledCount: 0,
	activeProjectCount: 0,
	upcomingDateCount: 0
} satisfies ReviewSignals;

function signals(overrides: Partial<ReviewSignals>): ReviewSignals {
	return { ...NO_SIGNALS, ...overrides };
}

describe('REVIEW_STEPS', () => {
	it('lists the four steps in the documented order', () => {
		expect(REVIEW_STEPS.map((s) => s.id)).toEqual([...CANONICAL_ORDER]);
	});

	it('has no duplicate ids', () => {
		const ids = REVIEW_STEPS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each(CANONICAL_ORDER.map((id) => [id] as const))(
		'gives the %s step a title, hint, href and cta a human can act on',
		(id) => {
			const step = REVIEW_STEPS.find((s) => s.id === id);
			expect(step, `no step with id ${id}`).toBeDefined();
			const found = step as ReviewStep;
			expect(found.title.trim()).not.toBe('');
			expect(found.hint.trim()).not.toBe('');
			expect(found.cta.trim()).not.toBe('');
			expect(found.href.trim()).not.toBe('');
			expect(found.href.startsWith('/')).toBe(true);
			expect(found.minutes).toBeGreaterThan(0);
		}
	);
});

describe('REVIEW_TOTAL_MINUTES', () => {
	it('is the sum of the per-step guidance', () => {
		const sum = REVIEW_STEPS.reduce((acc, s) => acc + s.minutes, 0);
		expect(REVIEW_TOTAL_MINUTES).toBe(sum);
	});

	it('keeps the "~15 minute review" promise honest', () => {
		expect(REVIEW_TOTAL_MINUTES).toBeGreaterThan(0);
		expect(REVIEW_TOTAL_MINUTES).toBeLessThanOrEqual(15);
	});
});

describe('reviewProgress', () => {
	it('reports an untouched review when there is no week at all', () => {
		const progress = reviewProgress(null);
		expect(progress.completed).toEqual([]);
		expect(progress.done).toBe(0);
		expect(progress.total).toBe(REVIEW_STEPS.length);
		expect(progress.ratio).toBe(0);
		expect(progress.nextStep?.id).toBe('brain-dump');
		expect(progress.isComplete).toBe(false);
	});

	it('reports an untouched review for a week with no ticked steps', () => {
		const progress = reviewProgress(makeWeek([]));
		expect(progress.done).toBe(0);
		expect(progress.ratio).toBe(0);
		expect(progress.nextStep).toEqual(REVIEW_STEPS[0]);
		expect(progress.isComplete).toBe(false);
	});

	it('counts each ticked step once and moves the ratio proportionally', () => {
		const progress = reviewProgress(makeWeek(['brain-dump', 'sort-inbox']));
		expect(progress.completed).toEqual(['brain-dump', 'sort-inbox']);
		expect(progress.done).toBe(2);
		expect(progress.ratio).toBe(0.5);
		expect(progress.isComplete).toBe(false);
	});

	it('de-duplicates repeated ids', () => {
		const progress = reviewProgress(
			makeWeek(['brain-dump', 'brain-dump', 'sort-inbox', 'brain-dump'])
		);
		expect(progress.completed).toEqual(['brain-dump', 'sort-inbox']);
		expect(progress.done).toBe(2);
		expect(progress.ratio).toBe(0.5);
	});

	it('ignores unknown ids from a corrupted or imported file', () => {
		const progress = reviewProgress(
			makeWeek([foreignId('brain-dumpX'), foreignId(''), foreignId('scan-manifest ')])
		);
		expect(progress.completed).toEqual([]);
		expect(progress.done).toBe(0);
		expect(progress.ratio).toBe(0);
		expect(progress.nextStep?.id).toBe('brain-dump');
		expect(progress.isComplete).toBe(false);
	});

	it('cannot be pushed past 100% by junk or duplicate ids', () => {
		const progress = reviewProgress(
			makeWeek([
				...CANONICAL_ORDER,
				...CANONICAL_ORDER,
				foreignId('rearrange-desk'),
				foreignId('brain_dump'),
				foreignId('42')
			])
		);
		expect(progress.done).toBe(REVIEW_STEPS.length);
		expect(progress.ratio).toBe(1);
		expect(progress.ratio).toBeLessThanOrEqual(1);
		expect(progress.completed).toHaveLength(REVIEW_STEPS.length);
	});

	it('is not finished while a single step is still outstanding', () => {
		const progress = reviewProgress(makeWeek(['brain-dump', 'sort-inbox', 'pick-next-actions']));
		expect(progress.done).toBe(3);
		expect(progress.total).toBe(4);
		expect(progress.ratio).toBe(0.75);
		expect(progress.isComplete).toBe(false);
		expect(progress.nextStep?.id).toBe('scan-manifest');
	});

	it('is finished when all four steps are present', () => {
		const progress = reviewProgress(makeWeek(CANONICAL_ORDER));
		expect(progress.done).toBe(4);
		expect(progress.ratio).toBe(1);
		expect(progress.isComplete).toBe(true);
		expect(progress.nextStep).toBeNull();
	});

	it('is finished even when the steps were ticked out of order', () => {
		const progress = reviewProgress(
			makeWeek(['scan-manifest', 'sort-inbox', 'brain-dump', 'pick-next-actions'])
		);
		expect(progress.isComplete).toBe(true);
		expect(progress.nextStep).toBeNull();
		expect(progress.ratio).toBe(1);
	});

	it.each([
		{
			label: 'nothing ticked',
			ticked: [] as readonly ReviewStepId[],
			expected: 'brain-dump' as ReviewStepId | null
		},
		{
			label: 'a later step ticked first',
			ticked: ['scan-manifest'] as readonly ReviewStepId[],
			expected: 'brain-dump' as ReviewStepId | null
		},
		{
			label: 'the last two ticked, in reverse',
			ticked: ['scan-manifest', 'pick-next-actions'] as readonly ReviewStepId[],
			expected: 'brain-dump' as ReviewStepId | null
		},
		{
			label: 'a gap left in the middle',
			ticked: ['scan-manifest', 'brain-dump', 'pick-next-actions'] as readonly ReviewStepId[],
			expected: 'sort-inbox' as ReviewStepId | null
		},
		{
			label: 'the first three ticked backwards',
			ticked: ['pick-next-actions', 'sort-inbox', 'brain-dump'] as readonly ReviewStepId[],
			expected: 'scan-manifest' as ReviewStepId | null
		},
		{
			label: 'everything ticked',
			ticked: CANONICAL_ORDER as readonly ReviewStepId[],
			expected: null as ReviewStepId | null
		}
	])(
		'points at the first incomplete step in canonical order with $label',
		({ ticked, expected }) => {
			const progress = reviewProgress(makeWeek(ticked));
			expect(progress.nextStep?.id ?? null).toBe(expected);
		}
	);

	it('does not mutate the week it was given', () => {
		const week = makeWeek(['scan-manifest', 'scan-manifest', foreignId('nonsense')]);
		const before = [...week.reviewSteps];
		reviewProgress(week);
		expect(week.reviewSteps).toEqual(before);
	});
});

describe('toggleReviewStep', () => {
	it('adds a step that was not ticked', () => {
		expect(toggleReviewStep([], 'sort-inbox', true)).toEqual(['sort-inbox']);
	});

	it('removes a step that was ticked', () => {
		expect(toggleReviewStep(['brain-dump', 'sort-inbox'], 'brain-dump', false)).toEqual([
			'sort-inbox'
		]);
	});

	it('is idempotent when adding a step that is already ticked', () => {
		const once = toggleReviewStep(['brain-dump'], 'brain-dump', true);
		const twice = toggleReviewStep(once, 'brain-dump', true);
		expect(once).toEqual(['brain-dump']);
		expect(twice).toEqual(once);
	});

	it('is idempotent when removing a step that was never ticked', () => {
		const once = toggleReviewStep(['sort-inbox'], 'scan-manifest', false);
		const twice = toggleReviewStep(once, 'scan-manifest', false);
		expect(once).toEqual(['sort-inbox']);
		expect(twice).toEqual(once);
	});

	it('returns canonical order however the user ticked them', () => {
		const out = toggleReviewStep(['scan-manifest', 'pick-next-actions'], 'brain-dump', true);
		expect(out).toEqual(['brain-dump', 'pick-next-actions', 'scan-manifest']);
	});

	it('returns canonical order when removing from a scrambled list', () => {
		const out = toggleReviewStep(
			['scan-manifest', 'sort-inbox', 'brain-dump', 'pick-next-actions'],
			'sort-inbox',
			false
		);
		expect(out).toEqual(['brain-dump', 'pick-next-actions', 'scan-manifest']);
	});

	it('de-duplicates and drops unknown ids already in the list', () => {
		const out = toggleReviewStep(
			['sort-inbox', 'sort-inbox', foreignId('who-knows')],
			'brain-dump',
			true
		);
		expect(out).toEqual(['brain-dump', 'sort-inbox']);
	});

	it.each([
		{ done: true, step: 'pick-next-actions' as ReviewStepId },
		{ done: false, step: 'scan-manifest' as ReviewStepId }
	])('does not mutate its input array (done=$done, step=$step)', ({ done, step }) => {
		const current: ReviewStepId[] = ['scan-manifest', 'brain-dump'];
		const before = [...current];
		const out = toggleReviewStep(current, step, done);
		expect(current).toEqual(before);
		expect(out).not.toBe(current);
	});

	it('round-trips: adding then removing returns to the starting set', () => {
		const start: ReviewStepId[] = ['brain-dump', 'scan-manifest'];
		const added = toggleReviewStep(start, 'sort-inbox', true);
		const removed = toggleReviewStep(added, 'sort-inbox', false);
		expect(added).toEqual(['brain-dump', 'sort-inbox', 'scan-manifest']);
		expect(removed).toEqual(['brain-dump', 'scan-manifest']);
	});

	it('drives reviewProgress to completion when every step is ticked in turn', () => {
		let ticked: ReviewStepId[] = [];
		for (const step of [
			'scan-manifest',
			'brain-dump',
			'pick-next-actions',
			'sort-inbox'
		] as const) {
			ticked = toggleReviewStep(ticked, step, true);
		}
		const progress = reviewProgress(makeWeek(ticked));
		expect(ticked).toEqual([...CANONICAL_ORDER]);
		expect(progress.isComplete).toBe(true);
	});
});

describe('stepSignal', () => {
	it.each([
		{ label: 'no counts at all', s: NO_SIGNALS },
		{ label: 'a full inbox', s: signals({ inboxCount: 9, stalledCount: 3, upcomingDateCount: 4 }) }
	])('returns nothing for brain-dump with $label', ({ s }) => {
		expect(stepSignal('brain-dump', s)).toBeNull();
	});

	describe('sort-inbox', () => {
		it('says the inbox is clear at zero', () => {
			expect(stepSignal('sort-inbox', signals({ inboxCount: 0 }))).toBe('Inbox is empty');
		});

		it.each([
			{ inboxCount: 1, expected: '1 item to sort' },
			{ inboxCount: 2, expected: '2 items to sort' },
			{ inboxCount: 17, expected: '17 items to sort' }
		])('reads "$expected" for $inboxCount', ({ inboxCount, expected }) => {
			expect(stepSignal('sort-inbox', signals({ inboxCount }))).toBe(expected);
		});
	});

	describe('pick-next-actions', () => {
		it('says every project is moving at zero', () => {
			expect(stepSignal('pick-next-actions', signals({ stalledCount: 0 }))).toBe(
				'Every project has a next action'
			);
		});

		it.each([
			{ stalledCount: 1, expected: '1 project without one' },
			{ stalledCount: 2, expected: '2 projects without one' },
			{ stalledCount: 5, expected: '5 projects without one' }
		])('reads "$expected" for $stalledCount', ({ stalledCount, expected }) => {
			expect(stepSignal('pick-next-actions', signals({ stalledCount }))).toBe(expected);
		});

		it('ignores the active project count, which is not what this step is about', () => {
			expect(
				stepSignal('pick-next-actions', signals({ stalledCount: 1, activeProjectCount: 8 }))
			).toBe('1 project without one');
		});
	});

	describe('scan-manifest', () => {
		it('says the board is clear at zero', () => {
			expect(stepSignal('scan-manifest', signals({ upcomingDateCount: 0 }))).toBe(
				'Nothing on the board'
			);
		});

		it.each([
			{ upcomingDateCount: 1, expected: '1 coming up' },
			{ upcomingDateCount: 2, expected: '2 coming up' },
			{ upcomingDateCount: 12, expected: '12 coming up' }
		])('reads "$expected" for $upcomingDateCount', ({ upcomingDateCount, expected }) => {
			expect(stepSignal('scan-manifest', signals({ upcomingDateCount }))).toBe(expected);
		});
	});

	it('reads each step off its own counter, not another step’s', () => {
		const s = signals({ inboxCount: 1, stalledCount: 2, upcomingDateCount: 3 });
		expect(stepSignal('sort-inbox', s)).toBe('1 item to sort');
		expect(stepSignal('pick-next-actions', s)).toBe('2 projects without one');
		expect(stepSignal('scan-manifest', s)).toBe('3 coming up');
	});

	it('produces a signal or an explicit null for every step in REVIEW_STEPS', () => {
		const s = signals({ inboxCount: 1, stalledCount: 1, upcomingDateCount: 1 });
		for (const step of REVIEW_STEPS) {
			const signal = stepSignal(step.id, s);
			expect(signal === null || signal.trim().length > 0).toBe(true);
		}
	});
});
