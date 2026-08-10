/**
 * An injectable clock.
 *
 * Domain functions never call `Date.now()` directly. Countdown and week-reset logic
 * are precisely the code whose correctness depends on *when* it runs — across
 * midnight, across a DST transition, across a year boundary — so the current time is
 * an argument, not an ambient global. Tests pass a fixed clock; the app passes
 * `systemClock`.
 */
export interface Clock {
	/** Current time as epoch milliseconds. */
	now(): number;
}

export const systemClock: Clock = {
	now: () => Date.now()
};

/** A clock frozen at a given instant. Useful in tests and for a single render pass. */
export function fixedClock(at: number | Date): Clock {
	const ms = at instanceof Date ? at.getTime() : at;
	return { now: () => ms };
}
