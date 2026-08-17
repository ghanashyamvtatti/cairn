<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import Nudges from '$lib/components/Nudges.svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { comingUpSoon } from '$lib/domain/countdown';
	import { formatWeekLabel } from '$lib/domain/week';
	import { app } from '$lib/stores/app.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import type { Project } from '$lib/types';

	/**
	 * Today: the one screen that answers "what should I do right now?".
	 *
	 * The previous home was a management surface — cards, menus, disclosure toggles —
	 * and the actual answer was scattered across it and two other pages. This screen
	 * assembles the answer instead of asking the user to: one next step per project,
	 * checkable in place; the dates close enough to matter; a pointer to the inbox when
	 * something is waiting. Everything else stays on its own page, one tap away.
	 *
	 * Completing a step swaps the row for a "what's the next step?" prompt in place, so
	 * momentum and naming-the-next-step happen at the same moment instead of a project
	 * silently stalling behind a card.
	 */
	const weekLabel = $derived(app.currentWeek ? formatWeekLabel(app.currentWeek) : '');

	/** Every active project paired with its next action, stalled ones included. */
	const nextUp = $derived(
		app.active.map((project) => ({ project, action: app.nextActionFor(project) }))
	);

	const comingUp = $derived(comingUpSoon(app.fixedDates, app.now));
	/** Dates on the board but beyond the fortnight horizon. */
	const laterCount = $derived(app.manifest.upcoming.length - comingUp.length);
	const doneToday = $derived(app.completedThisWeek().length);

	/** One draft per stalled project, so typing in one prompt never leaks into another. */
	let drafts = $state<Record<string, string>>({});

	async function setNext(event: SubmitEvent, project: Project) {
		event.preventDefault();
		const title = (drafts[project.id] ?? '').trim();
		if (title === '') return;

		drafts[project.id] = '';
		await app.repository.addTask({ projectId: project.id, title, asNextAction: true });
	}
</script>

<svelte:head>
	<title>Today · Cairn</title>
</svelte:head>

<header class="page-head">
	<div>
		<h1>Today</h1>
		{#if weekLabel}
			<p class="muted small" data-testid="week-label">{weekLabel}</p>
		{/if}
	</div>

	{#if app.reviewDue && app.allProjects.length > 0}
		<a href={resolve('/review')} class="btn btn-sm" data-testid="review-nudge">
			<Icon name="review" size={16} />
			Time for a review
		</a>
	{/if}
</header>

<div class="page">
	<Nudges />

	{#if !app.ready}
		<p class="muted" data-testid="loading">Opening your cairn…</p>
	{:else if app.active.length === 0}
		<section class="empty card" data-testid="today-empty">
			<h2>Nothing is moving yet</h2>
			<p class="muted">
				Today shows one next step for each project you are running, so opening the app answers “what
				now?” without any digging. Start a project and its next step will appear here.
			</p>
			<div class="empty-actions">
				<a href={resolve('/projects')} class="btn btn-primary" data-testid="today-start-project">
					<Icon name="projects" size={16} /> Start a project
				</a>
				<button type="button" class="btn" onclick={() => ui.openCapture()}>
					Jot a thought instead
				</button>
			</div>
		</section>
	{:else}
		<section class="card next-up" data-testid="today-next-up" data-tour="next-up">
			<header class="section-head">
				<h2 class="section-title">Next up</h2>
				<p class="muted small">One step per project. Do one, then name the one after.</p>
			</header>

			<ul>
				{#each nextUp as entry (entry.project.id)}
					<li class="entry" data-testid="today-entry" data-project-id={entry.project.id}>
						<p class="eyebrow">{entry.project.title}</p>
						{#if entry.action}
							<TaskRow task={entry.action} prominent />
						{:else}
							<!--
								A stalled project is a prompt, not a scold — and the prompt lives here
								because the moment you notice a project has no next step is the moment
								to name one, not a screen away.
							-->
							<form class="stalled" onsubmit={(event) => setNext(event, entry.project)}>
								<input
									class="input"
									bind:value={drafts[entry.project.id]}
									placeholder="What is the very next step?"
									aria-label={`Next action for ${entry.project.title}`}
									data-testid="today-next-input"
								/>
								<button
									type="submit"
									class="btn btn-primary"
									disabled={(drafts[entry.project.id] ?? '').trim() === ''}
									data-testid="today-next-submit">Set</button
								>
							</form>
						{/if}
					</li>
				{/each}
			</ul>

			{#if doneToday > 0}
				<p class="small faint done-line" data-testid="today-done-count">
					{doneToday} finished this week
				</p>
			{/if}
		</section>
	{/if}

	{#if comingUp.length > 0}
		<section class="card coming-up" data-testid="today-coming-up">
			<header class="section-head row">
				<h2 class="section-title">Coming up</h2>
				<a href={resolve('/manifest')} class="small all-dates" data-testid="today-all-dates">
					All dates
					{#if laterCount > 0}<span class="faint">· {laterCount} later</span>{/if}
				</a>
			</header>
			<ul>
				{#each comingUp as entry (entry.id)}
					{@const countdown = app.countdown(entry)}
					<li class="date-row" data-testid="today-date">
						<span class="date-title">{entry.title}</span>
						{#if countdown}
							<span
								class="when"
								class:soon={countdown.tone === 'today' || countdown.tone === 'imminent'}
							>
								{countdown.label}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{:else if app.fixedDates.length > 0}
		<p class="muted small quiet-line" data-testid="today-no-dates">
			Nothing on the <a href={resolve('/manifest')}>dates board</a> for the next two weeks.
		</p>
	{/if}

	{#if app.inbox.length > 0}
		<a href={resolve('/inbox')} class="card line-link" data-testid="today-inbox-line">
			<Icon name="inbox" size={16} />
			<span>
				{app.inbox.length}
				{app.inbox.length === 1 ? 'thought' : 'thoughts'} waiting to be sorted
			</span>
			<span class="chevron"><Icon name="chevron" size={14} /></span>
		</a>
	{/if}
</div>

<style>
	.page-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.section-head {
		margin-bottom: var(--space-2);
	}

	.section-head.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.section-title {
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--stone-text-faint);
		font-weight: 600;
	}

	.next-up,
	.coming-up {
		padding: var(--space-4);
	}

	.next-up ul,
	.coming-up ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.entry {
		padding: var(--space-2) 0;
		border-top: 1px solid var(--stone-border);
	}

	.entry:first-child {
		border-top: none;
	}

	.eyebrow {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--stone-text-faint);
		font-weight: 600;
	}

	.stalled {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.stalled .input {
		flex: 1;
	}

	.done-line {
		margin-top: var(--space-2);
	}

	.date-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-top: 1px solid var(--stone-border);
	}

	.date-row:first-child {
		border-top: none;
	}

	.date-title {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.when {
		flex-shrink: 0;
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
	}

	.when.soon {
		color: var(--stone-accent-text);
		font-weight: 500;
	}

	.all-dates {
		color: var(--stone-text-muted);
		text-decoration: none;
	}

	.all-dates:hover {
		color: var(--stone-text);
		text-decoration: underline;
	}

	.quiet-line {
		padding-inline: var(--space-1);
	}

	.quiet-line a {
		color: inherit;
	}

	.line-link {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		text-decoration: none;
		color: var(--stone-text);
		font-size: var(--text-sm);
	}

	.line-link:hover {
		background: var(--stone-sunken);
	}

	.line-link :global(svg) {
		color: var(--stone-text-faint);
		flex-shrink: 0;
	}

	.line-link .chevron {
		margin-left: auto;
		display: grid;
		place-items: center;
	}

	.empty {
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.empty-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
</style>
