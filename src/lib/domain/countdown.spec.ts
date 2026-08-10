import { describe, expect, it } from 'vitest';
import {
	IMMINENT_DAYS,
	NEAR_DAYS,
	countdownFor,
	parseIsoDate,
	partitionByDate,
	partitionFixedDates,
	toIsoDate,
	type Countdown,
	type CountdownTone
} from '$lib/domain/countdown';
import type { FixedDate, IsoDate } from '$lib/types';

/*
 * Everything in here is constructed with `new Date(y, m, d, ...)`, which is relative to
 * the ambient timezone, never with a UTC instant literal. The suite runs under
 * Europe/London, America/Los_Angeles and Pacific/Chatham, so any assertion that pins a
 * UTC instant to a calendar day would be a lie in at least two of them.
 */

/** A local wall-clock Date. `month` is 1-indexed here, unlike the Date constructor. */
function local(
	year: number,
	month: number,
	day: number,
	hours = 12,
	minutes = 0,
	seconds = 0,
	ms = 0
): Date {
	return new Date(year, month - 1, day, hours, minutes, seconds, ms);
}

/** `base` shifted by whole calendar days, landing at local noon (always a real time). */
function shiftDays(base: Date, days: number): Date {
	return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 12);
}

/** 10 August 2026, 09:30 local. */
const NOW = local(2026, 8, 10, 9, 30);

/** The `yyyy-MM-dd` string for the local day `delta` calendar days from NOW. */
function isoFromNow(delta: number): IsoDate {
	return toIsoDate(shiftDays(NOW, delta));
}

function parsedOrThrow(value: string): Date {
	const parsed = parseIsoDate(value);
	if (!parsed) throw new Error(`expected parseIsoDate(${JSON.stringify(value)}) to succeed`);
	return parsed;
}

function countdownOrThrow(date: string, now: number | Date): Countdown {
	const result = countdownFor(date, now);
	if (!result) throw new Error(`expected countdownFor(${JSON.stringify(date)}) to succeed`);
	return result;
}

function fixed(id: string, title: string, date: string): FixedDate {
	return { id, title, date, createdAt: 0, updatedAt: 0, deletedAt: null };
}

interface AcceptedInput {
	value: string;
	year: number;
	month: number;
	day: number;
}

const ACCEPTED_INPUTS: readonly AcceptedInput[] = [
	{ value: '2026-08-10', year: 2026, month: 8, day: 10 },
	{ value: '2026-01-01', year: 2026, month: 1, day: 1 },
	{ value: '2026-12-31', year: 2026, month: 12, day: 31 },
	{ value: '1999-12-31', year: 1999, month: 12, day: 31 },
	// Real leap days: divisible by 4, and the divisible-by-400 century exception.
	{ value: '2024-02-29', year: 2024, month: 2, day: 29 },
	{ value: '2000-02-29', year: 2000, month: 2, day: 29 },
	// Days on which one of the three test zones changes offset. Every one of these
	// transitions happens after 00:00, so local midnight exists on all of them.
	{ value: '2026-03-08', year: 2026, month: 3, day: 8 }, // Los Angeles springs forward
	{ value: '2026-03-29', year: 2026, month: 3, day: 29 }, // London springs forward
	{ value: '2026-04-05', year: 2026, month: 4, day: 5 }, // Chatham falls back
	{ value: '2026-09-27', year: 2026, month: 9, day: 27 }, // Chatham springs forward
	{ value: '2026-10-25', year: 2026, month: 10, day: 25 }, // London falls back
	{ value: '2026-11-01', year: 2026, month: 11, day: 1 } // Los Angeles falls back
];

interface RejectedInput {
	desc: string;
	value: string;
}

const REJECTED_INPUTS: readonly RejectedInput[] = [
	{ desc: 'a year-month with no day', value: '2026-08' },
	{ desc: 'an unpadded month and day', value: '2026-8-1' },
	{ desc: 'a UTC datetime', value: '2026-08-10T14:00:00Z' },
	{ desc: 'a local datetime', value: '2026-08-10T14:00:00' },
	{ desc: 'the empty string', value: '' },
	{ desc: 'natural language', value: 'tomorrow' },
	{ desc: 'basic format with no separators', value: '20260810' },
	{ desc: 'a date surrounded by whitespace', value: ' 2026-08-10 ' },
	{ desc: 'a date with a trailing space', value: '2026-08-10 ' },
	{ desc: 'a date with a leading newline', value: '\n2026-08-10' },
	{ desc: 'month 13', value: '2026-13-01' },
	{ desc: 'month 00', value: '2026-00-10' },
	{ desc: 'day 00', value: '2026-12-00' },
	{ desc: '30 February', value: '2026-02-30' },
	{ desc: '31 April', value: '2026-04-31' },
	{ desc: '32 January', value: '2026-01-32' },
	{ desc: '29 February in a non-leap year', value: '2025-02-29' },
	{ desc: '29 February in a century non-leap year', value: '1900-02-29' }
];

describe('parseIsoDate', () => {
	it.each(ACCEPTED_INPUTS)('parses $value to local midnight on that day', (input) => {
		const parsed = parsedOrThrow(input.value);
		expect({
			year: parsed.getFullYear(),
			month: parsed.getMonth() + 1,
			day: parsed.getDate()
		}).toEqual({ year: input.year, month: input.month, day: input.day });
	});

	it.each(ACCEPTED_INPUTS)('parses $value to 00:00:00.000 local, not to a UTC instant', (input) => {
		const parsed = parsedOrThrow(input.value);
		expect([
			parsed.getHours(),
			parsed.getMinutes(),
			parsed.getSeconds(),
			parsed.getMilliseconds()
		]).toEqual([0, 0, 0, 0]);
	});

	it.each(ACCEPTED_INPUTS)(
		'parses $value to the same instant as the local Date constructor',
		(input) => {
			const parsed = parsedOrThrow(input.value);
			expect(parsed.getTime()).toBe(local(input.year, input.month, input.day, 0).getTime());
		}
	);

	it.each(REJECTED_INPUTS)('returns null for $desc', (input) => {
		expect(parseIsoDate(input.value)).toBeNull();
	});

	it('accepts the real leap day 2024-02-29 but rejects 2025-02-29', () => {
		expect(parseIsoDate('2024-02-29')).toBeInstanceOf(Date);
		expect(parseIsoDate('2025-02-29')).toBeNull();
	});

	it('rejects the century non-leap 1900-02-29 but accepts 2000-02-29', () => {
		expect(parseIsoDate('1900-02-29')).toBeNull();
		expect(parseIsoDate('2000-02-29')).toBeInstanceOf(Date);
	});

	it('does not roll an out-of-range day into the following month', () => {
		// `2026-04-31` must not silently become 1 May.
		expect(parseIsoDate('2026-04-31')).toBeNull();
		expect(toIsoDate(parsedOrThrow('2026-04-30'))).toBe('2026-04-30');
	});
});

describe('toIsoDate', () => {
	it.each(ACCEPTED_INPUTS)('round-trips $value through parseIsoDate unchanged', (input) => {
		expect(toIsoDate(parsedOrThrow(input.value))).toBe(input.value);
	});

	it('zero-pads single-digit months and days', () => {
		expect(toIsoDate(local(2026, 1, 5))).toBe('2026-01-05');
		expect(toIsoDate(local(2026, 9, 9))).toBe('2026-09-09');
		expect(toIsoDate(local(2026, 12, 1))).toBe('2026-12-01');
	});

	it('uses local calendar components, not UTC ones, in summer', () => {
		const justAfterMidnight = local(2026, 8, 10, 0, 30);
		const justBeforeMidnight = local(2026, 8, 10, 23, 30);

		// Guard: at least one of these two instants falls on a different calendar day in
		// UTC than it does locally, in every one of the three test timezones. Without
		// this the assertions below could pass vacuously in a UTC-like zone.
		const utcDays = [justAfterMidnight, justBeforeMidnight].map((d) =>
			d.toISOString().slice(0, 10)
		);
		expect(utcDays.some((utcDay) => utcDay !== '2026-08-10')).toBe(true);

		expect(toIsoDate(justAfterMidnight)).toBe('2026-08-10');
		expect(toIsoDate(justBeforeMidnight)).toBe('2026-08-10');
	});

	it('uses local calendar components, not UTC ones, in winter', () => {
		const justAfterMidnight = local(2026, 1, 15, 0, 30);
		const justBeforeMidnight = local(2026, 1, 15, 23, 30);

		// London sits on UTC in January, so unlike the summer case the two instants only
		// have to straddle the UTC date line when the zone is actually offset.
		const utcDays = [justAfterMidnight, justBeforeMidnight].map((d) =>
			d.toISOString().slice(0, 10)
		);
		const isOffsetFromUtc = justAfterMidnight.getTimezoneOffset() !== 0;
		expect(utcDays.some((utcDay) => utcDay !== '2026-01-15')).toBe(isOffsetFromUtc);

		expect(toIsoDate(justAfterMidnight)).toBe('2026-01-15');
		expect(toIsoDate(justBeforeMidnight)).toBe('2026-01-15');
	});

	it('reports the same day for every hour of a day', () => {
		const mismatches: string[] = [];
		for (let hour = 0; hour < 24; hour++) {
			const iso = toIsoDate(local(2026, 8, 10, hour));
			if (iso !== '2026-08-10') mismatches.push(`${hour}:00 -> ${iso}`);
		}
		expect(mismatches).toEqual([]);
	});

	it('round-trips every day of a leap year with parseIsoDate', () => {
		const mismatches: string[] = [];
		for (let offset = 0; offset < 366; offset++) {
			const day = new Date(2024, 0, 1 + offset, 12);
			const iso = toIsoDate(day);
			const parsed = parseIsoDate(iso);
			if (!parsed) {
				mismatches.push(`${iso} did not parse`);
				continue;
			}
			if (
				parsed.getFullYear() !== day.getFullYear() ||
				parsed.getMonth() !== day.getMonth() ||
				parsed.getDate() !== day.getDate()
			) {
				mismatches.push(`${iso} parsed back as ${toIsoDate(parsed)}`);
			}
		}
		expect(mismatches).toEqual([]);
	});
});

interface CountdownCase {
	name: string;
	offset: number;
	label: string;
	tone: CountdownTone;
	shortLabel: string;
	isPast: boolean;
	isToday: boolean;
}

const COUNTDOWN_CASES: readonly CountdownCase[] = [
	{
		name: 'today',
		offset: 0,
		label: 'Today',
		tone: 'today',
		shortLabel: '0',
		isPast: false,
		isToday: true
	},
	{
		name: 'tomorrow',
		offset: 1,
		label: 'Tomorrow',
		tone: 'imminent',
		shortLabel: '1',
		isPast: false,
		isToday: false
	},
	{
		name: 'two days out',
		offset: 2,
		label: 'in 2 days',
		tone: 'imminent',
		shortLabel: '2',
		isPast: false,
		isToday: false
	},
	{
		name: 'three days out',
		offset: 3,
		label: 'in 3 days',
		tone: 'near',
		shortLabel: '3',
		isPast: false,
		isToday: false
	},
	{
		name: 'fourteen days out',
		offset: 14,
		label: 'in 14 days',
		tone: 'near',
		shortLabel: '14',
		isPast: false,
		isToday: false
	},
	{
		name: 'fifteen days out',
		offset: 15,
		label: 'in 15 days',
		tone: 'far',
		shortLabel: '15',
		isPast: false,
		isToday: false
	},
	{
		name: 'yesterday',
		offset: -1,
		label: 'Yesterday',
		tone: 'passed',
		shortLabel: '−1',
		isPast: true,
		isToday: false
	},
	{
		name: 'five days ago',
		offset: -5,
		label: '5 days ago',
		tone: 'passed',
		shortLabel: '−5',
		isPast: true,
		isToday: false
	}
];

describe('countdownFor', () => {
	it.each(COUNTDOWN_CASES)(
		'describes $name as days $offset, label "$label", tone $tone',
		(testCase) => {
			expect(countdownOrThrow(isoFromNow(testCase.offset), NOW)).toEqual({
				days: testCase.offset,
				isPast: testCase.isPast,
				isToday: testCase.isToday,
				tone: testCase.tone,
				label: testCase.label,
				shortLabel: testCase.shortLabel
			} satisfies Countdown);
		}
	);

	it('writes past shortLabels with U+2212 MINUS SIGN, not an ASCII hyphen', () => {
		const yesterday = countdownOrThrow(isoFromNow(-1), NOW);
		const longAgo = countdownOrThrow(isoFromNow(-42), NOW);

		expect(yesterday.shortLabel.codePointAt(0)).toBe(0x2212);
		expect(longAgo.shortLabel.codePointAt(0)).toBe(0x2212);
		expect(yesterday.shortLabel).toBe('−1');
		expect(longAgo.shortLabel).toBe('−42');
		expect(yesterday.shortLabel.includes('-')).toBe(false);
	});

	it('writes today and future shortLabels as bare digits', () => {
		expect(countdownOrThrow(isoFromNow(0), NOW).shortLabel).toBe('0');
		expect(countdownOrThrow(isoFromNow(7), NOW).shortLabel).toBe('7');
		expect(countdownOrThrow(isoFromNow(365), NOW).shortLabel).toBe('365');
	});

	it.each(REJECTED_INPUTS)('returns null for $desc', (input) => {
		expect(countdownFor(input.value, NOW)).toBeNull();
	});

	it('reports zero days at the very first millisecond of the day', () => {
		const firstInstant = local(2026, 8, 10, 0, 0, 0, 0);
		const countdown = countdownOrThrow('2026-08-10', firstInstant);
		expect(countdown.days).toBe(0);
		expect(countdown.isToday).toBe(true);
		expect(countdown.isPast).toBe(false);
		expect(countdown.label).toBe('Today');
	});

	it('reports zero days at the very last millisecond of the day', () => {
		const lastInstant = local(2026, 8, 10, 23, 59, 59, 999);
		const countdown = countdownOrThrow('2026-08-10', lastInstant);
		expect(countdown.days).toBe(0);
		expect(countdown.isToday).toBe(true);
		expect(countdown.isPast).toBe(false);
		expect(countdown.label).toBe('Today');
	});

	it('still reports one day for tomorrow at the last millisecond of today', () => {
		const lastInstant = local(2026, 8, 10, 23, 59, 59, 999);
		expect(countdownOrThrow('2026-08-11', lastInstant).days).toBe(1);
		expect(countdownOrThrow('2026-08-09', lastInstant).days).toBe(-1);
	});

	it('gives the same answer at every hour of the reference day', () => {
		const mismatches: string[] = [];
		for (let hour = 0; hour < 24; hour++) {
			const now = local(2026, 8, 10, hour, 30);
			const today = countdownOrThrow('2026-08-10', now).days;
			const tomorrow = countdownOrThrow('2026-08-11', now).days;
			if (today !== 0 || tomorrow !== 1) {
				mismatches.push(`${hour}:30 -> today=${today}, tomorrow=${tomorrow}`);
			}
		}
		expect(mismatches).toEqual([]);
	});

	// 200 days from any of these bases necessarily crosses at least one DST transition in
	// London, Los Angeles and Chatham alike — asserted below rather than assumed.
	const DST_SPAN_BASES: readonly { desc: string; base: Date }[] = [
		{ desc: '1 January 2026', base: local(2026, 1, 1) },
		{ desc: '1 March 2026', base: local(2026, 3, 1) },
		{ desc: '15 June 2026', base: local(2026, 6, 15) }
	];

	it.each(DST_SPAN_BASES)('spans a DST transition in this timezone from $desc', (span) => {
		const later = shiftDays(span.base, 200);
		expect(span.base.getTimezoneOffset()).not.toBe(later.getTimezoneOffset());
	});

	it.each(DST_SPAN_BASES)('counts 200 whole calendar days from $desc', (span) => {
		const later = shiftDays(span.base, 200);
		expect(countdownOrThrow(toIsoDate(later), span.base).days).toBe(200);
	});

	it.each(DST_SPAN_BASES)('counts -200 whole calendar days back to $desc', (span) => {
		const later = shiftDays(span.base, 200);
		const countdown = countdownOrThrow(toIsoDate(span.base), later);
		expect(countdown.days).toBe(-200);
		expect(countdown.isPast).toBe(true);
		expect(countdown.tone).toBe('passed');
	});

	it('steps exactly one day at a time across spring and autumn DST transitions', () => {
		// 1 March to mid-November covers both transitions in all three test zones.
		const mismatches: string[] = [];
		for (let offset = 0; offset < 260; offset++) {
			const day = new Date(2026, 2, 1 + offset, 12);
			const next = new Date(2026, 2, 2 + offset, 12);
			const days = countdownOrThrow(toIsoDate(next), day).days;
			if (days !== 1) mismatches.push(`${toIsoDate(day)} -> ${toIsoDate(next)} = ${days}`);
		}
		expect(mismatches).toEqual([]);
	});

	it('counts one day across the new year boundary', () => {
		expect(countdownOrThrow('2027-01-01', local(2026, 12, 31, 9)).days).toBe(1);
		expect(countdownOrThrow('2026-12-31', local(2027, 1, 1, 9)).days).toBe(-1);
	});

	it('counts two days from 28 February to 1 March in a leap year', () => {
		expect(countdownOrThrow('2024-03-01', local(2024, 2, 28, 9)).days).toBe(2);
		expect(countdownOrThrow('2024-03-01', local(2024, 2, 29, 9)).days).toBe(1);
	});

	it('counts one day from 28 February to 1 March in a non-leap year', () => {
		expect(countdownOrThrow('2025-03-01', local(2025, 2, 28, 9)).days).toBe(1);
	});

	it.each([-400, -5, -1, 0, 1, 2, 3, 14, 15, 400])(
		'gives identical results for a numeric now and a Date now at offset %i',
		(offset) => {
			const iso = isoFromNow(offset);
			expect(countdownFor(iso, NOW.getTime())).toEqual(countdownFor(iso, NOW));
		}
	);

	it('gives identical results for a numeric now when the date is unparseable', () => {
		expect(countdownFor('not a date', NOW.getTime())).toBeNull();
		expect(countdownFor('not a date', NOW)).toBeNull();
	});
});

describe('IMMINENT_DAYS and NEAR_DAYS', () => {
	it('expose the documented threshold values', () => {
		expect(IMMINENT_DAYS).toBe(2);
		expect(NEAR_DAYS).toBe(14);
		expect(IMMINENT_DAYS).toBeLessThan(NEAR_DAYS);
	});

	it('treats IMMINENT_DAYS as the inclusive upper bound of the imminent tone', () => {
		expect(countdownOrThrow(isoFromNow(IMMINENT_DAYS), NOW).tone).toBe('imminent');
		expect(countdownOrThrow(isoFromNow(IMMINENT_DAYS + 1), NOW).tone).toBe('near');
	});

	it('treats NEAR_DAYS as the inclusive upper bound of the near tone', () => {
		expect(countdownOrThrow(isoFromNow(NEAR_DAYS), NOW).tone).toBe('near');
		expect(countdownOrThrow(isoFromNow(NEAR_DAYS + 1), NOW).tone).toBe('far');
	});

	it('assigns exactly one tone to every offset from -30 to +30', () => {
		const tones = new Map<number, CountdownTone>();
		for (let offset = -30; offset <= 30; offset++) {
			tones.set(offset, countdownOrThrow(isoFromNow(offset), NOW).tone);
		}
		expect(tones.get(-30)).toBe('passed');
		expect(tones.get(-1)).toBe('passed');
		expect(tones.get(0)).toBe('today');
		expect(tones.get(1)).toBe('imminent');
		expect(tones.get(30)).toBe('far');
		expect([...tones.values()].filter((tone) => tone === 'today')).toEqual(['today']);
	});
});

describe('partitionByDate', () => {
	it('returns three empty arrays for empty input', () => {
		expect(partitionByDate<FixedDate>([], NOW)).toEqual({
			upcoming: [],
			passed: [],
			invalid: []
		});
	});

	it("places today's date in upcoming rather than passed", () => {
		const today = fixed('today', 'Today', isoFromNow(0));
		const result = partitionByDate([today], NOW);
		expect(result.upcoming).toEqual([today]);
		expect(result.passed).toEqual([]);
		expect(result.invalid).toEqual([]);
	});

	it('keeps today in upcoming at the last millisecond of the day', () => {
		const endOfDay = local(2026, 8, 10, 23, 59, 59, 999);
		const today = fixed('today', 'Today', '2026-08-10');
		expect(partitionByDate([today], endOfDay).upcoming).toEqual([today]);
	});

	it('sorts upcoming soonest first', () => {
		const items = [
			fixed('c', 'C', isoFromNow(10)),
			fixed('a', 'A', isoFromNow(0)),
			fixed('d', 'D', isoFromNow(400)),
			fixed('b', 'B', isoFromNow(3))
		];
		expect(partitionByDate(items, NOW).upcoming.map((item) => item.id)).toEqual([
			'a',
			'b',
			'c',
			'd'
		]);
	});

	it('sorts passed most recent first', () => {
		const items = [
			fixed('x', 'X', isoFromNow(-30)),
			fixed('y', 'Y', isoFromNow(-1)),
			fixed('w', 'W', isoFromNow(-400)),
			fixed('z', 'Z', isoFromNow(-7))
		];
		expect(partitionByDate(items, NOW).passed.map((item) => item.id)).toEqual(['y', 'z', 'x', 'w']);
	});

	it('surfaces unparseable dates in invalid rather than silently dropping them', () => {
		const items = [
			fixed('good', 'Good', isoFromNow(1)),
			fixed('empty', 'Empty', ''),
			fixed('prose', 'Prose', 'next tuesday'),
			fixed('impossible', 'Impossible', '2026-02-30'),
			fixed('datetime', 'Datetime', '2026-08-10T14:00:00Z'),
			fixed('past', 'Past', isoFromNow(-1))
		];
		const result = partitionByDate(items, NOW);

		expect(result.invalid.map((item) => item.id)).toEqual([
			'empty',
			'prose',
			'impossible',
			'datetime'
		]);
		expect(result.upcoming.map((item) => item.id)).toEqual(['good']);
		expect(result.passed.map((item) => item.id)).toEqual(['past']);
		expect(result.upcoming.length + result.passed.length + result.invalid.length).toBe(
			items.length
		);
	});

	it('breaks upcoming ties on the same date by title then id', () => {
		const date = isoFromNow(4);
		const items = [
			fixed('beta-2', 'Beta', date),
			fixed('alpha-2', 'Alpha', date),
			fixed('beta-1', 'Beta', date),
			fixed('alpha-1', 'Alpha', date)
		];
		expect(partitionByDate(items, NOW).upcoming.map((item) => item.id)).toEqual([
			'alpha-1',
			'alpha-2',
			'beta-1',
			'beta-2'
		]);
	});

	it('breaks passed ties on the same date by title then id as well', () => {
		const date = isoFromNow(-4);
		const items = [
			fixed('beta-2', 'Beta', date),
			fixed('alpha-2', 'Alpha', date),
			fixed('beta-1', 'Beta', date),
			fixed('alpha-1', 'Alpha', date)
		];
		expect(partitionByDate(items, NOW).passed.map((item) => item.id)).toEqual([
			'alpha-1',
			'alpha-2',
			'beta-1',
			'beta-2'
		]);
	});

	it('produces the same output order for shuffled input orders', () => {
		const soon = fixed('soon', 'Soon', isoFromNow(2));
		const tieA = fixed('tie-a', 'Shared title', isoFromNow(5));
		const tieB = fixed('tie-b', 'Shared title', isoFromNow(5));
		const later = fixed('later', 'Later', isoFromNow(9));
		const recent = fixed('recent', 'Recent', isoFromNow(-2));
		const oldA = fixed('old-a', 'Old', isoFromNow(-9));
		const oldB = fixed('old-b', 'Old', isoFromNow(-9));

		const original = [soon, tieA, tieB, later, recent, oldA, oldB];
		const reversed = [...original].reverse();
		const rotated = [oldA, later, soon, oldB, tieB, recent, tieA];

		const base = partitionByDate(original, NOW);
		expect(base.upcoming.map((item) => item.id)).toEqual(['soon', 'tie-a', 'tie-b', 'later']);
		expect(base.passed.map((item) => item.id)).toEqual(['recent', 'old-a', 'old-b']);

		for (const permutation of [reversed, rotated]) {
			const result = partitionByDate(permutation, NOW);
			expect(result.upcoming.map((item) => item.id)).toEqual(base.upcoming.map((item) => item.id));
			expect(result.passed.map((item) => item.id)).toEqual(base.passed.map((item) => item.id));
		}
	});

	it('is idempotent across repeated calls with the same input', () => {
		const items = [
			fixed('b', 'B', isoFromNow(1)),
			fixed('a', 'A', isoFromNow(1)),
			fixed('c', 'C', isoFromNow(-1))
		];
		expect(partitionByDate(items, NOW)).toEqual(partitionByDate(items, NOW));
	});

	it('accepts a numeric now interchangeably with a Date now', () => {
		const items = [
			fixed('a', 'A', isoFromNow(1)),
			fixed('b', 'B', isoFromNow(-1)),
			fixed('c', 'C', 'nope')
		];
		expect(partitionByDate(items, NOW.getTime())).toEqual(partitionByDate(items, NOW));
	});

	it('sorts items that have neither title nor id without throwing', () => {
		const items: { date: string }[] = [{ date: isoFromNow(3) }, { date: isoFromNow(1) }];
		expect(partitionByDate(items, NOW).upcoming.map((item) => item.date)).toEqual([
			isoFromNow(1),
			isoFromNow(3)
		]);
	});
});

describe('partitionFixedDates', () => {
	const items = [
		fixed('past', 'Past', isoFromNow(-3)),
		fixed('today', 'Today', isoFromNow(0)),
		fixed('soon', 'Soon', isoFromNow(2)),
		fixed('broken', 'Broken', '2026-02-30')
	];

	it('splits fixed dates into upcoming, passed and invalid', () => {
		const result = partitionFixedDates(items, NOW);
		expect(result.upcoming.map((item) => item.id)).toEqual(['today', 'soon']);
		expect(result.passed.map((item) => item.id)).toEqual(['past']);
		expect(result.invalid.map((item) => item.id)).toEqual(['broken']);
	});

	it('matches partitionByDate exactly', () => {
		expect(partitionFixedDates(items, NOW)).toEqual(partitionByDate(items, NOW));
	});

	it('returns three empty arrays for empty input', () => {
		expect(partitionFixedDates([], NOW)).toEqual({ upcoming: [], passed: [], invalid: [] });
	});
});
