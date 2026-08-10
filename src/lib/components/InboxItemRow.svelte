<script lang="ts">
	import { countdownFor, toIsoDate } from '$lib/domain/countdown';
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { InboxItem } from '$lib/types';
	import Icon from './Icon.svelte';

	interface Props {
		item: InboxItem;
		expanded: boolean;
		ontoggle: () => void;
	}

	let { item, expanded, ontoggle }: Props = $props();

	/**
	 * Triage is deliberately one decision at a time.
	 *
	 * Every route out of the inbox is on screen at once — a project, a project's next
	 * action, the manifest, a new project, or the bin — because the friction that makes
	 * inboxes rot is not the deciding, it is the navigating between places to put things.
	 */
	let manifestDate = $state('');
	let newProjectTitle = $state('');
	let mode = $state<'none' | 'manifest' | 'new-project'>('none');

	const activeProjects = $derived(app.active);
	const datePreview = $derived(manifestDate ? countdownFor(manifestDate, app.now) : null);

	$effect(() => {
		if (expanded) {
			manifestDate = item.parsedDate ?? '';
			mode = item.parsedDate ? 'manifest' : 'none';
			newProjectTitle = '';
		}
	});

	async function fileTo(projectId: string, asNextAction: boolean) {
		await app.repository.triageInboxItem(item.id, {
			kind: asNextAction ? 'to-next-action' : 'to-project',
			projectId
		});
		const project = app.projectById(projectId);
		toasts.show(
			asNextAction
				? `Now the next action for “${project?.title ?? 'the project'}”.`
				: `Filed under “${project?.title ?? 'the project'}”.`
		);
	}

	async function toManifest() {
		if (!manifestDate) return;
		await app.repository.triageInboxItem(item.id, { kind: 'to-manifest', date: manifestDate });
		toasts.show('Added to the manifest.');
	}

	async function toNewProject() {
		const title = newProjectTitle.trim();
		await app.repository.triageInboxItem(item.id, {
			kind: 'to-new-project',
			title: title === '' ? undefined : title
		});
		toasts.show(title === '' ? `Started “${item.text}”.` : `Started “${title}”.`);
	}

	async function discard() {
		const { id, text } = item;
		await app.repository.triageInboxItem(id, { kind: 'delete' });
		toasts.show(`Dropped “${text}”.`, {
			action: { label: 'Undo', run: () => void app.repository.restoreInboxItem(id) }
		});
	}

	function setToday() {
		manifestDate = toIsoDate(new Date(app.now));
		mode = 'manifest';
	}
</script>

<li class="item" class:expanded data-testid="inbox-item" data-item-id={item.id}>
	<button
		type="button"
		class="head"
		onclick={ontoggle}
		aria-expanded={expanded}
		data-testid="inbox-item-toggle"
	>
		<span class="chevron" class:open={expanded}><Icon name="chevron" size={14} /></span>
		<span class="text">{item.text}</span>
		{#if item.parsedDate}
			<span class="chip">{countdownFor(item.parsedDate, app.now)?.label}</span>
		{/if}
	</button>

	{#if expanded}
		<div class="triage" data-testid="triage-panel">
			{#if activeProjects.length > 0}
				<div class="group">
					<p class="label">File it under</p>
					<div class="chips">
						{#each activeProjects as project (project.id)}
							<div class="project-chip">
								<button
									type="button"
									class="btn btn-sm"
									onclick={() => fileTo(project.id, false)}
									data-testid="triage-to-project"
								>
									{project.title}
								</button>
								<button
									type="button"
									class="btn btn-sm next"
									onclick={() => fileTo(project.id, true)}
									title={`Make this the next action for ${project.title}`}
									aria-label={`Make this the next action for ${project.title}`}
									data-testid="triage-to-next-action"
								>
									<Icon name="target" size={14} />
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="group">
				<!-- "Or" only makes sense as a second option. With no projects yet, this group
				     is the whole choice, so it has to name itself. -->
				<p class="label">{activeProjects.length > 0 ? 'Or' : 'Where does it go?'}</p>
				<div class="chips">
					<button
						type="button"
						class="btn btn-sm"
						onclick={() => (mode = mode === 'manifest' ? 'none' : 'manifest')}
						aria-expanded={mode === 'manifest'}
						data-testid="triage-manifest-open"
					>
						<Icon name="manifest" size={14} /> It has a date
					</button>
					<button
						type="button"
						class="btn btn-sm"
						onclick={() => (mode = mode === 'new-project' ? 'none' : 'new-project')}
						aria-expanded={mode === 'new-project'}
						data-testid="triage-new-project-open"
					>
						<Icon name="plus" size={14} /> It is a project
					</button>
					<button
						type="button"
						class="btn btn-sm btn-quiet"
						onclick={discard}
						data-testid="triage-delete"
					>
						<Icon name="trash" size={14} /> Not really
					</button>
				</div>
			</div>

			{#if mode === 'manifest'}
				<div class="sub">
					<input
						class="input"
						type="date"
						bind:value={manifestDate}
						aria-label="Date for the manifest"
						data-testid="triage-manifest-date"
					/>
					<button type="button" class="btn btn-sm btn-quiet" onclick={setToday}>Today</button>
					<button
						type="button"
						class="btn btn-sm btn-primary"
						disabled={!manifestDate}
						onclick={toManifest}
						data-testid="triage-manifest-add"
					>
						Add to manifest
					</button>
					{#if datePreview}
						<span class="small muted">{datePreview.label}</span>
					{/if}
				</div>
			{/if}

			{#if mode === 'new-project'}
				<div class="sub">
					<input
						class="input"
						bind:value={newProjectTitle}
						placeholder={`Name the outcome (default: “${item.text}”)`}
						aria-label="New project name"
						data-testid="triage-new-project-title"
					/>
					<button
						type="button"
						class="btn btn-sm btn-primary"
						onclick={toNewProject}
						data-testid="triage-new-project-create"
					>
						Start it
					</button>
				</div>
				<p class="small faint">
					Give it a different name and this thought becomes its first next action.
				</p>
			{/if}
		</div>
	{/if}
</li>

<style>
	.item {
		border-bottom: 1px solid var(--stone-border);
	}

	.item:last-child {
		border-bottom: none;
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		background: none;
		border: none;
		padding: var(--space-3);
		text-align: left;
		color: inherit;
		cursor: pointer;
		font-size: var(--text-base);
	}

	.head:hover {
		background: var(--stone-sunken);
	}

	.chevron {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		color: var(--stone-text-faint);
		transition: transform var(--duration) var(--ease);
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.text {
		flex: 1;
	}

	.chip {
		flex-shrink: 0;
		padding: 0.0625rem 0.4375rem;
		border-radius: 999px;
		background: var(--stone-accent-soft);
		color: var(--stone-accent-text);
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.triage {
		padding: 0 var(--space-3) var(--space-4) calc(var(--space-3) + 1.25rem);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--stone-text-faint);
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.project-chip {
		display: flex;
	}

	.project-chip .btn:first-child {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.project-chip .next {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		margin-left: -1px;
		padding-inline: var(--space-2);
	}

	.sub {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.sub .input {
		width: auto;
		flex: 1;
		min-width: 9rem;
	}
</style>
