import {
	estimateStorage,
	isIos,
	isStandalone,
	persistenceState,
	requestPersistence,
	type PersistenceState,
	type StorageEstimate
} from '$lib/platform/environment';

/** Chrome's install prompt event. Not in lib.dom yet. */
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Do not re-ask about installing or persistence for a month after a dismissal. */
export const NUDGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
/** Nudge about exporting once a fortnight has passed since the last backup. */
export const EXPORT_REMINDER_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Platform state.
 *
 * The reason any of this exists: Safari's Intelligent Tracking Prevention deletes
 * script-created storage — IndexedDB included — after seven days without interaction.
 * Web apps added to the Home Screen are not part of Safari and keep their own counter,
 * which exempts them. So on iOS the install nudge is not a growth prompt; it is the
 * data-durability feature, and it is worded that way.
 */
class PlatformStore {
	installed = $state(false);
	ios = $state(false);
	online = $state(true);
	persistence = $state<PersistenceState>('unsupported');
	estimate = $state<StorageEstimate | null>(null);

	/** Set when Chrome offers a real install prompt. Absent on Safari by design. */
	private deferredPrompt: BeforeInstallPromptEvent | null = null;
	canPromptInstall = $state(false);

	/** iOS, in a tab, where storage is on ITP's seven-day timer. */
	atEvictionRisk = $derived(this.ios && !this.installed);

	start(): void {
		if (typeof window === 'undefined') return;

		this.ios = isIos();
		this.installed = isStandalone();
		this.online = navigator.onLine;

		window.addEventListener('online', this.handleOnline);
		window.addEventListener('offline', this.handleOffline);
		window.addEventListener('beforeinstallprompt', this.handleBeforeInstall);
		window.addEventListener('appinstalled', this.handleInstalled);

		const standaloneQuery = window.matchMedia('(display-mode: standalone)');
		standaloneQuery.addEventListener('change', this.handleDisplayModeChange);

		void this.refresh();
	}

	stop(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('online', this.handleOnline);
		window.removeEventListener('offline', this.handleOffline);
		window.removeEventListener('beforeinstallprompt', this.handleBeforeInstall);
		window.removeEventListener('appinstalled', this.handleInstalled);
	}

	async refresh(): Promise<void> {
		this.persistence = await persistenceState();
		this.estimate = await estimateStorage();
	}

	/** Returns whether the browser granted persistence. `false` is a normal outcome. */
	async requestPersistence(): Promise<boolean> {
		const granted = await requestPersistence();
		await this.refresh();
		return granted;
	}

	/**
	 * Shows the browser's install prompt where one exists. Returns `false` on Safari,
	 * where installation is a manual Share → Add to Home Screen and the UI shows
	 * instructions instead.
	 */
	async promptInstall(): Promise<boolean> {
		if (!this.deferredPrompt) return false;
		await this.deferredPrompt.prompt();
		const { outcome } = await this.deferredPrompt.userChoice;
		this.deferredPrompt = null;
		this.canPromptInstall = false;
		return outcome === 'accepted';
	}

	private handleOnline = () => (this.online = true);
	private handleOffline = () => (this.online = false);

	private handleBeforeInstall = (event: Event) => {
		event.preventDefault();
		this.deferredPrompt = event as BeforeInstallPromptEvent;
		this.canPromptInstall = true;
	};

	private handleInstalled = () => {
		this.installed = true;
		this.canPromptInstall = false;
		void this.refresh();
	};

	private handleDisplayModeChange = (event: MediaQueryListEvent) => {
		this.installed = event.matches || isStandalone();
	};
}

export const platform = new PlatformStore();

/** True when a nudge was never dismissed, or was dismissed long enough ago. */
export function nudgeIsDue(dismissedAt: number | null, now: number): boolean {
	if (dismissedAt === null) return true;
	return now - dismissedAt > NUDGE_COOLDOWN_MS;
}

/**
 * Whether to suggest a backup.
 *
 * A `null` last-export means the user has *never* backed up, which is the group with the
 * most to lose — returning false for them, as an earlier version did, meant the only
 * people who ever saw this prompt were the ones already in the habit. Callers gate on
 * there being something worth backing up.
 */
export function exportReminderIsDue(lastExportAt: number | null, now: number): boolean {
	if (lastExportAt === null) return true;
	return now - lastExportAt > EXPORT_REMINDER_MS;
}
