<script lang="ts">
	import { account } from '$lib/stores/account.svelte';
	import Icon from './Icon.svelte';

	/**
	 * A quiet statement of whether what you are looking at is current.
	 *
	 * Deliberately silent when everything is fine. Once data lives on a server, the only
	 * states worth a pixel are the ones where the screen might not match reality — and a
	 * spinner that appears on every keystroke would be exactly the kind of nervous
	 * interface this app is trying not to be.
	 */
	const shown = $derived.by(() => {
		if (!account.online) {
			return {
				icon: 'offline' as const,
				label: 'Offline',
				title:
					account.pending > 0
						? `Offline. ${account.pending} captured ${account.pending === 1 ? 'thought is' : 'thoughts are'} waiting to sync.`
						: 'Offline. You can still read everything and capture new thoughts.',
				tone: 'quiet' as const
			};
		}

		if (account.status.state === 'queued') {
			return {
				icon: 'upload' as const,
				label: `${account.pending} waiting`,
				title: 'Captured while offline. These will sync shortly.',
				tone: 'quiet' as const
			};
		}

		if (account.status.state === 'error') {
			return {
				icon: 'info' as const,
				label: 'Not synced',
				title: account.status.message,
				tone: 'attention' as const
			};
		}

		return null;
	});
</script>

{#if shown}
	<span
		class="status"
		class:attention={shown.tone === 'attention'}
		title={shown.title}
		role="status"
		data-testid="sync-status"
		data-state={account.status.state}
	>
		<Icon name={shown.icon} size={16} />
		<span class="label">{shown.label}</span>
	</span>
{/if}

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--stone-text-muted);
		padding: 0.1875rem 0.5rem;
		border-radius: 999px;
		background: var(--stone-sunken);
		white-space: nowrap;
	}

	.status.attention {
		color: var(--stone-attention);
		background: var(--stone-attention-soft);
	}

	.label {
		display: none;
	}

	@media (min-width: 48rem) {
		.label {
			display: inline;
		}
	}
</style>
