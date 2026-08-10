<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import CaptureDialog from '$lib/components/CaptureDialog.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Nav from '$lib/components/Nav.svelte';
	import ReloadPrompt from '$lib/components/ReloadPrompt.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { platform } from '$lib/stores/platform.svelte';
	import { SHORTCUTS, ui } from '$lib/stores/ui.svelte';

	let { children } = $props();

	onMount(() => {
		void app.start();
		platform.start();

		return () => {
			app.stop();
			platform.stop();
		};
	});

	/**
	 * Mirrors the theme onto the document, and into localStorage for the inline script
	 * in app.html that runs before first paint. IndexedDB stays the source of truth;
	 * localStorage is only a paint hint, so losing it costs nothing.
	 */
	$effect(() => {
		/*
		 * Wait for the first snapshot.
		 *
		 * `app.settings` starts at defaults, so running before IndexedDB answers stripped
		 * the `data-theme` the inline head script had just applied and wrote "system" over
		 * the localStorage hint — undoing the pre-paint work and re-flashing the wrong
		 * theme on every single load.
		 */
		if (!app.ready) return;

		const { theme, motion } = app.settings;
		const root = document.documentElement;

		if (theme === 'system') root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', theme);

		if (motion === 'reduce') root.setAttribute('data-motion', 'reduce');
		else root.removeAttribute('data-motion');

		try {
			localStorage.setItem('cairn.theme', theme);
			localStorage.setItem('cairn.motion', motion);
		} catch {
			// Storage can be blocked entirely; the app still works, it just repaints once.
		}

		const dark =
			theme === 'dark' ||
			(theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', dark ? '#161513' : '#faf9f7');
	});
</script>

<svelte:window onkeydown={ui.handleKeydown} />

<div class="shell">
	<header class="topbar">
		<a href={resolve('/')} class="brand" aria-label="Cairn, home">
			<Icon name="cairn" size={22} />
			<span>Cairn</span>
		</a>

		<div class="desktop-nav">
			<Nav />
		</div>

		<div class="actions">
			{#if !platform.online}
				<span
					class="offline"
					title="You are offline. Everything still works."
					data-testid="offline"
				>
					<Icon name="offline" size={16} />
					<span class="offline-label">Offline</span>
				</span>
			{/if}

			<button
				type="button"
				class="btn btn-sm btn-primary"
				onclick={() => ui.openCapture()}
				data-testid="open-capture"
			>
				<Icon name="plus" size={16} />
				<span class="capture-label">Capture</span>
			</button>

			<a
				href={resolve('/settings')}
				class="icon-link"
				aria-label="Settings"
				data-testid="nav-settings"
			>
				<Icon name="settings" size={18} />
			</a>
		</div>
	</header>

	<main class="content">
		{#if app.error}
			<div class="error card" role="alert" data-testid="app-error">
				<Icon name="info" />
				<div>
					<p>{app.error}</p>
					<p class="small muted">
						Nothing has been lost from any device where Cairn already works. If you have a backup
						file, you can restore it from Settings once storage is available.
					</p>
				</div>
			</div>
		{/if}

		{@render children()}
	</main>

	<div class="tabbar">
		<Nav />
	</div>
</div>

<CaptureDialog bind:open={ui.captureOpen} onclose={() => (ui.captureOpen = false)} />

<Dialog
	bind:open={ui.shortcutsOpen}
	title="Keyboard shortcuts"
	onclose={() => (ui.shortcutsOpen = false)}
>
	<dl class="shortcuts">
		{#each SHORTCUTS as shortcut (shortcut.keys)}
			<dt><kbd>{shortcut.keys}</kbd></dt>
			<dd>{shortcut.description}</dd>
		{/each}
	</dl>
</Dialog>

<Toasts />
<ReloadPrompt />

<style>
	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: color-mix(in srgb, var(--stone-bg) 88%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--stone-border);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--stone-text);
		text-decoration: none;
		font-weight: 600;
		letter-spacing: -0.01em;
		flex-shrink: 0;
	}

	.desktop-nav {
		display: none;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}

	.icon-link {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius);
		color: var(--stone-text-muted);
	}

	.icon-link:hover {
		background: var(--stone-sunken);
		color: var(--stone-text);
	}

	.offline {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--stone-text-muted);
		padding: 0.1875rem 0.5rem;
		border-radius: 999px;
		background: var(--stone-sunken);
	}

	.offline-label {
		display: none;
	}

	.content {
		flex: 1;
		width: 100%;
		max-width: var(--page-max);
		margin-inline: auto;
		padding: var(--space-5) var(--space-4) var(--space-7);
	}

	.error {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-4);
		margin-bottom: var(--space-5);
		border-color: var(--stone-attention);
		background: var(--stone-attention-soft);
		color: var(--stone-text);
	}

	.error :global(svg) {
		flex-shrink: 0;
		color: var(--stone-attention);
		margin-top: 0.125rem;
	}

	.error p + p {
		margin-top: var(--space-2);
	}

	.tabbar {
		position: sticky;
		bottom: 0;
		z-index: 20;
		padding: var(--space-1) var(--space-2) calc(var(--space-1) + env(safe-area-inset-bottom));
		background: color-mix(in srgb, var(--stone-bg) 92%, transparent);
		backdrop-filter: blur(8px);
		border-top: 1px solid var(--stone-border);
	}

	.shortcuts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		align-items: baseline;
	}

	.shortcuts dd {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
	}

	kbd {
		font-family: inherit;
		font-size: var(--text-xs);
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--stone-border-strong);
		background: var(--stone-sunken);
		white-space: nowrap;
	}

	@media (min-width: 48rem) {
		.desktop-nav {
			display: block;
		}

		.tabbar {
			display: none;
		}

		.offline-label,
		.capture-label {
			display: inline;
		}

		.content {
			padding-top: var(--space-6);
		}
	}

	@media (max-width: 47.999rem) {
		.capture-label {
			display: none;
		}
	}
</style>
