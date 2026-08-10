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

	private timers = new Map<string, { handle: ReturnType<typeof setTimeout>; ms: number }>();

	show(message: string, options: { tone?: ToastTone; action?: Toast['action']; ms?: number } = {}) {
		const toast: Toast = {
			id: newId(),
			message,
			tone: options.tone ?? 'neutral',
			action: options.action
		};

		this.items = [...this.items, toast];
		this.arm(toast.id, options.ms ?? DEFAULT_MS);

		return toast.id;
	}

	private arm(id: string, ms: number) {
		const existing = this.timers.get(id);
		if (existing) clearTimeout(existing.handle);
		this.timers.set(id, { handle: setTimeout(() => this.dismiss(id), ms), ms });
	}

	/**
	 * Stops the countdown while a toast is hovered or focused.
	 *
	 * Undo lives only on the toast, and a five-second window that keeps running while you
	 * are reaching for it — or tabbing towards it — is not a real undo. WCAG 2.2.1 asks
	 * for a way to pause a time limit; this is that, without a setting.
	 */
	hold(id: string) {
		const timer = this.timers.get(id);
		if (!timer) return;
		clearTimeout(timer.handle);
	}

	/** Restarts the full window when the pointer or focus leaves. */
	release(id: string) {
		const timer = this.timers.get(id);
		if (!timer) return;
		this.arm(id, timer.ms);
	}

	dismiss(id: string) {
		const timer = this.timers.get(id);
		if (timer) clearTimeout(timer.handle);
		this.timers.delete(id);
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toaster();
