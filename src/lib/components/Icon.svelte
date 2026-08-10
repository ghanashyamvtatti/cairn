<script lang="ts" module>
	/**
	 * Inline SVG icons on a 20×20 grid.
	 *
	 * Inline rather than a sprite sheet or an icon font: there are a dozen of them, they
	 * must render offline with zero extra requests, and `currentColor` makes them follow
	 * the theme without any per-icon styling.
	 */
	export type IconName =
		| 'cairn'
		| 'projects'
		| 'manifest'
		| 'inbox'
		| 'review'
		| 'settings'
		| 'plus'
		| 'check'
		| 'circle'
		| 'target'
		| 'park'
		| 'trash'
		| 'download'
		| 'upload'
		| 'offline'
		| 'info'
		| 'chevron';
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: number;
	}

	let { name, size = 20 }: Props = $props();
</script>

<svg
	viewBox="0 0 20 20"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'cairn'}
		<rect x="4" y="14.5" width="12" height="3.2" rx="1.6" fill="currentColor" stroke="none" />
		<rect
			x="5.2"
			y="10.4"
			width="9.6"
			height="3"
			rx="1.5"
			fill="currentColor"
			stroke="none"
			opacity="0.8"
		/>
		<rect
			x="6.6"
			y="6.6"
			width="6.8"
			height="2.8"
			rx="1.4"
			fill="currentColor"
			stroke="none"
			opacity="0.62"
		/>
		<rect
			x="7.8"
			y="3.2"
			width="4.4"
			height="2.4"
			rx="1.2"
			fill="currentColor"
			stroke="none"
			opacity="0.45"
		/>
	{:else if name === 'projects'}
		<rect x="2.75" y="3.75" width="14.5" height="4" rx="1.5" />
		<rect x="2.75" y="12.25" width="14.5" height="4" rx="1.5" />
	{:else if name === 'manifest'}
		<rect x="2.75" y="4.25" width="14.5" height="12" rx="2" />
		<path d="M2.75 8.25h14.5M6.75 2.75v3M13.25 2.75v3" />
	{:else if name === 'inbox'}
		<path d="M2.75 11.5h3.5l1.2 2h5.1l1.2-2h3.5" />
		<path d="M4.6 4.1h10.8l2 7.4v4a1.5 1.5 0 0 1-1.5 1.5H4.1a1.5 1.5 0 0 1-1.5-1.5v-4z" />
	{:else if name === 'review'}
		<circle cx="10" cy="10" r="7.25" />
		<path d="M6.75 10.2l2.2 2.2 4.3-4.6" />
	{:else if name === 'settings'}
		<circle cx="10" cy="10" r="2.6" />
		<path
			d="M10 2.75l1 2.1 2.3-.5 1.2 2-1.4 1.9 1.4 1.9-1.2 2-2.3-.5-1 2.1-1-2.1-2.3.5-1.2-2 1.4-1.9-1.4-1.9 1.2-2 2.3.5z"
		/>
	{:else if name === 'plus'}
		<path d="M10 4.5v11M4.5 10h11" />
	{:else if name === 'check'}
		<path d="M4.5 10.5l3.4 3.4 7.6-8" />
	{:else if name === 'circle'}
		<circle cx="10" cy="10" r="6.75" />
	{:else if name === 'target'}
		<circle cx="10" cy="10" r="6.75" />
		<circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" />
	{:else if name === 'park'}
		<path d="M4.25 6.5h11.5M4.25 10h11.5M4.25 13.5h6" />
	{:else if name === 'trash'}
		<path
			d="M3.75 5.5h12.5M8.25 5.5V3.75h3.5V5.5M5.5 5.5l.7 10a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10"
		/>
	{:else if name === 'download'}
		<path d="M10 3v9.5M6.25 9l3.75 3.75L13.75 9M3.5 16.25h13" />
	{:else if name === 'upload'}
		<path d="M10 13.5V4M6.25 7.75L10 4l3.75 3.75M3.5 16.25h13" />
	{:else if name === 'offline'}
		<path
			d="M3 3l14 14M6.4 9.6a6 6 0 0 1 2.2-1.3M2.9 6.7a10 10 0 0 1 3.4-2.1M13.6 8.3a6 6 0 0 1 1.5 1M17.1 6.7a10 10 0 0 0-3.6-2.2M10 15.6h.01"
		/>
	{:else if name === 'info'}
		<circle cx="10" cy="10" r="7.25" />
		<path d="M10 9v4.5M10 6.6h.01" />
	{:else if name === 'chevron'}
		<path d="M7.5 4.5l5 5.5-5 5.5" />
	{/if}
</svg>
