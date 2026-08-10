/**
 * The app's five routes, as a typed union.
 *
 * Kept free of any `$app` import so pure domain modules can reference the type without
 * dragging SvelteKit runtime into a unit test. Components pair these with `resolve()`
 * from `$app/paths`, which is what keeps every link correct if a base path is ever
 * configured.
 */
export const ROUTES = {
	home: '/',
	manifest: '/manifest',
	inbox: '/inbox',
	review: '/review',
	settings: '/settings',
	guide: '/guide'
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
