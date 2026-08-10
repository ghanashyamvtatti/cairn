<script lang="ts">
	import { useRegisterSW } from 'virtual:pwa-register/svelte';

	/**
	 * Update prompt for the service worker.
	 *
	 * Deliberately a prompt rather than an automatic reload. `registerType: 'prompt'`
	 * means a new build waits until you say so — an auto-reload that fires while you are
	 * halfway through a brain dump would throw the text away, and losing a captured
	 * thought is the worst thing a capture tool can do.
	 */
	const { needRefresh, updateServiceWorker } = useRegisterSW({
		onRegisteredSW(url, registration) {
			// Check hourly while the tab is open. Installed PWAs can stay open for days.
			if (!registration) return;
			setInterval(() => void registration.update(), 60 * 60 * 1000);
		}
	});

	/**
	 * Accepts the update and reloads.
	 *
	 * `updateServiceWorker(true)` attaches its reload to `controllerchange` from inside
	 * this tab, so only the tab that agreed reloads itself. Other open tabs keep running
	 * the build they loaded with and pick the new one up on their next navigation.
	 */
	function reloadThisTab() {
		void updateServiceWorker(true);
	}

	function dismiss() {
		needRefresh.set(false);
	}
</script>

{#if $needRefresh}
	<div class="prompt" role="status" data-testid="reload-prompt">
		<p>A new version of Cairn is ready.</p>
		<div class="actions">
			<button type="button" class="btn btn-sm" onclick={dismiss}>Later</button>
			<button type="button" class="btn btn-sm btn-primary" onclick={reloadThisTab}> Reload </button>
		</div>
	</div>
{/if}

<style>
	.prompt {
		position: fixed;
		inset-inline: var(--space-4);
		bottom: calc(env(safe-area-inset-bottom) + 5rem);
		z-index: 60;
		margin-inline: auto;
		width: min(26rem, calc(100vw - 2rem));
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--stone-surface);
		border: 1px solid var(--stone-border-strong);
		border-radius: var(--radius);
		box-shadow: var(--stone-shadow);
		font-size: var(--text-sm);
	}

	@media (min-width: 48rem) {
		.prompt {
			bottom: var(--space-5);
		}
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
	}
</style>
