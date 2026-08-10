import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/**
 * Generates the icon set from a single source SVG.
 *
 * Run with `npm run icons`. Output lands in `static/` so the files are committed and
 * the production build never depends on a rasteriser being installed.
 */
export default defineConfig({
	headLinkOptions: { preset: '2023' },
	preset: minimal2023Preset,
	images: ['assets/icon.svg']
});
