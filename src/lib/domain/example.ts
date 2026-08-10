import type { IsoDate } from '$lib/types';

/**
 * A worked example week.
 *
 * Abstract instructions about "projects" and "next actions" land much better against a
 * board that already has something on it, so a brand-new user can load a filled-in week
 * and see the shape rather than read about it. Everything here is ordinary data created
 * through the ordinary repository methods, so deleting it is just deleting things.
 *
 * The content is deliberately mundane domestic admin: recognisable to almost anyone, and
 * obviously not the user's own work.
 */

export interface ExampleTask {
	title: string;
	/** Exactly one per project, or none to demonstrate a stalled project. */
	isNextAction?: boolean;
}

export interface ExampleProject {
	title: string;
	tasks: ExampleTask[];
}

export interface ExampleDate {
	title: string;
	/** Days from today. Resolved against the current date when seeded. */
	inDays: number;
	note?: string;
}

export const EXAMPLE_PROJECTS: readonly ExampleProject[] = [
	{
		title: 'Move the studio to the new space',
		tasks: [
			{ title: 'Ring three removal firms for quotes', isNextAction: true },
			{ title: 'Measure the alcove for the plan chest' },
			{ title: 'Give notice on the old unit' }
		]
	},
	{
		title: 'Get the tax return filed',
		tasks: [
			{ title: 'Dig out last year’s P60', isNextAction: true },
			{ title: 'Total up the receipts folder' }
		]
	},
	{
		// Left without a next action on purpose: this is what "stalled" looks like, and
		// it is the single hardest idea to explain in the abstract.
		title: 'Sort out the leaking gutter',
		tasks: [{ title: 'Find where the water is actually coming in' }]
	}
] as const;

export const EXAMPLE_DATES: readonly ExampleDate[] = [
	{ title: 'Passport expires', inDays: 96, note: 'Renewals take about 3 weeks' },
	{ title: 'Car MOT due', inDays: 23 },
	{ title: 'Mum’s birthday', inDays: 5 },
	{ title: 'Buildings insurance renews', inDays: 2, note: 'Compare before it auto-renews' }
] as const;

export const EXAMPLE_INBOX: readonly string[] = [
	'Ask Priya who she used for the floor',
	'Book the dentist',
	'Something about the bike light — replace or recharge?'
] as const;

/** Turns a relative offset into a local `yyyy-MM-dd`, so examples are always current. */
export function exampleDate(inDays: number, from: Date = new Date()): IsoDate {
	const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + inDays);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
