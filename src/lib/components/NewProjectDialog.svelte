<script lang="ts">
	import { decideAddProject } from '$lib/domain/wip';
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		onclose: () => void;
	}

	let { open = $bindable(), onclose }: Props = $props();

	let title = $state('');
	let busy = $state(false);

	/**
	 * The limit is soft, so this never blocks. It does insist on being read: the warning
	 * appears *before* you cross the line, and the confirm button changes its wording so
	 * that going over is a deliberate sentence you agreed to rather than a dialog you
	 * clicked past.
	 */
	const decision = $derived(decideAddProject(app.snapshot.projects, app.settings.wipLimit));
	const overLimit = $derived(decision.kind === 'warn');

	$effect(() => {
		if (!open) title = '';
	});

	async function park(id: string, name: string) {
		await app.repository.setProjectStatus(id, 'parked');
		toasts.show(`Parked “${name}”.`, {
			action: { label: 'Undo', run: () => void app.repository.setProjectStatus(id, 'active') }
		});
	}

	async function create() {
		const name = title.trim();
		if (name === '' || busy) return;

		busy = true;
		try {
			await app.repository.createProject(name);
			open = false;
			onclose();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog bind:open title="Start a project" {onclose}>
	{#if overLimit && decision.kind === 'warn'}
		<div class="warning" data-testid="wip-warning">
			<Icon name="info" size={18} />
			<div>
				<p>
					You already have {decision.status.activeCount} active, and your limit is {decision.status
						.limit}.
				</p>
				<p class="small">
					The limit is yours to break. It is just worth knowing that finishing two things usually
					beats starting a third.
				</p>
			</div>
		</div>

		{#if decision.parkCandidates.length > 0}
			<div class="candidates">
				<p class="small muted">Park one instead? These have moved least recently.</p>
				<ul>
					{#each decision.parkCandidates.slice(0, 3) as candidate (candidate.id)}
						<li>
							<span>{candidate.title}</span>
							<button
								type="button"
								class="btn btn-sm"
								onclick={() => park(candidate.id, candidate.title)}
								data-testid="park-candidate"
							>
								Park
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}

	<form
		onsubmit={(event) => {
			event.preventDefault();
			void create();
		}}
		class="field"
	>
		<label for="new-project-title">What is the outcome?</label>
		<input
			id="new-project-title"
			class="input"
			bind:value={title}
			placeholder="e.g. Move the studio to the new space"
			autocomplete="off"
			data-testid="new-project-input"
		/>
		<p class="small faint">
			Name the finished state, not the task. You will pick its next action in a moment.
		</p>
		<!-- Present so Enter submits the form; the visible action lives in the footer. -->
		<button type="submit" class="visually-hidden">Start project</button>
	</form>

	{#snippet footer()}
		<button
			type="button"
			class="btn"
			onclick={() => {
				open = false;
				onclose();
			}}
		>
			Cancel
		</button>
		<button
			type="button"
			class="btn btn-primary"
			disabled={title.trim() === '' || busy}
			onclick={() => void create()}
			data-testid="new-project-submit"
		>
			{overLimit ? 'Start it anyway' : 'Start project'}
		</button>
	{/snippet}
</Dialog>

<style>
	.warning {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius);
		background: var(--stone-attention-soft);
		border: 1px solid color-mix(in srgb, var(--stone-attention) 40%, transparent);
	}

	.warning :global(svg) {
		flex-shrink: 0;
		color: var(--stone-attention);
		margin-top: 0.125rem;
	}

	.warning p + p {
		margin-top: var(--space-1);
		color: var(--stone-text-muted);
	}

	.candidates ul {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.candidates li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--text-sm);
	}
</style>
