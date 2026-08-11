/// <reference types="@sveltejs/kit" />
/// <reference types="vite-plugin-pwa/svelte" />
/// <reference types="vite-plugin-pwa/info" />

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** Set by hooks.server.ts when the request carries a valid session cookie. */
			account: { id: string; email: string } | null;
		}

		interface Platform {
			env: {
				/**
				 * Imported inline rather than via a global `/// <reference>`: referencing
				 * `@cloudflare/workers-types` globally replaces the DOM lib, and the client
				 * code then loses `document`, `HTMLElement` and the rest.
				 */
				DB: import('@cloudflare/workers-types').D1Database;
			};
		}
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
