<script lang="ts">
	import { toasts } from '$lib/stores/toasts.svelte';
</script>

<!--
  `aria-live="polite"` rather than "assertive": these are confirmations, not alerts.
  Interrupting a screen reader mid-sentence to say "Item added" is exactly the kind of
  small rudeness this app is trying to avoid.
-->
<div class="toasts" aria-live="polite" aria-atomic="false" data-testid="toasts">
	{#each toasts.items as toast (toast.id)}
		<div
			class="toast"
			class:attention={toast.tone === 'attention'}
			role="status"
			onmouseenter={() => toasts.hold(toast.id)}
			onmouseleave={() => toasts.release(toast.id)}
			onfocusin={() => toasts.hold(toast.id)}
			onfocusout={() => toasts.release(toast.id)}
		>
			<span>{toast.message}</span>
			{#if toast.action}
				<button
					type="button"
					class="action"
					onclick={() => {
						toast.action?.run();
						toasts.dismiss(toast.id);
					}}
				>
					{toast.action.label}
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(env(safe-area-inset-bottom) + 5rem);
		z-index: 50;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(26rem, calc(100vw - 2rem));
		pointer-events: none;
	}

	@media (min-width: 48rem) {
		.toasts {
			bottom: var(--space-5);
		}
	}

	.toast {
		pointer-events: auto;
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
		animation: rise var(--duration) var(--ease);
	}

	.toast.attention {
		border-color: var(--stone-attention);
		background: var(--stone-attention-soft);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	.action {
		background: none;
		border: none;
		padding: var(--space-1) var(--space-2);
		margin: calc(var(--space-1) * -1) calc(var(--space-2) * -1);
		border-radius: var(--radius-sm);
		color: var(--stone-accent-text);
		font-weight: 500;
		font-size: var(--text-sm);
		cursor: pointer;
		flex-shrink: 0;
	}

	.action:hover {
		background: var(--stone-accent-soft);
	}
</style>
