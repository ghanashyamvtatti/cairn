<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A modal built on the native `<dialog>` element.
	 *
	 * `showModal()` gives focus trapping, Escape-to-close, `inert` on the rest of the
	 * page and correct `aria-modal` semantics for free — all of which a hand-rolled
	 * div-with-a-backdrop gets subtly wrong. Everything below is just wiring the
	 * element's state to a prop.
	 */
	interface Props {
		open: boolean;
		title: string;
		/** Description read out with the title; also rendered when provided. */
		description?: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let { open = $bindable(), title, description, onclose, children, footer }: Props = $props();

	let element = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		const dialog = element;
		if (!dialog) return;

		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function handleClose() {
		open = false;
		onclose();
	}

	/**
	 * Clicking the backdrop closes. The backdrop is the dialog element itself — its
	 * children sit inside — so a click whose target *is* the dialog came from outside
	 * the content box.
	 */
	function handleBackdrop(event: MouseEvent) {
		if (event.target === element) handleClose();
	}
</script>

<dialog
	bind:this={element}
	class="dialog"
	aria-label={title}
	onclose={handleClose}
	onclick={handleBackdrop}
>
	<div class="panel">
		<header>
			<h2>{title}</h2>
			<button type="button" class="close" onclick={handleClose} aria-label="Close">
				<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
					<path
						d="M5 5l10 10M15 5L5 15"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						fill="none"
					/>
				</svg>
			</button>
		</header>

		{#if description}
			<p class="description">{description}</p>
		{/if}

		<div class="body">
			{@render children()}
		</div>

		{#if footer}
			<footer>{@render footer()}</footer>
		{/if}
	</div>
</dialog>

<style>
	.dialog {
		border: none;
		padding: 0;
		background: transparent;
		max-width: min(32rem, calc(100vw - 2rem));
		width: 100%;
		max-height: calc(100dvh - 4rem);
		color: var(--stone-text);
	}

	.dialog::backdrop {
		background: var(--stone-overlay);
	}

	.dialog[open] {
		animation: appear var(--duration) var(--ease);
	}

	@keyframes appear {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.panel {
		background: var(--stone-surface);
		border: 1px solid var(--stone-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--stone-shadow);
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	h2 {
		font-size: var(--text-md);
	}

	.description {
		color: var(--stone-text-muted);
		font-size: var(--text-sm);
		margin-top: calc(var(--space-4) * -1 + var(--space-1));
	}

	.close {
		background: none;
		border: none;
		color: var(--stone-text-faint);
		padding: var(--space-1);
		margin: calc(var(--space-1) * -1);
		border-radius: var(--radius-sm);
		cursor: pointer;
		display: grid;
		place-items: center;
	}

	.close:hover {
		color: var(--stone-text);
		background: var(--stone-sunken);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
