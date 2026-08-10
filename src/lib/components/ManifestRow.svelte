<script lang="ts" module>
	/**
	 * Built once for the whole list. Constructing an `Intl.DateTimeFormat` is expensive
	 * enough that doing it per row is noticeable on a long board.
	 */
	const fullDateFormat = new Intl.DateTimeFormat('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
</script>

<script lang="ts">
	import { countdownFor, parseIsoDate } from '$lib/domain/countdown';
	import { fireAndForget } from '$lib/stores/actions';
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { FixedDate } from '$lib/types';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		entry: FixedDate;
	}

	let { entry }: Props = $props();

	const countdown = $derived(countdownFor(entry.date, app.now));
	const parsed = $derived(parseIsoDate(entry.date));
	const weekday = $derived(parsed ? fullDateFormat.format(parsed) : entry.date);

	let editOpen = $state(false);
	let titleDraft = $state('');
	let dateDraft = $state('');
	let noteDraft = $state('');

	function openEdit() {
		titleDraft = entry.title;
		dateDraft = entry.date;
		noteDraft = entry.note ?? '';
		editOpen = true;
	}

	let saveError = $state<string | null>(null);

	async function save() {
		const title = titleDraft.trim();

		// A dead button is worse than a refusal: say which field is the problem.
		if (title === '') {
			saveError = 'Give it a name so you can recognise it on the board.';
			return;
		}
		if (!parseIsoDate(dateDraft)) {
			saveError = 'That date cannot be read. Pick a day between years 1000 and 9999.';
			return;
		}
		saveError = null;

		await app.repository.updateFixedDate(entry.id, {
			title,
			date: dateDraft,
			note: noteDraft.trim()
		});
		editOpen = false;
	}

	async function remove() {
		const { id, title } = entry;
		await app.repository.deleteFixedDate(id);
		editOpen = false;
		toasts.show(`Removed “${title}”.`, {
			action: { label: 'Undo', run: () => fireAndForget(app.repository.restoreFixedDate(id)) }
		});
	}
</script>

<!--
  There is no checkbox here, and there cannot be one: `FixedDate` has no completion
  field and the repository exposes no way to complete one. "A calendar item is not a
  task" is enforced by the schema rather than by hiding a control.
-->
<li class="row" data-tone={countdown?.tone ?? 'far'} data-testid="manifest-row">
	<span class="days numeric" aria-hidden="true">{countdown?.shortLabel ?? '—'}</span>

	<button type="button" class="body" onclick={openEdit}>
		<span class="title">{entry.title}</span>
		<span class="meta">
			<span class="when">{countdown?.label ?? 'Unreadable date'}</span>
			<span class="date">{weekday}</span>
		</span>
		{#if entry.note}
			<span class="note">{entry.note}</span>
		{/if}
	</button>

	<span class="visually-hidden">{countdown?.label ?? entry.date}</span>
</li>

<Dialog bind:open={editOpen} title="Edit date" onclose={() => (editOpen = false)}>
	<div class="field">
		<label for={`title-${entry.id}`}>What is it?</label>
		<input id={`title-${entry.id}`} class="input" bind:value={titleDraft} />
	</div>
	<div class="field">
		<label for={`date-${entry.id}`}>When</label>
		<input id={`date-${entry.id}`} class="input" type="date" bind:value={dateDraft} />
	</div>
	<div class="field">
		<label for={`note-${entry.id}`}>Note (optional)</label>
		<input id={`note-${entry.id}`} class="input" bind:value={noteDraft} />
	</div>

	{#if saveError}
		<p class="save-error small" role="alert" data-testid="manifest-save-error">{saveError}</p>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-danger" onclick={remove} data-testid="manifest-delete">
			<Icon name="trash" size={16} /> Remove
		</button>
		<button type="button" class="btn btn-primary" onclick={save}>Save</button>
	{/snippet}
</Dialog>

<style>
	.row {
		display: flex;
		align-items: stretch;
		gap: var(--space-4);
		border-bottom: 1px solid var(--stone-border);
	}

	.row:last-child {
		border-bottom: none;
	}

	.days {
		flex-shrink: 0;
		width: 3.25rem;
		display: grid;
		place-items: center;
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--stone-text-faint);
	}

	.row[data-tone='today'] .days,
	.row[data-tone='imminent'] .days {
		color: var(--stone-attention);
	}

	.row[data-tone='near'] .days {
		color: var(--stone-text);
	}

	.row[data-tone='passed'] .days {
		color: var(--stone-text-faint);
		font-weight: 400;
	}

	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		background: none;
		border: none;
		padding: var(--space-3) var(--space-2) var(--space-3) 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
		border-radius: var(--radius-sm);
	}

	.body:hover .title {
		color: var(--stone-accent-text);
	}

	.title {
		font-size: var(--text-base);
		font-weight: 500;
	}

	.row[data-tone='passed'] .title {
		color: var(--stone-text-muted);
		font-weight: 400;
	}

	.meta {
		display: flex;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
	}

	.date {
		color: var(--stone-text-faint);
	}

	.date::before {
		content: '·';
		margin-right: var(--space-2);
	}

	.note {
		font-size: var(--text-sm);
		color: var(--stone-text-faint);
		margin-top: var(--space-1);
	}

	.save-error {
		color: var(--stone-attention);
	}
</style>
