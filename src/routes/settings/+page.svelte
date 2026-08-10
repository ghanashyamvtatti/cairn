<script lang="ts">
	import Dialog from '$lib/components/Dialog.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import {
		backupFilename,
		countBackup,
		parseBackup,
		serializeBackup,
		type BackupData,
		type BackupCounts
	} from '$lib/domain/backup';
	import { MAX_WIP_LIMIT, MIN_WIP_LIMIT } from '$lib/domain/wip';
	import { formatBytes } from '$lib/platform/environment';
	import { downloadText, readFileAsText } from '$lib/platform/download';
	import { app } from '$lib/stores/app.svelte';
	import { platform } from '$lib/stores/platform.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { MotionPreference, ThemePreference } from '$lib/types';

	let fileInput = $state<HTMLInputElement | null>(null);

	/**
	 * `$state.raw`, not `$state`, and this matters.
	 *
	 * Plain `$state` deep-proxies the value it holds, and IndexedDB stores rows with the
	 * structured clone algorithm, which cannot clone a Proxy. Handing a proxied backup to
	 * `importAll` throws `DataCloneError` and the whole restore fails. Nothing here ever
	 * mutates the value in place — it is only ever replaced — so it needs no deep
	 * reactivity anyway.
	 */
	let pendingImport = $state.raw<{
		data: BackupData;
		counts: BackupCounts;
		warnings: string[];
	} | null>(null);
	let importErrors = $state<string[]>([]);
	let confirmClearOpen = $state(false);

	const persistenceLabel = $derived(
		{
			persisted: 'Granted — the browser will keep this data under storage pressure.',
			transient: 'Not granted. Your data is still saved, but could be cleared if space runs low.',
			unsupported: 'This browser does not offer persistent storage.'
		}[platform.persistence]
	);

	async function exportBackup() {
		const file = await app.repository.exportAll();
		downloadText(backupFilename(Date.now()), serializeBackup(file));
		await app.repository.setSetting('lastExportAt', Date.now());
		toasts.show('Backup saved. It never left your device.');
	}

	async function pickFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		importErrors = [];
		pendingImport = null;

		let raw: unknown;
		try {
			raw = JSON.parse(await readFileAsText(file));
		} catch {
			importErrors = ['That file is not valid JSON.'];
			return;
		}

		const result = parseBackup(raw, Date.now());
		if (!result.ok) {
			importErrors = result.errors;
			return;
		}

		pendingImport = {
			data: result.data,
			counts: countBackup(result.data),
			warnings: result.warnings
		};
	}

	async function confirmImport() {
		if (!pendingImport) return;

		try {
			await app.repository.importAll(pendingImport.data);
			pendingImport = null;
			toasts.show('Backup restored.');
		} catch (error) {
			// A restore that fails silently is the worst possible outcome for the one
			// feature standing between the user and losing everything. Say so, and leave
			// the existing data untouched.
			pendingImport = null;
			importErrors = [
				`The restore did not finish: ${error instanceof Error ? error.message : String(error)}. Your existing data has not been changed.`
			];
		}
	}

	async function setWipLimit(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		await app.repository.setSetting('wipLimit', value);
	}

	async function setTheme(value: ThemePreference) {
		await app.repository.setSetting('theme', value);
	}

	async function setMotion(value: MotionPreference) {
		await app.repository.setSetting('motion', value);
	}

	async function grantPersistence() {
		const granted = await platform.requestPersistence();
		await app.repository.setSetting('persistGranted', granted);
		toasts.show(
			granted
				? 'The browser agreed to keep your data.'
				: 'The browser declined for now. Keep exporting backups.'
		);
	}

	async function clearEverything() {
		await app.repository.clearAll();
		await app.repository.ensureCurrentWeek();
		confirmClearOpen = false;
		toasts.show('Everything deleted.');
	}
</script>

<svelte:head>
	<title>Settings · Cairn</title>
</svelte:head>

<header class="page-head">
	<h1>Settings</h1>
</header>

<section class="card block">
	<h2>Your data</h2>
	<p class="muted small">
		Everything lives in this browser. There is no account, no server, and nothing is sent anywhere.
		That also means a backup is the only copy that survives a cleared browser — which is why this
		section is first.
	</p>

	<div class="actions">
		<button type="button" class="btn btn-primary" onclick={exportBackup} data-testid="export">
			<Icon name="download" size={16} /> Export a backup
		</button>
		<button
			type="button"
			class="btn"
			onclick={() => fileInput?.click()}
			data-testid="import-trigger"
		>
			<Icon name="upload" size={16} /> Restore from a file
		</button>
		<input
			bind:this={fileInput}
			type="file"
			accept="application/json,.json"
			onchange={pickFile}
			hidden
			data-testid="import-input"
		/>
	</div>

	{#if app.settings.lastExportAt}
		<p class="small faint" data-testid="last-export">
			Last backup {new Date(app.settings.lastExportAt).toLocaleString()}
		</p>
	{:else}
		<p class="small faint">You have not exported a backup yet.</p>
	{/if}

	{#if importErrors.length > 0}
		<div class="notice attention" role="alert" data-testid="import-errors">
			{#each importErrors as error, i (i)}
				<p class="small">{error}</p>
			{/each}
		</div>
	{/if}
</section>

<section class="card block">
	<h2>Storage</h2>
	<dl class="facts">
		<dt>Installed</dt>
		<dd>{platform.installed ? 'Yes — running as an app' : 'No — running in a browser tab'}</dd>

		<dt>Persistent storage</dt>
		<dd>{persistenceLabel}</dd>

		{#if platform.estimate}
			<dt>Used</dt>
			<dd>
				{formatBytes(platform.estimate.usage)} of about {formatBytes(platform.estimate.quota)}
			</dd>
		{/if}
	</dl>

	{#if platform.persistence === 'transient'}
		<button
			type="button"
			class="btn btn-sm"
			onclick={grantPersistence}
			data-testid="request-persist"
		>
			Ask the browser to keep my data
		</button>
	{/if}

	{#if platform.ios && !platform.installed}
		<div class="notice attention">
			<p class="small">
				<strong>On iPhone and iPad this matters more than usual.</strong> Safari clears a website's
				storage after seven days without a visit. Web apps added to the Home Screen are not part of
				Safari and are exempt. Tap the Share button, then
				<strong>Add to Home Screen</strong>.
			</p>
		</div>
	{/if}
</section>

<section class="card block">
	<h2>How many projects at once</h2>
	<p class="muted small">
		The limit is a soft one — Cairn will tell you when you cross it and then get out of the way.
		Three is the default because three is roughly what a week holds.
	</p>

	<div class="field inline">
		<label for="wip-limit">Limit</label>
		<input
			id="wip-limit"
			class="input number"
			type="number"
			min={MIN_WIP_LIMIT}
			max={MAX_WIP_LIMIT}
			value={app.settings.wipLimit}
			onchange={setWipLimit}
			data-testid="wip-limit"
		/>
		<span class="small faint">{app.wip.activeCount} active right now</span>
	</div>
</section>

<section class="card block">
	<h2>Appearance</h2>

	<div class="field">
		<span class="label">Theme</span>
		<div class="segmented" role="group" aria-label="Theme">
			{#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const as [value, label] (value)}
				<button
					type="button"
					class="segment"
					class:selected={app.settings.theme === value}
					aria-pressed={app.settings.theme === value}
					onclick={() => setTheme(value)}
					data-testid={`theme-${value}`}
				>
					{label}
				</button>
			{/each}
		</div>
	</div>

	<div class="field">
		<span class="label">Motion</span>
		<div class="segmented" role="group" aria-label="Motion">
			{#each [['system', 'Follow system'], ['reduce', 'Reduce motion']] as const as [value, label] (value)}
				<button
					type="button"
					class="segment"
					class:selected={app.settings.motion === value}
					aria-pressed={app.settings.motion === value}
					onclick={() => setMotion(value)}
					data-testid={`motion-${value}`}
				>
					{label}
				</button>
			{/each}
		</div>
		<p class="small faint">
			Cairn already honours your system's reduce-motion setting. This forces it on regardless.
		</p>
	</div>
</section>

<section class="card block danger">
	<h2>Delete everything</h2>
	<p class="muted small">
		Removes every project, task, date and inbox item from this browser. Export first if you are not
		certain.
	</p>
	<button
		type="button"
		class="btn btn-danger"
		onclick={() => (confirmClearOpen = true)}
		data-testid="clear-all"
	>
		Delete all data
	</button>
</section>

<p class="colophon small faint">
	Cairn is local-first and account-free. No analytics, no telemetry, no network calls.
</p>

<!-- Import confirmation: replacing everything is the one action here that cannot be undone. -->
<Dialog
	open={pendingImport !== null}
	title="Restore this backup?"
	onclose={() => (pendingImport = null)}
>
	{#if pendingImport}
		<p>
			This replaces everything currently in Cairn with {pendingImport.counts.projects}
			{pendingImport.counts.projects === 1 ? 'project' : 'projects'},
			{pendingImport.counts.tasks} tasks, {pendingImport.counts.fixedDates} dates and
			{pendingImport.counts.inboxItems} inbox items.
		</p>
		<p class="small muted">Your current data is not merged. It is replaced.</p>

		{#if pendingImport.warnings.length > 0}
			<div class="notice">
				<p class="small"><strong>Cairn repaired a few things while reading the file:</strong></p>
				<ul>
					{#each pendingImport.warnings as warning, i (i)}
						<li class="small">{warning}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}

	{#snippet footer()}
		<button type="button" class="btn" onclick={() => (pendingImport = null)}>Cancel</button>
		<button
			type="button"
			class="btn btn-primary"
			onclick={confirmImport}
			data-testid="confirm-import"
		>
			Replace everything
		</button>
	{/snippet}
</Dialog>

<Dialog
	bind:open={confirmClearOpen}
	title="Delete all data?"
	onclose={() => (confirmClearOpen = false)}
>
	<p>Every project, task, date and inbox item in this browser will be removed.</p>
	<p class="small muted">This cannot be undone, and there is no copy anywhere else.</p>

	{#snippet footer()}
		<button type="button" class="btn" onclick={() => (confirmClearOpen = false)}>Cancel</button>
		<button
			type="button"
			class="btn btn-danger"
			onclick={clearEverything}
			data-testid="confirm-clear"
		>
			Delete everything
		</button>
	{/snippet}
</Dialog>

<style>
	.page-head {
		margin-bottom: var(--space-5);
	}

	.block {
		padding: var(--space-5);
		margin-bottom: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.block h2 {
		font-size: var(--text-md);
	}

	.block.danger {
		border-color: color-mix(in srgb, var(--stone-attention) 35%, var(--stone-border));
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		font-size: var(--text-sm);
		width: 100%;
	}

	.facts dt {
		color: var(--stone-text-faint);
	}

	.facts dd {
		margin: 0;
		color: var(--stone-text-muted);
	}

	.notice {
		width: 100%;
		padding: var(--space-3);
		border-radius: var(--radius);
		background: var(--stone-sunken);
	}

	.notice.attention {
		background: var(--stone-attention-soft);
		border: 1px solid color-mix(in srgb, var(--stone-attention) 35%, transparent);
	}

	.notice ul {
		margin: var(--space-2) 0 0;
		padding-left: var(--space-5);
		color: var(--stone-text-muted);
	}

	.field {
		width: 100%;
	}

	.field.inline {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.field .label,
	.field > label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--stone-text-muted);
		display: block;
		margin-bottom: var(--space-2);
	}

	.field.inline > label {
		margin-bottom: 0;
	}

	.number {
		width: 5rem;
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--stone-border-strong);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.segment {
		background: var(--stone-surface);
		border: none;
		padding: 0.4375rem 0.875rem;
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
		cursor: pointer;
		border-right: 1px solid var(--stone-border);
	}

	.segment:last-child {
		border-right: none;
	}

	.segment:hover {
		background: var(--stone-sunken);
	}

	.segment.selected {
		background: var(--stone-accent-soft);
		color: var(--stone-accent-text);
		font-weight: 500;
	}

	.colophon {
		text-align: center;
		padding: var(--space-5) 0;
	}
</style>
