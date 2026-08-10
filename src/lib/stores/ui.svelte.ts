import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { ROUTES, type AppRoute } from '$lib/routes';

export interface ShortcutDefinition {
	keys: string;
	description: string;
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
	{ keys: 'c', description: 'Capture a thought' },
	{ keys: 'g then p', description: 'Go to projects' },
	{ keys: 'g then m', description: 'Go to the manifest' },
	{ keys: 'g then i', description: 'Go to the inbox' },
	{ keys: 'g then r', description: 'Go to the weekly review' },
	{ keys: 'g then s', description: 'Go to settings' },
	{ keys: '?', description: 'Show this list' },
	{ keys: 'Esc', description: 'Close whatever is open' }
] as const;

const GOTO_TARGETS: Record<string, AppRoute> = {
	p: ROUTES.home,
	h: ROUTES.home,
	m: ROUTES.manifest,
	i: ROUTES.inbox,
	r: ROUTES.review,
	s: ROUTES.settings
};

/**
 * How long a `g` prefix stays armed before it is forgotten.
 *
 * A second and a half rather than a snappier value: someone reaching for a two-key
 * sequence they use once a week is slower than someone who has it in muscle memory, and
 * the cost of waiting slightly too long is only that a stray letter does nothing.
 */
const CHORD_WINDOW_MS = 1500;

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Global UI state and keyboard shortcuts.
 *
 * Single-letter shortcuts with no modifier are only safe because every one of them is
 * suppressed while focus is in a text field — otherwise typing "capture" into the
 * capture box would fire half the app.
 */
class UiStore {
	captureOpen = $state(false);
	shortcutsOpen = $state(false);

	private chordArmedAt = 0;

	openCapture() {
		this.captureOpen = true;
	}

	handleKeydown = (event: KeyboardEvent) => {
		if (event.defaultPrevented) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTypingTarget(event.target)) return;

		const key = event.key;
		const now = Date.now();

		// Second half of a `g …` chord.
		if (this.chordArmedAt > 0 && now - this.chordArmedAt < CHORD_WINDOW_MS) {
			this.chordArmedAt = 0;
			const target = GOTO_TARGETS[key.toLowerCase()];
			if (target) {
				event.preventDefault();
				void goto(resolve(target));
				return;
			}
		}

		if (key === 'g') {
			this.chordArmedAt = now;
			return;
		}

		this.chordArmedAt = 0;

		if (key === 'c') {
			event.preventDefault();
			this.captureOpen = true;
			return;
		}

		if (key === '?') {
			event.preventDefault();
			this.shortcutsOpen = true;
		}
	};
}

export const ui = new UiStore();
