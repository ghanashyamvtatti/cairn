<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { Task } from '$lib/types';
	import Icon from './Icon.svelte';

	interface Props {
		task: Task;
		/** Renders larger and with more weight, for a project's Next Action. */
		prominent?: boolean;
		/** Offer "make this the next action". Hidden for the current one. */
		canPromote?: boolean;
	}

	let { task, prominent = false, canPromote = false }: Props = $props();

	let editing = $state(false);
	let draft = $state('');

	const done = $derived(task.completedAt !== null);

	async function toggle() {
		if (done) await app.repository.reopenTask(task.id);
		else await app.repository.completeTask(task.id);
	}

	async function promote() {
		if (!task.projectId) return;
		await app.repository.setNextAction(task.projectId, task.id);
	}

	async function remove() {
		const { id, title } = task;
		await app.repository.deleteTask(id);
		toasts.show(`Removed “${title}”.`, {
			action: {
				label: 'Undo',
				// Soft deletes make undo a one-line restore rather than a re-creation, which
				// is why removing something here never needs a confirmation dialog.
				run: () => void app.repository.restoreTask(id)
			}
		});
	}

	function startEdit() {
		draft = task.title;
		editing = true;
	}

	async function commitEdit() {
		const next = draft.trim();
		editing = false;
		if (next === '' || next === task.title) return;
		await app.repository.updateTask(task.id, { title: next });
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void commitEdit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			editing = false;
		}
	}
</script>

<div class="task" class:prominent class:done data-testid="task-row" data-task-id={task.id}>
	<label class="check">
		<input
			type="checkbox"
			checked={done}
			onchange={toggle}
			aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
			data-testid="task-complete"
		/>
		<span class="box" aria-hidden="true"><Icon name="check" size={13} /></span>
	</label>

	{#if editing}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="input edit"
			bind:value={draft}
			onblur={commitEdit}
			onkeydown={onKeydown}
			autofocus
			aria-label="Task title"
		/>
	{:else}
		<button type="button" class="title" onclick={startEdit} title="Click to rename">
			{task.title}
		</button>
	{/if}

	<div class="tools">
		{#if canPromote && !done}
			<button
				type="button"
				class="tool"
				onclick={promote}
				title="Make this the next action"
				aria-label={`Make "${task.title}" the next action`}
				data-testid="task-promote"
			>
				<Icon name="target" size={16} />
			</button>
		{/if}
		<button
			type="button"
			class="tool"
			onclick={remove}
			title="Remove"
			aria-label={`Remove ${task.title}`}
			data-testid="task-delete"
		>
			<Icon name="trash" size={16} />
		</button>
	</div>
</div>

<style>
	.task {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		min-height: 2.5rem;
	}

	.check {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		cursor: pointer;
		/* Enlarge the touch target beyond the visual box. */
		padding: var(--space-2);
		margin: calc(var(--space-2) * -1);
	}

	.check input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.box {
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		border: 1.5px solid var(--stone-border-strong);
		display: grid;
		place-items: center;
		color: transparent;
		transition:
			background var(--duration) var(--ease),
			border-color var(--duration) var(--ease);
	}

	.prominent .box {
		width: 1.3125rem;
		height: 1.3125rem;
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

	.title {
		flex: 1;
		text-align: left;
		background: none;
		border: none;
		padding: 0;
		font-size: var(--text-base);
		color: var(--stone-text);
		cursor: text;
		line-height: 1.4;
	}

	.prominent .title {
		font-size: var(--text-md);
		font-weight: 500;
	}

	.done .title {
		color: var(--stone-text-faint);
		text-decoration: line-through;
		text-decoration-thickness: 1px;
	}

	.edit {
		flex: 1;
		min-height: 2rem;
		padding: 0.25rem 0.5rem;
	}

	.tools {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
		opacity: 0;
		transition: opacity var(--duration) var(--ease);
	}

	.task:hover .tools,
	.task:focus-within .tools {
		opacity: 1;
	}

	/* Touch devices have no hover, so the tools must always be reachable. */
	@media (hover: none) {
		.tools {
			opacity: 1;
		}
	}

	.tool {
		background: none;
		border: none;
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--stone-text-faint);
		cursor: pointer;
		display: grid;
		place-items: center;
	}

	.tool:hover {
		background: var(--stone-sunken);
		color: var(--stone-text);
	}
</style>
