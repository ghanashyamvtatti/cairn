import { TOUR_STEPS, clampStepIndex, type TourStep } from '$lib/domain/tour';

/**
 * State for the guided tour.
 *
 * Kept out of the component so the app's global keyboard handler can ask whether a tour
 * is running — single-letter shortcuts must not fire underneath it, or pressing `c` to
 * read the next step would open the capture dialog on top of the tour.
 */
class TourStore {
	active = $state(false);
	index = $state(0);

	step = $derived<TourStep | null>(this.active ? (TOUR_STEPS[this.index] ?? null) : null);
	isFirst = $derived(this.index === 0);
	isLast = $derived(this.index === TOUR_STEPS.length - 1);
	total = TOUR_STEPS.length;

	/** Called when the tour finishes or is dismissed, so onboarding can be recorded. */
	onfinish: (() => void) | null = null;

	start(at = 0) {
		this.index = clampStepIndex(at);
		this.active = true;
	}

	next() {
		if (this.isLast) this.end();
		else this.index += 1;
	}

	back() {
		if (!this.isFirst) this.index -= 1;
	}

	end() {
		if (!this.active) return;
		this.active = false;
		this.index = 0;
		this.onfinish?.();
	}
}

export const tour = new TourStore();
