<script lang="ts">
	import '../app.css';
	import { fireAndForget } from '$lib/stores/actions';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import CaptureDialog from '$lib/components/CaptureDialog.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Nav from '$lib/components/Nav.svelte';
	import ReloadPrompt from '$lib/components/ReloadPrompt.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import SignIn from '$lib/components/SignIn.svelte';
	import SyncStatus from '$lib/components/SyncStatus.svelte';
	import Tour from '$lib/components/Tour.svelte';
	import WelcomeDialog from '$lib/components/WelcomeDialog.svelte';
	import { SyncingRepository } from '$lib/repo/syncing-repo';
	import { account } from '$lib/stores/account.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { platform } from '$lib/stores/platform.svelte';
	import { tour } from '$lib/stores/tour.svelte';
	import { SHORTCUTS, ui } from '$lib/stores/ui.svelte';

	let { children } = $props();

	/**
	 * Shown once, and only to someone who has genuinely never used this.
	 *
	 * Gated on `app.ready` so it cannot flash before the setting has been read, and on the
	 * database being empty as well as the flag being unset — a restored backup belongs to
	 * someone who already knows what this is.
	 */
	let welcomeOpen = $state(false);

	/**
	 * Which account has already been greeted this session.
	 *
	 * The effect below has several reactive inputs and re-runs whenever any of them is
	 * reassigned — including to the same value. Without a one-shot guard it reopens a
	 * dialog the user has just dismissed, which is both maddening and, because the dialog
	 * is modal, leaves the page inert underneath.
	 */
	let welcomedAccount: string | null = null;

	$effect(() => {
		/*
		 * `freshAccount` is settled once from the database after the first pull, not read
		 * reactively. Signing in wipes the local cache before refilling it, so any check
		 * against the live snapshot sees an empty app mid-sync and greets someone on their
		 * second device — over data that is still arriving, behind a modal that makes the
		 * page inert.
		 */
		if (!account.signedIn || !account.hydrated || !account.freshAccount) return;
		if (!app.ready) return;

		const id = account.account?.id ?? null;
		if (id === null || welcomedAccount === id) return;
		welcomedAccount = id;
		welcomeOpen = true;
	});

	// Finishing the tour counts as having been shown around.
	tour.onfinish = () => {
		if (app.settings.onboardedAt === null) {
			fireAndForget(app.repository.setSetting('onboardedAt', Date.now()));
		}
	};

	onMount(() => {
		/*
		 * One repository for the whole app: the server decides, IndexedDB remembers.
		 * Everything downstream still talks to `CairnRepository` and cannot tell the
		 * difference, which is exactly what the interface was for.
		 */
		const repo = new SyncingRepository();
		account.attach(repo);

		void app.start(repo).then(() => account.start());
		platform.start();

		return () => {
			app.stop();
			account.stop();
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

{#if !account.resolved}
	<!-- Nothing at all until the session answers. Flashing the sign-in screen at someone
	     who is already signed in is worse than a blank moment. -->
	<div class="booting"></div>
{:else if !account.signedIn}
	<SignIn />
{:else}
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
				<SyncStatus />

				<button
					type="button"
					class="btn btn-sm btn-primary"
					onclick={() => ui.openCapture()}
					data-testid="open-capture"
					data-tour="capture"
				>
					<Icon name="plus" size={16} />
					<span class="capture-label">Capture</span>
				</button>

				<a
					href={resolve('/guide')}
					class="icon-link"
					aria-label="How Cairn works"
					title="How Cairn works"
					data-testid="nav-guide"
				>
					<Icon name="info" size={18} />
				</a>

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
		<CaptureDialog bind:open={ui.captureOpen} onclose={() => (ui.captureOpen = false)} />
		<WelcomeDialog bind:open={welcomeOpen} onclose={() => (welcomeOpen = false)} />
		<Tour />
	</div>
{/if}

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

	{#snippet footer()}
		<a href={resolve('/guide')} class="btn btn-sm" onclick={() => (ui.shortcutsOpen = false)}>
			How Cairn works
		</a>
		<button
			type="button"
			class="btn btn-sm btn-primary"
			onclick={() => {
				ui.shortcutsOpen = false;
				tour.start();
			}}
		>
			Take the tour
		</button>
	{/snippet}
</Dialog>

<Toasts />
<ReloadPrompt />

<style>
	.booting {
		min-height: 100dvh;
	}

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
