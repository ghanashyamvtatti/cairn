/**
 * Every route is prerendered to a static HTML file and rendered entirely on the client.
 *
 * `prerender` gives each route its own file, so Workbox precaches them by name and a
 * deep link like `/inbox` opens offline from a cold start with no SPA fallback rewrite.
 * `ssr: false` is not a performance choice — all data lives in IndexedDB, so there is
 * nothing a server could render, and turning it off guarantees Dexie can never be
 * reached from a Node context during the build.
 */
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'never';
