/**
 * The app's routes, as a typed union.
 *
 * Kept free of any `$app` import so pure domain modules can reference the type without
 * dragging SvelteKit runtime into a unit test. Components pair these with `resolve()`
 * from `$app/paths`, which is what keeps every link correct if a base path is ever
 * configured.
 *
 * `/` is Today — the one screen that answers "what should I do right now". `/manifest`
 * keeps its path for old bookmarks and precache entries, but every label calls it
 * "Dates".
 */
export const ROUTES = {
	home: '/',
	projects: '/projects',
	manifest: '/manifest',
	inbox: '/inbox',
	review: '/review',
	settings: '/settings',
	guide: '/guide'
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
