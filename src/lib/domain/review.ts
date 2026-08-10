import type { ReviewStepId, Week } from '$lib/types';

/**
 * The weekly review is the ritual the whole product is built around: GTD's own
 * literature calls it the critical success factor, and it is the first thing people
 * drop before they abandon a system entirely. So it is a short, ordered, resumable
 * checklist with visible progress — not a wall of prompts.
 *
 * Progress is stored per week, so closing the tab mid-review loses nothing.
 */

export interface ReviewStep {
	id: ReviewStepId;
	title: string;
	/** One line explaining what "done" looks like. */
	hint: string;
	/** Where the work for this step actually happens. */
	href: string;
	cta: string;
	/** Rough guidance so the whole ritual reads as ~15 minutes. */
	minutes: number;
}

export const REVIEW_STEPS: readonly ReviewStep[] = [
	{
		id: 'brain-dump',
		title: 'Empty your head',
		hint: 'Write down everything on your mind. Do not sort it yet — that is the next step.',
		href: '/inbox',
		cta: 'Open the inbox',
		minutes: 5
	},
	{
		id: 'sort-inbox',
		title: 'Sort the inbox',
		hint: 'Every item goes to a project, to the manifest, or in the bin. Nothing stays.',
		href: '/inbox',
		cta: 'Triage items',
		minutes: 5
	},
	{
		id: 'pick-next-actions',
		title: 'Pick one next action per project',
		hint: 'One concrete, physical thing you could start. A project without one cannot move.',
		href: '/',
		cta: 'Review projects',
		minutes: 3
	},
	{
		id: 'scan-manifest',
		title: 'Scan the deadlines',
		hint: 'Look at what is coming. You are only checking nothing has crept up on you.',
		href: '/manifest',
		cta: 'Open the manifest',
		minutes: 2
	}
] as const;

export const REVIEW_TOTAL_MINUTES = REVIEW_STEPS.reduce((sum, s) => sum + s.minutes, 0);

export interface ReviewProgress {
	completed: ReviewStepId[];
	done: number;
	total: number;
	/** 0–1, for the progress bar. */
	ratio: number;
	/** First step not yet ticked, or `null` when the review is finished. */
	nextStep: ReviewStep | null;
	isComplete: boolean;
}

export function reviewProgress(week: Week | null): ReviewProgress {
	const total = REVIEW_STEPS.length;
	// Guard against unknown ids from an imported file so the bar cannot exceed 100%.
	const known = new Set(REVIEW_STEPS.map((s) => s.id));
	const completed = (week?.reviewSteps ?? []).filter((id) => known.has(id));
	const unique = [...new Set(completed)];
	const nextStep = REVIEW_STEPS.find((s) => !unique.includes(s.id)) ?? null;

	return {
		completed: unique,
		done: unique.length,
		total,
		ratio: total === 0 ? 1 : unique.length / total,
		nextStep,
		isComplete: unique.length === total
	};
}

export function toggleReviewStep(
	current: readonly ReviewStepId[],
	step: ReviewStepId,
	done: boolean
): ReviewStepId[] {
	const set = new Set(current);
	if (done) set.add(step);
	else set.delete(step);
	// Keep canonical order regardless of the order the user ticked them.
	return REVIEW_STEPS.map((s) => s.id).filter((id) => set.has(id));
}

/**
 * Live counts the review screen uses to tell you whether a step still has work in it.
 * These are hints beside each step, never gates — you can tick a step regardless.
 */
export interface ReviewSignals {
	inboxCount: number;
	stalledCount: number;
	activeProjectCount: number;
	upcomingDateCount: number;
}

export function stepSignal(step: ReviewStepId, signals: ReviewSignals): string | null {
	switch (step) {
		case 'brain-dump':
			return null;
		case 'sort-inbox':
			return signals.inboxCount === 0
				? 'Inbox is empty'
				: `${signals.inboxCount} item${signals.inboxCount === 1 ? '' : 's'} to sort`;
		case 'pick-next-actions':
			return signals.stalledCount === 0
				? 'Every project has a next action'
				: `${signals.stalledCount} project${signals.stalledCount === 1 ? '' : 's'} without one`;
		case 'scan-manifest':
			return signals.upcomingDateCount === 0
				? 'Nothing on the board'
				: `${signals.upcomingDateCount} coming up`;
	}
}
