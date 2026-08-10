/// <reference types="@sveltejs/kit" />
/// <reference types="vite-plugin-pwa/svelte" />
/// <reference types="vite-plugin-pwa/info" />

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Navigator {
		/**
		 * Present on iOS Safari only. `true` when the page is running from the Home
		 * Screen, which is the state that exempts it from Intelligent Tracking
		 * Prevention's seven-day storage eviction timer.
		 */
		standalone?: boolean;
	}
}

export {};
