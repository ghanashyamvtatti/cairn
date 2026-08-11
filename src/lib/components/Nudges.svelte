<script lang="ts">
	import { resolve } from '$app/paths';
	import { app } from '$lib/stores/app.svelte';
	import { exportReminderIsDue, nudgeIsDue, platform } from '$lib/stores/platform.svelte';
	import Icon from './Icon.svelte';

	/**
	 * Three pieces of guidance, shown at most one at a time, in order of consequence.
	 *
	 * The eviction warning outranks everything because it is the only one where ignoring
	 * it can lose data: Safari's Intelligent Tracking Prevention deletes IndexedDB after
	 * seven days without interaction, and only Home-Screen-installed web apps are exempt
	 * from that timer. Each nudge can be dismissed for a month — a nudge you cannot
	 * silence is nagging, and this app does not nag.
	 */
	const showEvictionRisk = $derived(
		platform.atEvictionRisk && nudgeIsDue(app.settings.installNudgeDismissedAt, app.now)
	);

	const showInstall = $derived(
		!showEvictionRisk &&
			!platform.installed &&
			platform.canPromptInstall &&
			nudgeIsDue(app.settings.installNudgeDismissedAt, app.now)
	);

	const showPersist = $derived(
		!showEvictionRisk &&
			!showInstall &&
			platform.persistence === 'transient' &&
			!app.isEmpty &&
			nudgeIsDue(app.settings.persistNudgeDismissedAt, app.now)
	);

	const showExportReminder = $derived(
		!showEvictionRisk &&
			!showInstall &&
			!showPersist &&
			!app.isEmpty &&
			exportReminderIsDue(app.settings.lastExportAt, app.now)
	);

	const neverExported = $derived(app.settings.lastExportAt === null);

	async function dismissInstall() {
		await app.repository.setSetting('installNudgeDismissedAt', Date.now());
	}

	async function dismissPersist() {
		await app.repository.setSetting('persistNudgeDismissedAt', Date.now());
	}

	/** Snoozes by pretending a backup just happened, which is also when to ask again. */
	async function dismissExport() {
		await app.repository.setSetting('lastExportAt', Date.now());
	}

	async function grantPersistence() {
		const granted = await platform.requestPersistence();
		await app.repository.setSetting('persistGranted', granted);
		if (!granted) await dismissPersist();
	}
</script>

{#if showEvictionRisk}
	<aside class="nudge attention" data-testid="nudge-eviction">
		<Icon name="info" size={18} />
		<div>
			<p class="title">Add Cairn to your Home Screen to keep your data</p>
			<p class="small">
				Safari deletes a website's stored data after seven days without a visit. Apps added to the
				Home Screen are exempt. Tap Share, then <strong>Add to Home Screen</strong>.
			</p>
			<div class="actions">
				<a href={resolve('/settings')} class="btn btn-sm">Back up instead</a>
				<button type="button" class="btn btn-sm btn-quiet" onclick={dismissInstall}>
					Not now
				</button>
			</div>
		</div>
	</aside>
{:else if showInstall}
	<aside class="nudge" data-testid="nudge-install">
		<Icon name="download" size={18} />
		<div>
			<p class="title">Install Cairn</p>
			<p class="small">
				It opens in its own window, launches straight from your home screen or dock, and works with
				no connection at all.
			</p>
			<div class="actions">
				<button
					type="button"
					class="btn btn-sm btn-primary"
					onclick={() => void platform.promptInstall()}
				>
					Install
				</button>
				<button type="button" class="btn btn-sm btn-quiet" onclick={dismissInstall}>Not now</button>
			</div>
		</div>
	</aside>
{:else if showPersist}
	<aside class="nudge" data-testid="nudge-persist">
		<Icon name="info" size={18} />
		<div>
			<p class="title">Ask the browser to keep your data</p>
			<p class="small">
				This marks Cairn's offline copy as worth keeping when space runs low, so the app still opens
				with no connection.
			</p>
			<div class="actions">
				<button type="button" class="btn btn-sm btn-primary" onclick={grantPersistence}>
					Keep my data
				</button>
				<button type="button" class="btn btn-sm btn-quiet" onclick={dismissPersist}>Not now</button>
			</div>
		</div>
	</aside>
{:else if showExportReminder}
	<aside class="nudge" data-testid="nudge-export">
		<Icon name="download" size={18} />
		<div>
			<p class="title">
				{neverExported
					? 'You have not backed up yet'
					: 'It has been a while since your last backup'}
			</p>
			<p class="small">
				The only copy that survives losing access to your account. One file, saved wherever you
				like.
			</p>
			<div class="actions">
				<a href={resolve('/settings')} class="btn btn-sm">Export now</a>
				<button type="button" class="btn btn-sm btn-quiet" onclick={dismissExport}>Not now</button>
			</div>
		</div>
	</aside>
{/if}

<style>
	.nudge {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		border: 1px solid var(--stone-border);
		background: var(--stone-surface);
	}

	.nudge.attention {
		border-color: color-mix(in srgb, var(--stone-attention) 45%, transparent);
		background: var(--stone-attention-soft);
	}

	.nudge :global(svg) {
		flex-shrink: 0;
		margin-top: 0.1875rem;
		color: var(--stone-text-faint);
	}

	.nudge.attention :global(svg) {
		color: var(--stone-attention);
	}

	.title {
		font-weight: 500;
	}

	.small {
		margin-top: var(--space-1);
		color: var(--stone-text-muted);
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
		flex-wrap: wrap;
	}
</style>
