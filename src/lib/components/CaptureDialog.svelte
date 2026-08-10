<script lang="ts">
	import CaptureField from './CaptureField.svelte';
	import Dialog from './Dialog.svelte';

	interface Props {
		open: boolean;
		onclose: () => void;
	}

	let { open = $bindable(), onclose }: Props = $props();

	/**
	 * Recently captured items stay listed while the dialog is open.
	 *
	 * The brain dump is a burst activity — you empty your head in one go — so the field
	 * clears and keeps focus after each Enter rather than closing. Showing what has
	 * already landed is what makes it safe to keep typing without checking.
	 */
	let justAdded = $state<string[]>([]);

	$effect(() => {
		if (!open) justAdded = [];
	});
</script>

<Dialog
	bind:open
	title="Capture"
	description="One thought per line. Press Enter to add another; Escape when your head is empty."
	{onclose}
>
	<CaptureField focusWhen={open} oncaptured={(text) => (justAdded = [text, ...justAdded])} />

	{#if justAdded.length > 0}
		<ul class="added" aria-live="polite" data-testid="capture-added">
			{#each justAdded as text, index (index)}
				<li>{text}</li>
			{/each}
		</ul>
		<p class="count small faint">
			{justAdded.length} in the inbox. Sort them later — that is the point.
		</p>
	{/if}
</Dialog>

<style>
	.added {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 12rem;
		overflow-y: auto;
	}

	.added li {
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--stone-border);
	}

	.added li:last-child {
		border-bottom: none;
	}

	.count {
		margin-top: var(--space-1);
	}
</style>
