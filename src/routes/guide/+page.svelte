<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import { REVIEW_STEPS, REVIEW_TOTAL_MINUTES } from '$lib/domain/review';
	import { seedExample } from '$lib/onboarding/seed';
	import { app } from '$lib/stores/app.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { tour } from '$lib/stores/tour.svelte';
	import { SHORTCUTS } from '$lib/stores/ui.svelte';

	/**
	 * The reference, as opposed to the tour.
	 *
	 * The tour answers "what am I looking at" in the moment; this answers "how is this
	 * meant to be used" at leisure, and defines the words the interface uses. Both exist
	 * because they are genuinely different questions, and reaching for the second one
	 * should never mean sitting through the first.
	 */
	let busy = $state(false);

	async function loadExample() {
		if (busy) return;
		busy = true;
		try {
			await seedExample(app.repository);
			await goto(resolve('/'));
			toasts.show('Loaded an example week. Delete anything you like — it is just data.', {
				ms: 9000
			});
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>How Cairn works · Cairn</title>
</svelte:head>

<header class="page-head">
	<h1>How Cairn works</h1>
	<p class="muted">
		A calm way to keep a few things moving. Read this once and the rest of the app explains itself.
	</p>
	<div class="head-actions">
		<button
			type="button"
			class="btn btn-sm btn-primary"
			onclick={() => tour.start()}
			data-testid="guide-tour"
		>
			Take the tour
		</button>
		{#if app.isEmpty}
			<button
				type="button"
				class="btn btn-sm"
				onclick={loadExample}
				disabled={busy}
				data-testid="guide-example"
			>
				Load an example week
			</button>
		{/if}
	</div>
</header>

<section class="card block">
	<h2>The idea</h2>
	<p>
		Most task managers fail the same way. You miss a few days, come back to a wall of red overdue
		items, feel bad, and stop opening the app. Everything in Cairn is arranged so that cannot
		happen: nothing is ever marked late, nothing accumulates, and there is no counter anywhere
		telling you how far behind you are.
	</p>
	<p class="muted">
		The trade is that Cairn will not hold everything. It holds a few things properly.
	</p>
</section>

<section class="card block">
	<h2>The five places</h2>

	<div class="place">
		<h3><Icon name="today" size={18} /> Today</h3>
		<p>
			The screen the app opens on, and the one that answers “what should I do right now?”. It
			gathers one <strong>next action</strong> from each project you are running — tickable right there
			— along with any dates arriving in the next two weeks and a pointer to the inbox when something
			is waiting to be sorted. Ticking off a step asks you to name the next one on the spot, so a project
			never quietly grinds to a halt.
		</p>
	</div>

	<div class="place">
		<h3><Icon name="projects" size={18} /> Projects</h3>
		<p>
			A <strong>project</strong> is an outcome that takes more than one step — “move the studio”,
			not “email the landlord”. Three run at a time by default. Start a fourth and Cairn will say so
			and offer to <strong>park</strong> one; parking keeps everything and takes it off the screen. The
			limit is yours to break, but going over stays visible rather than being a dialog you clicked past.
		</p>
		<p>
			Each project has exactly one <strong>next action</strong>: a concrete, physical thing you
			could start now. Set a different one and the old one stays in the project as an ordinary task.
			A project with no next action is <strong>stalled</strong> — not a telling-off, just a text box asking
			what would move it.
		</p>
	</div>

	<div class="place">
		<h3><Icon name="manifest" size={18} /> Dates</h3>
		<p>
			A departure board of dates that arrive whether or not you are ready: renewals, flights,
			deadlines, birthdays. Each shows a live countdown. They are deliberately
			<strong>not tasks</strong> and there is no way to tick one off, because a date is not something
			you do — it is something that happens. Once a date passes it moves quietly into a collapsed “passed”
			section.
		</p>
	</div>

	<div class="place">
		<h3><Icon name="inbox" size={18} /> Inbox</h3>
		<p>
			Somewhere to put a thought without deciding anything about it. Press
			<kbd>c</kbd> anywhere, type, press Enter — no fields, no project, no date required. Write “renew
			the insurance by 30 September” and the date is understood and lifted out for you.
		</p>
		<p>
			Later, sort each item: into a project, as a project's next action, onto the dates board, into
			a new project, or the bin. Nothing stays in the inbox.
		</p>
	</div>

	<div class="place">
		<h3><Icon name="review" size={18} /> Review</h3>
		<p>
			About {REVIEW_TOTAL_MINUTES} minutes, once a week. Four steps, and you can stop and come back —
			progress is saved.
		</p>
		<ol class="steps">
			{#each REVIEW_STEPS as step (step.id)}
				<li><strong>{step.title}.</strong> {step.hint}</li>
			{/each}
		</ol>
		<p>
			Then <strong>start a new week</strong>. Everything you finished is filed under the week you
			are closing; everything you did not is carried forward, unchanged and unmarked. Nothing is
			deleted and nothing turns overdue. Miss three weeks and the app looks exactly the same as if
			you had missed none.
		</p>
	</div>
</section>

<section class="card block">
	<h2>A week in practice</h2>
	<ol class="rhythm">
		<li>
			<strong>Whenever something occurs to you</strong> — press <kbd>c</kbd>, type it, forget it.
		</li>
		<li>
			<strong>Most days</strong> — open Today, do the next action on whichever project you have energy
			for, and name the one after.
		</li>
		<li>
			<strong>Once a week</strong> — run the review and start a new week.
		</li>
	</ol>
	<p class="muted small">
		That is the whole system. If you only ever do the first one, Cairn is still a decent place to
		put things.
	</p>
</section>

<section class="card block">
	<h2>Keyboard</h2>
	<dl class="shortcuts">
		{#each SHORTCUTS as shortcut (shortcut.keys)}
			<dt><kbd>{shortcut.keys}</kbd></dt>
			<dd>{shortcut.description}</dd>
		{/each}
	</dl>
	<p class="muted small">Shortcuts never fire while you are typing in a field.</p>
</section>

<section class="card block">
	<h2>Where your data lives</h2>
	<p>
		On Cairn's server, under your account, so your laptop and your phone show the same thing. A copy
		is also kept in this browser, which is why the app opens instantly and why you can still read
		everything and capture new thoughts with no connection.
	</p>
	<p>
		Anything other than capture needs a connection, and Cairn says so rather than accepting a change
		it cannot keep. That is deliberate: with one place deciding what happened, two devices cannot
		quietly disagree.
	</p>
	<p>
		<strong>Add Cairn to your Home Screen or dock.</strong> It opens in its own window, and on iPhone
		and iPad it also protects the offline copy: Safari clears an ordinary website's stored data after
		seven days without a visit, and web apps on the Home Screen are exempt. Your work is safe on the server
		either way — this is about the app still opening with no connection.
	</p>
	<p>
		There is no analytics and no telemetry, and nothing is shared or sold. But your data is readable
		by whoever runs the server, so it is a matter of trust rather than mathematics.
		<strong>Export a backup from <a href={resolve('/settings')}>Settings</a></strong> now and then — it
		is written entirely on your machine, and it is the only copy that survives losing access to the account.
		There is no password reset yet.
	</p>
</section>

<style>
	.page-head {
		margin-bottom: var(--space-5);
	}

	.page-head p {
		margin-top: var(--space-2);
		max-width: var(--measure);
	}

	.head-actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-4);
		flex-wrap: wrap;
	}

	.block {
		padding: var(--space-5);
		margin-bottom: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.block h2 {
		font-size: var(--text-md);
	}

	.block p {
		max-width: var(--measure);
		line-height: 1.6;
	}

	.place {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--stone-border);
	}

	.place:first-of-type {
		border-top: none;
		padding-top: 0;
	}

	.place h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-base);
	}

	.place :global(svg) {
		color: var(--stone-text-faint);
	}

	.steps,
	.rhythm {
		margin: 0;
		padding-left: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
		max-width: var(--measure);
		line-height: 1.55;
	}

	.shortcuts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		align-items: baseline;
	}

	.shortcuts dd {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
	}

	kbd {
		font-family: inherit;
		font-size: var(--text-xs);
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--stone-border-strong);
		background: var(--stone-sunken);
		white-space: nowrap;
	}
</style>
