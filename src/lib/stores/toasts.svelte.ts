import { newId } from '$lib/domain/ids';

export type ToastTone = 'neutral' | 'attention';

export interface Toast {
	id: string;
	message: string;
	tone: ToastTone;
	/** Optional single action, e.g. "Undo". */
	action?: { label: string; run: () => void };
}

const DEFAULT_MS = 5000;

/**
 * Transient confirmations.
 *
 * These are also the app's undo surface. Destructive actions here are soft deletes, so
 * an "Undo" affordance on a toast is cheap and removes the need for a confirmation
 * dialog on every small action — a dialog you have to dismiss is friction; a toast you
 * can ignore is not.
 */
class Toaster {
	items = $state<Toast[]>([]);

	show(message: string, options: { tone?: ToastTone; action?: Toast['action']; ms?: number } = {}) {
		const toast: Toast = {
			id: newId(),
			message,
			tone: options.tone ?? 'neutral',
			action: options.action
		};

		this.items = [...this.items, toast];

		const ms = options.ms ?? DEFAULT_MS;
		setTimeout(() => this.dismiss(toast.id), ms);

		return toast.id;
	}

	dismiss(id: string) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toaster();
