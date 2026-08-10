import { describe, expect, it } from 'vitest';
import * as chrono from 'chrono-node';
import type { IsoDate } from '$lib/types';
import { parseIsoDate, toIsoDate } from '$lib/domain/countdown';
import { loadChrono, parseCapture, parseCaptureWith, type CapturedText } from '$lib/domain/capture';

/**
 * The reference instant for every parse in this file, built from *local* calendar
 * components so the suite means the same thing in London, Los Angeles and Chatham.
 * 10 August 2026, 09:00 local — a Monday (asserted below rather than assumed).
 */
const REF = new Date(2026, 7, 10, 9, 0);

/** Local midnight of the reference day. */
const REF_DAY = new Date(2026, 7, 10);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Words `tidy` is documented to drop when they are left dangling by the date phrase. */
const DANGLING_PREPOSITION = /(^|\s)(on|by|due|at|before)$/i;

function parse(input: string, now: Date | number = REF): CapturedText {
	return parseCaptureWith(chrono, input, now);
}

/** Asserts a date was found and narrows it to a non-null `IsoDate`. */
function isoDateOf(result: CapturedText): IsoDate {
	expect(result.date, `expected a parsed date for ${JSON.stringify(result.raw)}`).toMatch(ISO_DATE);
	if (result.date === null) throw new Error('unreachable: date asserted non-null above');
	return result.date;
}

/** Asserts the found date round-trips through `parseIsoDate` and returns local midnight. */
function localDateOf(result: CapturedText): Date {
	const iso = isoDateOf(result);
	const parsed = parseIsoDate(iso);
	expect(parsed, `parseIsoDate rejected ${iso}`).not.toBeNull();
	if (parsed === null) throw new Error('unreachable: parsed asserted non-null above');
	return parsed;
}

/** The next local date on or after `from` that falls on `weekday` (0 = Sunday). */
function nextOccurrence(from: Date, weekday: number): Date {
	const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	day.setDate(day.getDate() + ((weekday - day.getDay() + 7) % 7));
	return day;
}

/**
 * A cross-section of realistic captures, reused by the invariant suites below so a
 * regression in `tidy` shows up on every shape of input at once.
 */
const CORPUS = [
	'',
	'   ',
	'Buy milk',
	'Buy 5 apples',
	'Read chapter 3',
	'Pay invoice 42',
	'Meeting at 3',
	'Call the bank tomorrow',
	'  Call the bank tomorrow  ',
	'tomorrow',
	'Dentist on 3 March',
	'Review by Friday',
	'File taxes before Friday',
	'Ship it due tomorrow',
	'Pay invoice 42 on Friday',
	'Tomorrow call the bank',
	'Call tomorrow about the bank',
	'Renew passport on 1 Sep',
	'Submit form 1040 by April 15'
] as const;

describe('the test fixture itself', () => {
	it('uses a reference instant that is a Monday in every timezone the suite runs in', () => {
		expect(REF.getDay()).toBe(1);
		expect(toIsoDate(REF)).toBe('2026-08-10');
	});
});

describe('parseCaptureWith, on empty input', () => {
	it.each([
		{ label: 'an empty string', input: '' },
		{ label: 'only spaces', input: '   ' },
		{ label: 'mixed whitespace', input: ' \t\n ' }
	])('returns a blank result for $label while preserving raw exactly', ({ input }) => {
		expect(parse(input)).toEqual({
			raw: input,
			title: '',
			date: null,
			matched: null
		} satisfies CapturedText);
	});
});

describe('parseCaptureWith, on a relative date phrase', () => {
	it('reads "tomorrow" as the day after the reference date and lifts it out of the title', () => {
		const result = parse('Call the bank tomorrow');

		expect(result.raw).toBe('Call the bank tomorrow');
		expect(result.title).toBe('Call the bank');
		expect(result.date).toBe(toIsoDate(new Date(2026, 7, 11)));
		expect(result.matched).not.toBeNull();
		expect(result.matched?.toLowerCase()).toContain('tomorrow');
	});

	it('resolves "tomorrow" relative to the caller-supplied reference, not the system clock', () => {
		const winterRef = new Date(2026, 0, 31, 20, 30);
		const result = parse('Renew the licence tomorrow', winterRef);

		expect(result.title).toBe('Renew the licence');
		expect(result.date).toBe(toIsoDate(new Date(2026, 1, 1)));
	});

	it('accepts the reference as epoch milliseconds as well as a Date', () => {
		expect(parse('Call the bank tomorrow', REF.getTime())).toEqual(
			parse('Call the bank tomorrow', REF)
		);
	});
});

describe('parseCaptureWith, conservatism about bare numbers', () => {
	// The headline contract: a number that is not a calendar component must never turn
	// a task into a dated one. "Buy 5 apples" is not a 5 o'clock appointment.
	it.each([
		{ input: 'Buy 5 apples' },
		{ input: 'Read chapter 3' },
		{ input: 'Pay invoice 42' },
		{ input: 'Chapter 3' },
		{ input: 'Order 12 eggs' },
		{ input: 'Meeting at 3' },
		{ input: 'Call at 5pm' },
		{ input: 'chapter 3 of the book' }
	])('leaves $input undated, with the title untouched', ({ input }) => {
		const result = parse(input);

		expect(result.date).toBeNull();
		expect(result.matched).toBeNull();
		expect(result.title).toBe(input);
		expect(result.raw).toBe(input);
	});

	it('still dates a numbered task when a real calendar word is also present', () => {
		const result = parse('Pay invoice 42 on Friday');

		expect(result.title).toBe('Pay invoice 42');
		expect(localDateOf(result).getDay()).toBe(5);
	});
});

describe('parseCaptureWith, on an explicit calendar date', () => {
	it('parses "Dentist on 3 March" to a 3 March date and strips the trailing " on "', () => {
		const result = parse('Dentist on 3 March');
		const date = localDateOf(result);

		expect(result.title).toBe('Dentist');
		expect(result.title).not.toMatch(/\bon\b/i);
		expect(date.getMonth()).toBe(2);
		expect(date.getDate()).toBe(3);
		// forwardDate: March has already passed in the reference year, so it rolls forward.
		expect(date.getTime()).toBeGreaterThan(REF_DAY.getTime());
	});

	it('keeps the matched phrase as a verbatim substring of the input', () => {
		const input = 'Dentist on 3 March';
		const result = parse(input);

		expect(result.matched).not.toBeNull();
		expect(input).toContain(result.matched ?? '');
	});
});

describe('parseCaptureWith, forwardDate for bare weekday names', () => {
	it.each([
		{ weekday: 'monday', index: 1 },
		{ weekday: 'tuesday', index: 2 },
		{ weekday: 'wednesday', index: 3 },
		{ weekday: 'thursday', index: 4 },
		{ weekday: 'friday', index: 5 },
		{ weekday: 'saturday', index: 6 },
		{ weekday: 'sunday', index: 0 }
	])('resolves "$weekday" to the next such day, never a past one', ({ weekday, index }) => {
		const result = parse(`Standup ${weekday}`);
		const date = localDateOf(result);

		expect(result.title).toBe('Standup');
		expect(date.getTime()).toBeGreaterThanOrEqual(REF_DAY.getTime());
		expect(date.getDay()).toBe(index);
		expect(toIsoDate(date)).toBe(toIsoDate(nextOccurrence(REF_DAY, index)));
	});

	it('resolves a weekday that has already passed this week to next week, not backwards', () => {
		// Reference is a Monday, so "sunday" must mean the coming Sunday.
		const result = parse('Roast dinner sunday');
		const date = localDateOf(result);

		expect(date.getTime()).toBeGreaterThan(REF_DAY.getTime());
		expect(toIsoDate(date)).toBe(toIsoDate(new Date(2026, 7, 16)));
	});
});

describe('parseCaptureWith, when the date phrase is the entire input', () => {
	it.each([
		{ input: 'tomorrow' },
		{ input: 'Tomorrow' },
		{ input: 'friday' },
		{ input: '3 March' },
		{ input: '  tomorrow  ' }
	])('never leaves the title blank for $input', ({ input }) => {
		const result = parse(input);

		expect(isoDateOf(result)).toMatch(ISO_DATE);
		expect(result.title.length).toBeGreaterThan(0);
		expect(result.title).toBe(input.trim());
	});
});

describe('parseCaptureWith, invariants across the whole corpus', () => {
	it.each(CORPUS.map((input) => ({ input })))(
		'preserves raw byte-for-byte for $input',
		({ input }) => {
			expect(parse(input).raw).toBe(input);
		}
	);

	it.each(CORPUS.map((input) => ({ input })))(
		'produces a tidy title with no dangling preposition for $input',
		({ input }) => {
			const { title } = parse(input);

			expect(title).toBe(title.trim());
			expect(title).not.toMatch(/\s{2,}/);
			expect(title).not.toMatch(DANGLING_PREPOSITION);
		}
	);

	it.each(CORPUS.map((input) => ({ input })))(
		'emits either null or a parseIsoDate-compatible yyyy-MM-dd for $input',
		({ input }) => {
			const result = parse(input);

			if (result.date === null) {
				expect(result.matched).toBeNull();
				return;
			}

			expect(result.date).toMatch(ISO_DATE);
			expect(parseIsoDate(result.date)).not.toBeNull();
			expect(toIsoDate(localDateOf(result))).toBe(result.date);
			expect(result.matched).not.toBeNull();
		}
	);
});

describe('parseCaptureWith, determinism', () => {
	it.each(CORPUS.map((input) => ({ input })))(
		'returns deep-equal output when $input is parsed twice against the same reference',
		({ input }) => {
			expect(parse(input, new Date(REF.getTime()))).toEqual(parse(input, new Date(REF.getTime())));
		}
	);

	it('does not mutate the reference date it was handed', () => {
		const reference = new Date(REF.getTime());
		parse('Dentist on 3 March', reference);

		expect(reference.getTime()).toBe(REF.getTime());
	});
});

describe('parseCaptureWith, hyphenated words that end in a preposition-like token', () => {
	// `tidy` only claims to drop a preposition "left where the date phrase used to be".
	// A hyphenated word is a single token, not a dangling preposition, so it must survive.
	it.each([
		{ input: 'Fix the add-on', expected: 'Fix the add-on' },
		{ input: 'On-call rota', expected: 'On-call rota' }
	])('keeps $input intact in the title', ({ input, expected }) => {
		const result = parse(input);

		expect(result.date).toBeNull();
		expect(result.title).toBe(expected);
	});
});

describe('loadChrono', () => {
	it('resolves to a usable chrono module', async () => {
		const loaded = await loadChrono();

		expect(typeof loaded.parse).toBe('function');
		expect(typeof loaded.parseDate).toBe('function');
	});

	it('is memoised: repeated calls hand back the identical promise and module', async () => {
		const first = loadChrono();
		const second = loadChrono();

		expect(second).toBe(first);
		expect(await second).toBe(await first);
	});
});

describe('parseCapture', () => {
	it('matches parseCaptureWith when given the dynamically imported module', async () => {
		const viaWrapper = await parseCapture('Call the bank tomorrow', REF);

		expect(viaWrapper).toEqual(parse('Call the bank tomorrow'));
	});

	it('threads a numeric reference through to the parser', async () => {
		const viaWrapper = await parseCapture('Dentist on 3 March', REF.getTime());

		expect(viaWrapper.title).toBe('Dentist');
		expect(localDateOf(viaWrapper).getMonth()).toBe(2);
	});
});
