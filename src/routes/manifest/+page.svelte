<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import ManifestRow from '$lib/components/ManifestRow.svelte';
	import { parseCapture } from '$lib/domain/capture';
	import { countdownFor, parseIsoDate, toIsoDate } from '$lib/domain/countdown';
	import { app } from '$lib/stores/app.svelte';

	/**
	 * The dates board. (The route keeps its historical `/manifest` path; every label
	 * says "Dates" because that is what it holds.)
	 *
	 * Deliberately a separate surface from tasks. A deadline is not something you do —
	 * it is something that arrives whether or not you do anything — and mixing the two
	 * is what produces a list where everything is equally urgent and nothing is real.
	 */

	let title = $state('');
	let date = $state('');
	let note = $state('');
	let showPassed = $state(false);
	let busy = $state(false);

	const preview = $derived(date ? countdownFor(date, app.now) : null);
	const canSubmit = $derived(title.trim() !== '' && parseIsoDate(date) !== null && !busy);

	/**
	 * Typing a date into the title field fills the date picker.
	 *
	 * The picker stays visible and editable rather than being replaced by the parse, so
	 * a wrong guess is obvious before you commit it instead of after.
	 */
	async function tryParseTitle() {
		const raw = title.trim();
		if (raw === '' || date !== '') return;

		try {
			const parsed = await parseCapture(raw, app.now);
			if (parsed.date && date === '') {
				date = parsed.date;
				title = parsed.title;
			}
		} catch {
			// The parser is a convenience; the date picker is the real input.
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;

		busy = true;
		try {
			await app.repository.addFixedDate({ title: title.trim(), date, note: note.trim() });
			title = '';
			date = '';
			note = '';
		} finally {
			busy = false;
		}
	}

	function setToday() {
		date = toIsoDate(new Date(app.now));
	}
</script>

<svelte:head>
	<title>Dates · Cairn</title>
</svelte:head>

<header class="page-head">
	<div>
		<h1>Dates</h1>
		<p class="muted small">
			Renewals, flights, birthdays, deadlines — they arrive whether or not you are ready. Not a
			to-do list.
		</p>
	</div>
</header>

<form class="add card" onsubmit={add}>
	<div class="line">
		<input
			class="input"
			bind:value={title}
			onblur={tryParseTitle}
			placeholder="Passport expires, flight to Lisbon, Mum's birthday…"
			aria-label="What is happening"
			autocomplete="off"
			data-testid="manifest-title"
		/>
		<input
			class="input date"
			type="date"
			bind:value={date}
			aria-label="Date"
			data-testid="manifest-date"
		/>
		<button type="submit" class="btn btn-primary" disabled={!canSubmit} data-testid="manifest-add">
			Add
		</button>
	</div>

	<div class="line secondary">
		<input
			class="input"
			bind:value={note}
			placeholder="Note (optional)"
			aria-label="Note"
			data-testid="manifest-note"
		/>
		<button type="button" class="btn btn-sm btn-quiet" onclick={setToday}>Today</button>
	</div>

	{#if preview}
		<p class="preview small muted" data-testid="manifest-preview">{preview.label}</p>
	{/if}
</form>

{#if !app.ready}
	<p class="muted">Reading the board…</p>
{:else if app.fixedDates.length === 0}
	<section class="empty card" data-testid="empty-manifest" data-tour="manifest-board">
		<h2>The board is clear</h2>
		<p class="muted">
			Put the immovable things here — renewals, flights, birthdays, filing deadlines. Seeing them
			counting down in one place is what stops them turning into a surprise.
		</p>
	</section>
{:else}
	{#if app.manifest.upcoming.length > 0}
		<ul class="board card" data-testid="manifest-upcoming" data-tour="manifest-board">
			{#each app.manifest.upcoming as entry (entry.id)}
				<ManifestRow {entry} />
			{/each}
		</ul>
	{:else if app.manifest.passed.length > 0}
		<p class="muted nothing">Nothing ahead. Everything on the board has passed.</p>
	{:else}
		<p class="muted nothing">Nothing ahead that Cairn can read.</p>
	{/if}

	{#if app.manifest.invalid.length > 0}
		<section class="invalid card">
			<p class="small">
				<Icon name="info" size={14} />
				These entries have a date Cairn cannot read — most likely from an edited backup file. Open one
				to fix its date.
			</p>
			<ul class="board">
				{#each app.manifest.invalid as entry (entry.id)}
					<ManifestRow {entry} />
				{/each}
			</ul>
		</section>
	{/if}

	{#if app.manifest.passed.length > 0}
		<button
			type="button"
			class="disclosure"
			onclick={() => (showPassed = !showPassed)}
			aria-expanded={showPassed}
			data-testid="toggle-passed"
		>
			<span class="chevron" class:open={showPassed}><Icon name="chevron" size={14} /></span>
			{app.manifest.passed.length} passed
		</button>

		{#if showPassed}
			<ul class="board card passed" data-testid="manifest-passed">
				{#each app.manifest.passed as entry (entry.id)}
					<ManifestRow {entry} />
				{/each}
			</ul>
		{/if}
	{/if}
{/if}

<style>
	.page-head {
		margin-bottom: var(--space-5);
	}

	.add {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
	}

	.line {
		display: flex;
		gap: var(--space-2);
	}

	.line .input {
		flex: 1;
		min-width: 0;
	}

	.date {
		flex: 0 0 auto;
		width: auto;
		min-width: 9rem;
	}

	.secondary {
		align-items: center;
	}

	.preview {
		padding-left: var(--space-1);
	}

	.board {
		list-style: none;
		margin: 0;
		padding: 0 var(--space-3) 0 0;
	}

	.board.passed {
		margin-top: var(--space-3);
		opacity: 0.85;
	}

	.disclosure {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: none;
		border: none;
		padding: var(--space-4) 0 0;
		font-size: var(--text-sm);
		color: var(--stone-text-faint);
		cursor: pointer;
	}

	.disclosure:hover {
		color: var(--stone-text-muted);
	}

	.chevron {
		display: grid;
		place-items: center;
		transition: transform var(--duration) var(--ease);
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.empty {
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.nothing {
		padding: var(--space-4) 0;
	}

	.invalid {
		margin-top: var(--space-4);
		padding: var(--space-3);
		border-color: color-mix(in srgb, var(--stone-attention) 40%, transparent);
		background: var(--stone-attention-soft);
	}

	.invalid p {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--stone-text-muted);
		margin-bottom: var(--space-2);
	}

	@media (max-width: 32rem) {
		.line {
			flex-wrap: wrap;
		}

		.date {
			flex: 1;
		}
	}
</style>
