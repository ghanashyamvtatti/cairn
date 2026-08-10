import type { AppRoute } from '$lib/routes';

/**
 * The guided tour.
 *
 * Cairn's vocabulary is not self-explanatory — "manifest" and "next action" mean
 * specific things here, and the value of a three-project cap is not visible from an
 * empty screen. The tour exists to answer one question in order: what is each of these
 * four places *for*, and what is the rhythm that connects them.
 *
 * Steps are data, so the sequence is reviewable in one place and unit-testable without
 * a browser.
 */
export interface TourStep {
	id: string;
	/** Where this step lives. The tour navigates there before showing it. */
	route: AppRoute;
	/**
	 * CSS selector for the element to spotlight. Omitted for steps that talk about the
	 * screen as a whole. A selector that matches nothing degrades to a centred card
	 * rather than breaking the tour — the target may legitimately not exist yet.
	 */
	target?: string;
	title: string;
	body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
	{
		id: 'projects',
		route: '/',
		target: '[data-tour="projects"]',
		title: 'Three projects, and no more',
		body: 'A project is an outcome that takes more than one step. Cairn shows three at a time because three is roughly what a week actually holds. You can go over the line — it just will not let you do it by accident.'
	},
	{
		id: 'next-action',
		route: '/',
		target: '[data-tour="next-action"]',
		title: 'One next action each',
		body: 'Every project names exactly one physical thing you could start next. A project without one is “stalled”, which is not a telling-off — it is a prompt, and the prompt is a text box.'
	},
	{
		id: 'capture',
		route: '/',
		target: '[data-tour="capture"]',
		title: 'Get it out of your head',
		body: 'Press c anywhere, type, press Enter. No fields, no choices, no deciding. If you write “call the bank on Friday”, the date is understood and lifted out for you.'
	},
	{
		id: 'inbox',
		route: '/inbox',
		target: '[data-tour="inbox-list"]',
		title: 'Sort it later, not now',
		body: 'Whatever you captured waits here until you choose where it goes: into a project, onto the board of dates, or into the bin. Thinking of things and deciding about them are different jobs.'
	},
	{
		id: 'manifest',
		route: '/manifest',
		target: '[data-tour="manifest-board"]',
		title: 'Dates that arrive anyway',
		body: 'The manifest is a departure board of fixed dates — renewals, flights, deadlines — counting down. They are deliberately not tasks and cannot be ticked off, because a date is not something you do.'
	},
	{
		id: 'review',
		route: '/review',
		target: '[data-tour="review-steps"]',
		title: 'Fifteen minutes, once a week',
		body: 'Four steps: empty your head, sort the inbox, pick one next action per project, glance at the dates. Then start a new week.'
	},
	{
		id: 'reset',
		route: '/review',
		target: '[data-tour="new-week"]',
		title: 'Nothing turns red, ever',
		body: 'Starting a new week files what you finished and carries the rest forward, unchanged and unmarked. Miss a week and nothing piles up, nothing is late, and nothing is deleted. That is the whole point of the app.'
	},
	{
		id: 'data',
		route: '/settings',
		target: '[data-tour="backup"]',
		title: 'Your data is here and nowhere else',
		body: 'No account, no server, nothing sent anywhere. That also means a backup is the only copy that survives a cleared browser — so export one now and then. On an iPhone, add Cairn to your Home Screen: Safari deletes ordinary site data after seven days.'
	}
] as const;

export function tourStepAt(index: number): TourStep | null {
	return TOUR_STEPS[index] ?? null;
}

export function clampStepIndex(index: number): number {
	if (!Number.isFinite(index)) return 0;
	return Math.min(TOUR_STEPS.length - 1, Math.max(0, Math.round(index)));
}
