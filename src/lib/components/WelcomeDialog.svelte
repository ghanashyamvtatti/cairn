<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { seedExample } from '$lib/onboarding/seed';
	import { fireAndForget } from '$lib/stores/actions';
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { tour } from '$lib/stores/tour.svelte';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';

	/**
	 * Shown once, on a genuinely empty database.
	 *
	 * Cairn's shape is not guessable from an empty screen: four surfaces with unfamiliar
	 * names and a weekly rhythm connecting them. Rather than explain all of it here, this
	 * says the least that makes the rest legible and then offers three honest ways in —
	 * be shown, be given something to look at, or be left alone.
	 */
	interface Props {
		open: boolean;
		onclose: () => void;
	}

	let { open = $bindable(), onclose }: Props = $props();
	let busy = $state(false);

	/**
	 * On by default, because the tour is much weaker against an empty screen — "one next
	 * action each" pointing at nothing teaches very little. Opt-in rather than silent:
	 * creating data on someone's behalf without saying so is not a good first impression.
	 */
	let withExample = $state(true);

	function finish() {
		/*
		 * Closes first, records afterwards.
		 *
		 * Recording first was right when this was a local write. It is wrong now that
		 * settings sync: `setSetting` is a network call, and awaiting it means a dropped
		 * connection leaves a modal dialog on screen with no way past it — and because it
		 * is modal, the rest of the app is inert behind it. The worst case for closing
		 * first is being greeted once more on a later visit.
		 */
		open = false;
		onclose();
		fireAndForget(app.repository.setSetting('onboardedAt', Date.now()));
	}

	async function takeTour() {
		if (busy) return;
		busy = true;
		try {
			if (withExample) {
				await seedExample(app.repository);
				toasts.show('Added an example week. Delete any of it whenever you like.', { ms: 9000 });
			}
			finish();
			await goto(resolve('/'));
			tour.start();
		} finally {
			busy = false;
		}
	}

	async function readGuide() {
		finish();
		await goto(resolve('/guide'));
	}
</script>

<Dialog bind:open title="Welcome to Cairn" onclose={finish}>
	<p>
		Cairn keeps a small number of things moving and stays quiet about the rest. There are four
		places, and they connect in a loop:
	</p>

	<ul class="pillars">
		<li>
			<Icon name="projects" size={16} />
			<div>
				<strong>Projects</strong> — three at a time, each with
				<em>one</em> next action.
			</div>
		</li>
		<li>
			<Icon name="manifest" size={16} />
			<div>
				<strong>Manifest</strong> — a board of fixed dates counting down. Not tasks; you cannot tick them
				off.
			</div>
		</li>
		<li>
			<Icon name="inbox" size={16} />
			<div>
				<strong>Inbox</strong> — somewhere to dump a thought in a second and sort it later.
			</div>
		</li>
		<li>
			<Icon name="review" size={16} />
			<div>
				<strong>Review</strong> — fifteen minutes once a week to reset. Nothing ever goes overdue.
			</div>
		</li>
	</ul>

	<p class="small muted">
		Your work syncs to your other devices, and a copy stays in this browser so the app opens
		instantly and keeps working offline.
	</p>

	<label class="example">
		<input type="checkbox" bind:checked={withExample} data-testid="welcome-example" />
		<span>
			Fill it with an example week first
			<span class="faint"
				>— made-up admin you can delete in a click. Easier than an empty screen.</span
			>
		</span>
	</label>

	{#snippet footer()}
		<button type="button" class="btn btn-sm btn-quiet" onclick={finish} data-testid="welcome-skip">
			I will explore
		</button>
		<button type="button" class="btn btn-sm" onclick={readGuide} data-testid="welcome-guide">
			Read the guide
		</button>
		<button
			type="button"
			class="btn btn-sm btn-primary"
			onclick={takeTour}
			disabled={busy}
			data-testid="welcome-tour"
		>
			Show me around
		</button>
	{/snippet}
</Dialog>

<style>
	.pillars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.pillars li {
		display: flex;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
	}

	.pillars :global(svg) {
		flex-shrink: 0;
		margin-top: 0.1875rem;
		color: var(--stone-text-faint);
	}

	.pillars strong {
		font-weight: 600;
		color: var(--stone-text);
	}

	.example {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
		padding: var(--space-3);
		border: 1px solid var(--stone-border);
		border-radius: var(--radius);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.example input {
		margin-top: 0.1875rem;
		accent-color: var(--stone-accent);
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}
</style>
