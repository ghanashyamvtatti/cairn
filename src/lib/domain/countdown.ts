import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';
import type { FixedDate, IsoDate } from '$lib/types';

/**
 * Countdowns are computed at render and never stored.
 *
 * A stored `daysRemaining` integer silently rots at every midnight and is wrong again
 * after any timezone or DST change. Deriving it from `yyyy-MM-dd` plus "now" makes
 * correctness a property of the code path rather than of a background job that may
 * not have run.
 *
 * All arithmetic is in *calendar* days in the viewer's local timezone.
 * `differenceInCalendarDays` compares midnight-to-midnight, so a DST transition
 * between the two dates (a 23- or 25-hour day) still yields a whole number.
 */

export type CountdownTone = 'passed' | 'today' | 'imminent' | 'near' | 'far';

/** Within this many days, a date reads as urgent. */
export const IMMINENT_DAYS = 2;
/** Within this many days, a date reads as approaching. */
export const NEAR_DAYS = 14;

export interface Countdown {
	/** Whole calendar days from today. 0 is today, negative is in the past. */
	days: number;
	isPast: boolean;
	isToday: boolean;
	tone: CountdownTone;
	/** Human phrase, e.g. "Today", "Tomorrow", "in 5 days", "3 days ago". */
	label: string;
	/** Compact form for the departure board's day column, e.g. "0", "5", "−3". */
	shortLabel: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a `yyyy-MM-dd` string to local midnight, or returns `null`.
 *
 * Rejects anything that is not exactly a date-only ISO string. This matters because
 * `parseISO` happily accepts `2026-08` and `2026-08-10T14:00:00Z`, and a datetime with
 * a `Z` suffix would land on the previous or next local day for most of the world.
 * It also rejects impossible dates such as `2026-02-30`, which `parseISO` returns as
 * Invalid Date.
 */
export function parseIsoDate(value: string): Date | null {
	if (!ISO_DATE_PATTERN.test(value)) return null;
	const parsed = parseISO(value);
	if (!isValid(parsed)) return null;
	// `parseISO` rolls some out-of-range values rather than rejecting them; round-trip
	// the components to be certain the input names the day it claims to.
	const [y, m, d] = value.split('-').map(Number);
	if (parsed.getFullYear() !== y || parsed.getMonth() + 1 !== m || parsed.getDate() !== d) {
		return null;
	}
	return parsed;
}

/** Formats a Date as a local-time `yyyy-MM-dd` string. */
export function toIsoDate(date: Date): IsoDate {
	const y = String(date.getFullYear()).padStart(4, '0');
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function toneFor(days: number): CountdownTone {
	if (days < 0) return 'passed';
	if (days === 0) return 'today';
	if (days <= IMMINENT_DAYS) return 'imminent';
	if (days <= NEAR_DAYS) return 'near';
	return 'far';
}

function labelFor(days: number): string {
	if (days === 0) return 'Today';
	if (days === 1) return 'Tomorrow';
	if (days === -1) return 'Yesterday';
	if (days > 1) return `in ${days} days`;
	return `${-days} days ago`;
}

/**
 * Days between today and `date`, plus presentation hints.
 *
 * Returns `null` when `date` is not a valid `yyyy-MM-dd` string, which can happen with
 * hand-edited or third-party import files. Callers render the raw value in that case
 * rather than crashing a list.
 */
export function countdownFor(date: string, now: number | Date): Countdown | null {
	const target = parseIsoDate(date);
	if (!target) return null;

	const today = now instanceof Date ? now : new Date(now);
	const days = differenceInCalendarDays(target, today);

	return {
		days,
		isPast: days < 0,
		isToday: days === 0,
		tone: toneFor(days),
		label: labelFor(days),
		// U+2212 MINUS SIGN, which aligns with digits in tabular figures where an
		// ASCII hyphen does not.
		shortLabel: days < 0 ? `−${Math.abs(days)}` : String(days)
	};
}

export interface DatedItem {
	date: string;
}

export interface PartitionedDates<T extends DatedItem> {
	/** Today and later, soonest first. A departure board shows the next thing at the top. */
	upcoming: T[];
	/** Yesterday and earlier, most recent first. */
	passed: T[];
	/** Rows whose `date` could not be parsed; surfaced rather than silently dropped. */
	invalid: T[];
}

/**
 * Splits dated items into the departure board's two sections.
 *
 * Ties are broken by title then id so the order is stable across renders and across
 * devices — otherwise two items on the same date would swap places on every reload.
 */
export function partitionByDate<T extends DatedItem & { title?: string; id?: string }>(
	items: readonly T[],
	now: number | Date
): PartitionedDates<T> {
	const upcoming: T[] = [];
	const passed: T[] = [];
	const invalid: T[] = [];

	for (const item of items) {
		const countdown = countdownFor(item.date, now);
		if (!countdown) invalid.push(item);
		else if (countdown.isPast) passed.push(item);
		else upcoming.push(item);
	}

	const byTitleThenId = (a: T, b: T) =>
		(a.title ?? '').localeCompare(b.title ?? '') || (a.id ?? '').localeCompare(b.id ?? '');

	upcoming.sort((a, b) => a.date.localeCompare(b.date) || byTitleThenId(a, b));
	passed.sort((a, b) => b.date.localeCompare(a.date) || byTitleThenId(a, b));

	return { upcoming, passed, invalid };
}

/** Convenience wrapper for the dates board. */
export function partitionFixedDates(items: readonly FixedDate[], now: number | Date) {
	return partitionByDate(items, now);
}

/** How many dates the Today screen shows at most. Enough to plan, few enough to glance. */
export const COMING_UP_LIMIT = 5;

/**
 * The dates close enough to change what this week looks like.
 *
 * Today's "coming up" strip is deliberately not the whole board: a date six months out
 * is noise every single morning, and noise repeated daily is how a calm surface stops
 * being read at all. Everything else stays one tap away on the board itself.
 */
export function comingUpSoon<T extends DatedItem & { title?: string; id?: string }>(
	items: readonly T[],
	now: number | Date,
	{
		horizonDays = NEAR_DAYS,
		limit = COMING_UP_LIMIT
	}: { horizonDays?: number; limit?: number } = {}
): T[] {
	return partitionByDate(items, now)
		.upcoming.filter((item) => {
			const countdown = countdownFor(item.date, now);
			return countdown !== null && countdown.days <= horizonDays;
		})
		.slice(0, limit);
}
