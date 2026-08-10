<script lang="ts">
	import { resolve } from '$app/paths';
	import Dialog from '$lib/components/Dialog.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { REVIEW_STEPS, REVIEW_TOTAL_MINUTES, stepSignal } from '$lib/domain/review';
	import { daysIntoWeek, formatWeekLabel, type WeekResetSummary } from '$lib/domain/week';
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	/**
	 * The weekly review.
	 *
	 * GTD's own literature calls the weekly review the critical success factor, and it is
	 * the first thing people stop doing before they abandon a system. So it is four
	 * steps, resumable, with visible progress and an explicit finish — and the reset it
	 * ends with is forgiving by construction: unfinished work moves forward without ever
	 * being marked late.
	 */

	let confirmOpen = $state(false);
	let summary = $state<WeekResetSummary | null>(null);
	let busy = $state(false);

	const week = $derived(app.currentWeek);
	const progress = $derived(app.review);
	const dayCount = $derived(week ? daysIntoWeek(week, app.now) : 0);

	const carryPreview = $derived(app.allTasks.filter((t) => t.completedAt === null).length);
	const archivePreview = $derived(app.completedThisWeek().length);

	async function toggleStep(stepId: (typeof REVIEW_STEPS)[number]['id'], done: boolean) {
		await app.repository.setReviewStep(stepId, done);
	}

	async function startNewWeek() {
		if (busy) return;
		busy = true;
		try {
			await app.repository.completeReview();
			summary = await app.repository.startNewWeek();
			confirmOpen = false;
			toasts.show('New week started. Nothing was lost.');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Weekly review · Cairn</title>
</svelte:head>

<header class="page-head">
	<div>
		<h1>Weekly review</h1>
		<p class="muted small">
			About {REVIEW_TOTAL_MINUTES} minutes.
			{#if week}
				{formatWeekLabel(week)}, day {dayCount + 1}.
			{/if}
		</p>
	</div>
</header>

{#if summary}
	<section class="card summary" data-testid="reset-summary">
		<h2>A new week</h2>
		<ul>
			<li><strong>{summary.carried}</strong> carried forward, none of it late</li>
			<li><strong>{summary.archived}</strong> filed under the week you just closed</li>
			{#if summary.stalled > 0}
				<li>
					<strong>{summary.stalled}</strong>
					{summary.stalled === 1 ? 'project needs' : 'projects need'} a next action
				</li>
			{/if}
		</ul>
		<a href={resolve('/')} class="btn btn-primary">Go to projects</a>
	</section>
{/if}

<div class="progress" data-testid="review-progress">
	<div class="track">
		<div class="fill" style:width={`${Math.round(progress.ratio * 100)}%`}></div>
	</div>
	<p class="small muted">{progress.done} of {progress.total} done</p>
</div>

<ol class="steps" data-tour="review-steps">
	{#each REVIEW_STEPS as step, index (step.id)}
		{@const done = progress.completed.includes(step.id)}
		{@const signal = stepSignal(step.id, app.reviewSignals)}
		{@const current = progress.nextStep?.id === step.id}

		<li class="step card" class:done class:current data-testid="review-step" data-step={step.id}>
			<label class="check">
				<input
					type="checkbox"
					checked={done}
					onchange={(event) => toggleStep(step.id, event.currentTarget.checked)}
					aria-label={`Mark "${step.title}" done`}
					data-testid="review-step-check"
				/>
				<span class="box" aria-hidden="true"><Icon name="check" size={13} /></span>
			</label>

			<div class="body">
				<h2>
					<span class="index numeric" aria-hidden="true">{index + 1}</span>
					{step.title}
				</h2>
				<p class="muted small">{step.hint}</p>

				<div class="row">
					<a href={resolve(step.href)} class="btn btn-sm">{step.cta}</a>
					{#if signal}
						<span class="signal small" data-testid="review-signal">{signal}</span>
					{/if}
					<span class="minutes small faint">~{step.minutes} min</span>
				</div>
			</div>
		</li>
	{/each}
</ol>

<section class="finish card" class:ready={progress.isComplete} data-tour="new-week">
	<h2>Start a new week</h2>
	<p class="muted small">
		Everything you finished gets filed under the week you are closing. Everything you did not gets
		carried forward, unchanged and unmarked. Nothing turns overdue and nothing is deleted.
	</p>

	<p class="preview small">
		<strong>{carryPreview}</strong>
		{carryPreview === 1 ? 'task carries' : 'tasks carry'} forward ·
		<strong>{archivePreview}</strong> finished {archivePreview === 1 ? 'task' : 'tasks'} filed
	</p>

	{#if !progress.isComplete}
		<p class="small faint">
			You can start a new week without finishing the checklist. The steps are a prompt, not a gate.
		</p>
	{/if}

	<button
		type="button"
		class="btn btn-primary"
		onclick={() => (confirmOpen = true)}
		data-testid="start-new-week"
	>
		Start new week
	</button>
</section>

<Dialog bind:open={confirmOpen} title="Start a new week?" onclose={() => (confirmOpen = false)}>
	<p>
		{carryPreview}
		{carryPreview === 1 ? 'unfinished task moves' : 'unfinished tasks move'} into the new week.
		{archivePreview} finished {archivePreview === 1 ? 'task stays' : 'tasks stay'} filed under this one.
	</p>
	<p class="small muted">Your projects, manifest and inbox are untouched.</p>

	{#snippet footer()}
		<button type="button" class="btn" onclick={() => (confirmOpen = false)}>Cancel</button>
		<button
			type="button"
			class="btn btn-primary"
			onclick={startNewWeek}
			disabled={busy}
			data-testid="confirm-new-week"
		>
			Start new week
		</button>
	{/snippet}
</Dialog>

<style>
	.page-head {
		margin-bottom: var(--space-4);
	}

	.progress {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.track {
		flex: 1;
		height: 4px;
		border-radius: 999px;
		background: var(--stone-sunken);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--stone-accent);
		border-radius: 999px;
		transition: width var(--duration) var(--ease);
	}

	.steps {
		list-style: none;
		margin: 0 0 var(--space-5);
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.step {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-4);
		transition: border-color var(--duration) var(--ease);
	}

	.step.current {
		border-color: var(--stone-border-strong);
	}

	.step.done {
		opacity: 0.7;
	}

	.step h2 {
		font-size: var(--text-base);
		font-weight: 600;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.step.done h2 {
		color: var(--stone-text-muted);
	}

	.index {
		color: var(--stone-text-faint);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
		flex-wrap: wrap;
	}

	.signal {
		color: var(--stone-text-muted);
	}

	.minutes {
		margin-left: auto;
	}

	.check {
		display: grid;
		place-items: start;
		padding-top: 0.125rem;
		cursor: pointer;
	}

	.check input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.box {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		border: 1.5px solid var(--stone-border-strong);
		display: grid;
		place-items: center;
		color: transparent;
	}

	.check input:checked + .box {
		background: var(--stone-accent);
		border-color: var(--stone-accent);
		color: var(--stone-bg);
	}

	.check input:focus-visible + .box {
		outline: 2px solid var(--stone-accent);
		outline-offset: 2px;
	}

	.finish {
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.finish.ready {
		border-color: var(--stone-accent);
	}

	.preview {
		color: var(--stone-text-muted);
	}

	.summary {
		padding: var(--space-5);
		margin-bottom: var(--space-5);
		border-color: var(--stone-accent);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.summary ul {
		margin: 0;
		padding-left: var(--space-5);
		color: var(--stone-text-muted);
		font-size: var(--text-sm);
	}
</style>
