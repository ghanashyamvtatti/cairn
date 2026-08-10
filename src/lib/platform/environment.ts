/**
 * Platform capability detection.
 *
 * Everything here is a progressive enhancement check. The app must work identically
 * with all of it returning `false` — these functions only decide which of two pieces of
 * *guidance* to show, never whether a feature works.
 */

export function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof navigator !== 'undefined';
}

/** Running from the Home Screen / app window rather than a browser tab. */
export function isStandalone(): boolean {
	if (!isBrowser()) return false;
	// `navigator.standalone` is the iOS-only signal; the media query covers everyone else.
	return (
		navigator.standalone === true ||
		window.matchMedia('(display-mode: standalone)').matches ||
		window.matchMedia('(display-mode: window-controls-overlay)').matches
	);
}

/**
 * iOS or iPadOS.
 *
 * iPadOS 13+ reports a desktop Mac user agent, so the only reliable signal is
 * "claims to be a Mac, but has a touchscreen" — a real Mac reports `maxTouchPoints` of 0.
 * The engine check matters: desktop Chrome with device emulation switched on also reports
 * `MacIntel` with touch points, and this predicate gates a warning that says the
 * browser will delete your data in seven days. That is worth being right about, and every
 * browser on iOS is WebKit underneath.
 */
export function isIos(): boolean {
	if (!isBrowser()) return false;
	const ua = navigator.userAgent;
	if (/iPad|iPhone|iPod/.test(ua)) return true;

	const looksLikeATouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
	const isWebKit = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
	return looksLikeATouchMac && isWebKit;
}

export type PersistenceState = 'persisted' | 'transient' | 'unsupported';

export async function persistenceState(): Promise<PersistenceState> {
	if (!isBrowser() || !navigator.storage?.persisted) return 'unsupported';
	try {
		return (await navigator.storage.persisted()) ? 'persisted' : 'transient';
	} catch {
		return 'unsupported';
	}
}

/**
 * Asks the browser not to evict this origin's storage under pressure.
 *
 * Chrome grants this silently based on engagement heuristics; Firefox prompts; Safari
 * 17+ supports the API but grants it sparingly. A `false` result is normal and not an
 * error — it is why export/import exists.
 */
export async function requestPersistence(): Promise<boolean> {
	if (!isBrowser() || !navigator.storage?.persist) return false;
	try {
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export interface StorageEstimate {
	usage: number;
	quota: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
	if (!isBrowser() || !navigator.storage?.estimate) return null;
	try {
		const { usage, quota } = await navigator.storage.estimate();
		if (usage === undefined || quota === undefined) return null;
		return { usage, quota };
	} catch {
		return null;
	}
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
