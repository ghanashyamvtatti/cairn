import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		}),
		SvelteKitPWA({
			// The update prompt is explicit rather than automatic: a reload that swallows a
			// half-typed capture is exactly the kind of small betrayal this app is trying
			// not to commit.
			registerType: 'prompt',
			injectRegister: null,
			manifestFilename: 'manifest.webmanifest',
			manifest: {
				name: 'Cairn',
				short_name: 'Cairn',
				description:
					'Three projects. One next action each. A board of hard deadlines. A place to dump your brain.',
				lang: 'en',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				background_color: '#faf9f7',
				theme_color: '#faf9f7',
				categories: ['productivity'],
				icons: [
					{ src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
					{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
					{
						src: 'maskable-icon-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				// Every route is prerendered to its own HTML file, so each is precached by
				// name and deep links work offline on a cold load. The fallback only handles
				// URLs that were never built.
				navigateFallback: '/',
				navigateFallbackDenylist: [/^\/_app\/version\.json$/],
				globPatterns: [
					'client/**/*.{js,css,ico,png,svg,webp,woff,woff2,webmanifest}',
					'prerendered/**/*.{html,json}'
				],
				// Belt and braces alongside `includeVersionFile: false`.
				globIgnores: ['server/**', '**/version.json'],
				cleanupOutdatedCaches: true,
				/*
				 * Required, and load-bearing: without it the first page load is not controlled
				 * by the service worker at all, so installing and immediately going offline
				 * gives a blank app. Turning it off to keep other tabs from reloading on an
				 * update trades a verified offline guarantee for an unverified annoyance.
				 */
				clientsClaim: true,
				runtimeCaching: [
					{
						// SvelteKit polls this to detect a new deployment. Serving it from cache
						// would mean the app could never notice it is out of date.
						urlPattern: /\/_app\/version\.json$/,
						handler: 'NetworkOnly'
					}
				]
			},
			kit: {
				/*
				 * Deliberately false. Precaching `_app/version.json` puts it behind a
				 * precache route that wins over the `NetworkOnly` rule below, so the app
				 * would keep reading the version it shipped with and could never notice a
				 * new deployment.
				 */
				includeVersionFile: false
			},
			devOptions: {
				enabled: false,
				type: 'module',
				navigateFallback: '/'
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		/*
		 * The same suite runs under three fixed timezones.
		 *
		 * Countdown and week-reset bugs are nearly always latent UTC-offset bugs: logic
		 * that is correct in UTC and in whole-hour offsets can still be a day out across a
		 * DST boundary or in a 45-minute zone. Chatham is +12:45/+13:45 and observes DST,
		 * which makes it the most hostile realistic case; Los Angeles catches the
		 * behind-UTC direction that London and Chatham both miss.
		 */
		projects: (
			[
				['london', 'Europe/London'],
				['los-angeles', 'America/Los_Angeles'],
				['chatham', 'Pacific/Chatham']
			] as const
		).map(([name, tz]) => ({
			extends: './vite.config.ts' as const,
			test: {
				name: `unit:${name}`,
				environment: 'node',
				env: { TZ: tz },
				include: ['src/**/*.{test,spec}.{js,ts}'],
				exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
			}
		}))
	}
});
