<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { Project } from '$lib/types';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';
	import TaskRow from './TaskRow.svelte';

	interface Props {
		project: Project;
	}

	let { project }: Props = $props();

	const nextAction = $derived(app.nextActionFor(project));
	const openTasks = $derived(app.openTasksFor(project.id).filter((t) => !t.isNextAction));
	const doneThisWeek = $derived(app.completedThisWeek(project.id));
	const stalled = $derived(project.status === 'active' && nextAction === null);

	let showOthers = $state(false);
	let settingsOpen = $state(false);
	let renameDraft = $state('');
	let newActionTitle = $state('');
	let newTaskTitle = $state('');

	async function setNextAction(event: SubmitEvent) {
		event.preventDefault();
		const title = newActionTitle.trim();
		if (title === '') return;

		newActionTitle = '';
		await app.repository.addTask({ projectId: project.id, title, asNextAction: true });
	}

	async function addTask(event: SubmitEvent) {
		event.preventDefault();
		const title = newTaskTitle.trim();
		if (title === '') return;

		newTaskTitle = '';
		await app.repository.addTask({ projectId: project.id, title });
		showOthers = true;
	}

	function openSettings() {
		renameDraft = project.title;
		settingsOpen = true;
	}

	async function saveSettings() {
		const title = renameDraft.trim();
		if (title !== '' && title !== project.title) {
			await app.repository.renameProject(project.id, title);
		}
		settingsOpen = false;
	}

	async function park() {
		await app.repository.setProjectStatus(project.id, 'parked');
		settingsOpen = false;
		toasts.show(`Parked “${project.title}”. It is waiting, not lost.`, {
			action: {
				label: 'Unpark',
				run: () => void app.repository.setProjectStatus(project.id, 'active')
			}
		});
	}

	async function activate() {
		await app.repository.setProjectStatus(project.id, 'active');
		settingsOpen = false;
	}

	async function finish() {
		await app.repository.setProjectStatus(project.id, 'done');
		settingsOpen = false;
		toasts.show(`Finished “${project.title}”.`);
	}

	async function remove() {
		const { id, title } = project;
		const taskCount = app.tasksFor(id).length;

		await app.repository.deleteProject(id);
		settingsOpen = false;
		toasts.show(
			taskCount > 0
				? `Deleted “${title}” and ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}.`
				: `Deleted “${title}”.`,
			{
				tone: 'attention',
				// This takes more than any other action in the app, so it gets the longest
				// window to change your mind. The rows are soft-deleted, so the restore is
				// exact — the project and the tasks the cascade took with it.
				ms: 12000,
				action: { label: 'Undo', run: () => void app.repository.restoreProject(id) }
			}
		);
	}
</script>

<article class="project card" class:stalled data-testid="project-card" data-project-id={project.id}>
	<header>
		<h3>{project.title}</h3>
		<button
			type="button"
			class="more"
			onclick={openSettings}
			aria-label={`Options for ${project.title}`}
			data-testid="project-options"
		>
			<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
				<circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle
					cx="16"
					cy="10"
					r="1.6"
				/>
			</svg>
		</button>
	</header>

	{#if nextAction}
		<div class="next" data-testid="next-action">
			<p class="eyebrow">Next action</p>
			<TaskRow task={nextAction} prominent />
		</div>
	{:else if project.status === 'active'}
		<!--
			A project with no next action is flagged, not scolded. The flag is an input,
			because the only useful response to "this is stalled" is to decide what moves it,
			and making that one keystroke away is the entire point.
		-->
		<div class="next stalled-prompt" data-testid="stalled">
			<p class="eyebrow attention">
				<Icon name="info" size={14} />
				Stalled — nothing is moving this yet
			</p>
			<form onsubmit={setNextAction}>
				<input
					class="input"
					bind:value={newActionTitle}
					placeholder="What is the very next step?"
					aria-label={`Next action for ${project.title}`}
					data-testid="next-action-input"
				/>
				<button
					type="submit"
					class="btn btn-primary"
					disabled={newActionTitle.trim() === ''}
					data-testid="next-action-submit">Set</button
				>
			</form>
		</div>
	{/if}

	<!--
		Always present, even with nothing behind it: the rest of the project is where a
		thought goes when it is not the next action, and hiding the entrance until a task
		already exists left no way to put the first one there.
	-->
	<button
		type="button"
		class="disclosure"
		onclick={() => (showOthers = !showOthers)}
		aria-expanded={showOthers}
		data-testid="project-disclosure"
	>
		<span class="chevron" class:open={showOthers}><Icon name="chevron" size={14} /></span>
		{#if openTasks.length > 0}
			<span>{openTasks.length} waiting</span>
		{/if}
		{#if doneThisWeek.length > 0}
			<span class="done-count">{doneThisWeek.length} done this week</span>
		{/if}
		{#if openTasks.length === 0 && doneThisWeek.length === 0}
			<span>The rest of this project</span>
		{/if}
	</button>

	{#if showOthers}
		<div class="others">
			{#each openTasks as task (task.id)}
				<TaskRow {task} canPromote={project.status === 'active'} />
			{/each}

			{#each doneThisWeek as task (task.id)}
				<TaskRow {task} />
			{/each}

			<form class="add-task" onsubmit={addTask}>
				<input
					class="input"
					bind:value={newTaskTitle}
					placeholder="Add something else for later"
					aria-label={`Add a task to ${project.title}`}
					data-testid="add-task-input"
				/>
				<button type="submit" class="btn btn-sm" disabled={newTaskTitle.trim() === ''}>Add</button>
			</form>
		</div>
	{/if}
</article>

<Dialog bind:open={settingsOpen} title={project.title} onclose={() => (settingsOpen = false)}>
	<div class="field">
		<label for={`rename-${project.id}`}>Name</label>
		<input id={`rename-${project.id}`} class="input" bind:value={renameDraft} />
	</div>

	<div class="project-actions">
		{#if project.status === 'active'}
			<button type="button" class="btn" onclick={park} data-testid="project-park">
				<Icon name="park" size={16} /> Park for now
			</button>
			<button type="button" class="btn" onclick={finish}>
				<Icon name="check" size={16} /> Mark finished
			</button>
		{:else}
			<button type="button" class="btn" onclick={activate} data-testid="project-activate">
				<Icon name="target" size={16} /> Make active
			</button>
		{/if}
		<button type="button" class="btn btn-danger" onclick={remove} data-testid="project-delete">
			<Icon name="trash" size={16} /> Delete
		</button>
	</div>

	<p class="small faint">
		Parking keeps everything and takes the project off this screen. Deleting removes its tasks too.
	</p>

	{#snippet footer()}
		<button type="button" class="btn" onclick={() => (settingsOpen = false)}>Cancel</button>
		<button type="button" class="btn btn-primary" onclick={saveSettings}>Save</button>
	{/snippet}
</Dialog>

<style>
	.project {
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.project.stalled {
		border-color: color-mix(in srgb, var(--stone-attention) 35%, var(--stone-border));
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	h3 {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--stone-text-muted);
		letter-spacing: 0.01em;
	}

	.more {
		background: none;
		border: none;
		padding: var(--space-2);
		margin: calc(var(--space-2) * -1);
		border-radius: var(--radius-sm);
		color: var(--stone-text-faint);
		cursor: pointer;
		display: grid;
		place-items: center;
	}

	.more:hover {
		background: var(--stone-sunken);
		color: var(--stone-text);
	}

	.eyebrow {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--stone-text-faint);
		font-weight: 600;
	}

	.eyebrow.attention {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--stone-attention);
		text-transform: none;
		letter-spacing: 0;
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.stalled-prompt form {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.stalled-prompt .input {
		flex: 1;
	}

	.disclosure {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: none;
		border: none;
		padding: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--stone-text-faint);
		cursor: pointer;
		text-align: left;
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

	.done-count::before {
		content: '·';
		margin-right: var(--space-2);
	}

	.others {
		border-top: 1px solid var(--stone-border);
		margin-top: var(--space-1);
		padding-top: var(--space-1);
	}

	.add-task {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.add-task .input {
		flex: 1;
	}

	.project-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
