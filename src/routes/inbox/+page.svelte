<script lang="ts">
	import { resolve } from '$app/paths';
	import CaptureField from '$lib/components/CaptureField.svelte';
	import InboxItemRow from '$lib/components/InboxItemRow.svelte';
	import { app } from '$lib/stores/app.svelte';

	/**
	 * Capture and triage, in that order, on one screen.
	 *
	 * They are the same page but not the same job: capture is supposed to be thoughtless
	 * and fast, triage is supposed to be considered. Keeping the field pinned at the top
	 * means a thought that arrives mid-triage does not derail the triage.
	 */
	let expandedId = $state<string | null>(null);

	function toggle(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	/** After emptying the inbox, land on the review step that follows. */
	const justEmptied = $derived(app.ready && app.inbox.length === 0);
</script>

<svelte:head>
	<title>Inbox · Cairn</title>
</svelte:head>

<header class="page-head">
	<div>
		<h1>Inbox</h1>
		<p class="muted small">
			Get it out of your head first. Deciding where it goes is a separate job.
		</p>
	</div>
</header>

<div class="capture card">
	<CaptureField autofocus />
</div>

{#if !app.ready}
	<p class="muted">Opening the inbox…</p>
{:else if justEmptied}
	<section class="empty card" data-testid="empty-inbox">
		<h2>Empty</h2>
		<p class="muted">
			Nothing waiting. When something surfaces, press <kbd>c</kbd> anywhere in the app and it lands here.
		</p>
		<div class="empty-actions">
			<a href={resolve('/')} class="btn btn-sm">Back to projects</a>
			<a href={resolve('/review')} class="btn btn-sm">Run the weekly review</a>
		</div>
	</section>
{:else}
	<p class="count muted small" data-testid="inbox-count">
		{app.inbox.length}
		{app.inbox.length === 1 ? 'item' : 'items'} · tap one to sort it
	</p>

	<ul class="list card" data-testid="inbox-list">
		{#each app.inbox as item (item.id)}
			<InboxItemRow {item} expanded={expandedId === item.id} ontoggle={() => toggle(item.id)} />
		{/each}
	</ul>
{/if}

<style>
	.page-head {
		margin-bottom: var(--space-4);
	}

	.capture {
		padding: var(--space-3);
		margin-bottom: var(--space-5);
		position: sticky;
		top: 4rem;
		z-index: 10;
	}

	.count {
		margin-bottom: var(--space-2);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}

	.empty {
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.empty-actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
		flex-wrap: wrap;
	}

	kbd {
		font-family: inherit;
		font-size: var(--text-xs);
		padding: 0.0625rem 0.3125rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--stone-border-strong);
		background: var(--stone-sunken);
	}
</style>
