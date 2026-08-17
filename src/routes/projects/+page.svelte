<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import NewProjectDialog from '$lib/components/NewProjectDialog.svelte';
	import ProjectCard from '$lib/components/ProjectCard.svelte';
	import { overLimitMessage, wipStatus } from '$lib/domain/wip';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { ui } from '$lib/stores/ui.svelte';

	/**
	 * The planning surface.
	 *
	 * Today answers "what should I do right now"; this page answers "what am I moving,
	 * and is it still the right few things". Cards, the soft cap, parking and finishing
	 * all live here so the doing surface never has to carry management controls.
	 */
	let newProjectOpen = $state(false);

	/**
	 * Reactivating is the third way to add to the active set, so it gets the same
	 * treatment: the move goes through, and the consequence is stated plainly.
	 */
	async function reactivate(id: string) {
		await app.repository.setProjectStatus(id, 'active');
		const after = wipStatus(
			app.snapshot.projects.map((p) => (p.id === id ? { ...p, status: 'active' as const } : p)),
			app.settings.wipLimit
		);
		if (after.isOverLimit) {
			toasts.show(overLimitMessage(after), { tone: 'attention' });
		}
	}

	const showParked = $derived(app.parked.length > 0);
</script>

<svelte:head>
	<title>Projects · Cairn</title>
</svelte:head>

<header class="page-head">
	<div>
		<h1>Projects</h1>
		<p class="muted small">A few outcomes at a time, each with one next step.</p>
	</div>
</header>

<div class="page">
	{#if app.wip.isOverLimit}
		<!--
			A persistent, quiet statement rather than a dialog you dismiss once. The cap is
			soft, so the only thing keeping it meaningful is that going over stays visible.
		-->
		<p class="over-limit" role="status" data-testid="wip-banner">
			<Icon name="info" size={16} />
			{overLimitMessage(app.wip)}
		</p>
	{/if}

	{#if !app.ready}
		<p class="muted" data-testid="loading">Opening your cairn…</p>
	{:else if app.active.length === 0 && !showParked}
		<section class="empty card" data-testid="empty-projects" data-tour="projects">
			<h2>Nothing is running yet</h2>
			<p class="muted">
				A project is an outcome that takes more than one step. Three at a time is the default,
				because three is roughly what a week can actually hold.
			</p>
			<p class="muted small">
				Not sure yet? Press <kbd>c</kbd> and empty your head into the inbox first — sorting is a separate
				job from deciding.
			</p>
			<div class="empty-actions">
				<button
					type="button"
					class="btn btn-primary"
					onclick={() => (newProjectOpen = true)}
					data-testid="add-project"
				>
					<Icon name="plus" size={16} /> Start a project
				</button>
				<button type="button" class="btn" onclick={() => ui.openCapture()}>
					Dump a thought instead
				</button>
			</div>
		</section>
	{:else}
		<div class="projects" data-tour="projects">
			{#each app.active as project (project.id)}
				<ProjectCard {project} />
			{/each}
		</div>

		<button
			type="button"
			class="btn add"
			onclick={() => (newProjectOpen = true)}
			data-testid="add-project"
		>
			<Icon name="plus" size={16} />
			Start a project
			{#if app.wip.headroom > 0}
				<span class="faint small">{app.wip.headroom} left</span>
			{/if}
		</button>
	{/if}

	{#if showParked}
		<section class="parked">
			<h2 class="section-title">Parked</h2>
			<p class="muted small">Waiting, not lost. Nothing here is asking anything of you.</p>
			<ul>
				{#each app.parked as project (project.id)}
					<li>
						<span>{project.title}</span>
						<button
							type="button"
							class="btn btn-sm"
							onclick={() => void reactivate(project.id)}
							data-testid="unpark"
						>
							Reactivate
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if app.done.length > 0}
		<section class="parked">
			<h2 class="section-title">Finished</h2>
			<ul>
				{#each app.done as project (project.id)}
					<li><span class="faint">{project.title}</span></li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<NewProjectDialog bind:open={newProjectOpen} onclose={() => (newProjectOpen = false)} />

<style>
	.page-head {
		margin-bottom: var(--space-5);
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.projects {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.over-limit {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--stone-attention);
		padding: var(--space-3);
		border-radius: var(--radius);
		background: var(--stone-attention-soft);
	}

	.over-limit :global(svg) {
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.add {
		align-self: flex-start;
		border-style: dashed;
		color: var(--stone-text-muted);
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

	kbd {
		font-family: inherit;
		font-size: var(--text-xs);
		padding: 0.0625rem 0.3125rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--stone-border-strong);
		background: var(--stone-sunken);
	}

	.parked {
		margin-top: var(--space-4);
	}

	.section-title {
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--stone-text-faint);
		font-weight: 600;
	}

	.parked ul {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.parked li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--stone-border);
		border-radius: var(--radius);
		font-size: var(--text-sm);
	}
</style>
