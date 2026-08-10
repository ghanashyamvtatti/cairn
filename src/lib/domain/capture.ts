import type { IsoDate } from '$lib/types';
import { toIsoDate } from './countdown';

/**
 * Natural-language date parsing for quick capture.
 *
 * chrono-node is a large dependency relative to the rest of the app, so it is loaded
 * on demand and lands in its own chunk — capture must feel instant on first paint, and
 * the parser is only needed once you have typed something.
 *
 * The parse is deliberately conservative. Capture is supposed to take under a second
 * with no required fields; a parser that silently reinterprets "buy 5 apples" as a
 * 5 o'clock appointment costs far more attention than it saves. So a match is only
 * accepted when chrono is certain about an actual calendar component.
 */

type ChronoModule = typeof import('chrono-node');

let chronoPromise: Promise<ChronoModule> | null = null;
let chronoModule: ChronoModule | null = null;

export function loadChrono(): Promise<ChronoModule> {
	chronoPromise ??= import('chrono-node').then((module) => {
		chronoModule = module;
		return module;
	});
	return chronoPromise;
}

/**
 * The parser if it is already in memory, otherwise `null`.
 *
 * Once the chunk has loaded, parsing is a synchronous millisecond, so submit can take a
 * final look at exactly what was typed without awaiting anything. Without this, whether
 * a date was recognised depended on whether the debounce happened to have fired — a fast
 * typist would silently lose it.
 */
export function loadedChrono(): ChronoModule | null {
	return chronoModule;
}

export interface CapturedText {
	/** Exactly what the user typed. */
	raw: string;
	/** `raw` with the recognised date phrase removed and whitespace tidied. */
	title: string;
	/** The date chrono found, or `null`. */
	date: IsoDate | null;
	/** The substring that produced `date`, for showing "understood as …". */
	matched: string | null;
}

function tidy(value: string): string {
	return (
		value
			.replace(/\s+/g, ' ')
			.replace(/\s+([,.;:!?])/g, '$1')
			/*
			 * Drop a preposition left dangling where the date phrase used to be, so
			 * "Dentist on 3 March" yields "Dentist" rather than "Dentist on".
			 *
			 * The separator must be whitespace. An earlier version allowed `-` here, which
			 * quietly destroyed hyphenated words: "Fix the add-on" became "Fix the add" and
			 * "On-call rota" became "call rota". It also swallowed a title that was itself
			 * just the word "on". A preposition only dangles when it stands alone.
			 */
			.replace(/\s+(on|by|due|at|before)\s*$/i, '')
			.replace(/^(on|by|due|at|before)\s+/i, '')
			.replace(/^[\s,;:.]+|[\s,;:]+$/g, '')
			.trim()
	);
}

/**
 * Pure parser. Takes the chrono module as an argument so tests exercise the real
 * library without the dynamic-import indirection.
 */
export function parseCaptureWith(
	chrono: ChronoModule,
	input: string,
	now: Date | number
): CapturedText {
	const raw = input;
	const reference = now instanceof Date ? now : new Date(now);
	const trimmed = input.trim();

	if (trimmed === '') {
		return { raw, title: '', date: null, matched: null };
	}

	// `forwardDate` resolves bare weekdays and months to the *next* occurrence, which is
	// what someone capturing a task means by "friday" on a Saturday.
	const results = chrono.parse(trimmed, reference, { forwardDate: true });

	const usable = results.find((result) => {
		const start = result.start;
		// Require an explicit calendar component. Without this, chrono's casual parser
		// reads a bare "5" or "at 3" as a time today and every numbered task acquires a
		// spurious date.
		const hasCalendarComponent =
			start.isCertain('day') || start.isCertain('weekday') || start.isCertain('month');
		if (!hasCalendarComponent) return false;
		// A phrase that is the entire input ("tomorrow") is a date, not a task title;
		// still accept it, but anything that matched only punctuation is noise.
		return result.text.trim().length > 0;
	});

	if (!usable) {
		return { raw, title: tidy(trimmed), date: null, matched: null };
	}

	const withoutDate =
		trimmed.slice(0, usable.index) + trimmed.slice(usable.index + usable.text.length);
	const title = tidy(withoutDate);

	return {
		raw,
		// "tomorrow" on its own leaves nothing behind; keep the original so the item is
		// never blank.
		title: title === '' ? tidy(trimmed) : title,
		date: toIsoDate(usable.start.date()),
		matched: usable.text
	};
}

/** Convenience wrapper used by the UI. */
export async function parseCapture(input: string, now: Date | number): Promise<CapturedText> {
	const chrono = await loadChrono();
	return parseCaptureWith(chrono, input, now);
}
