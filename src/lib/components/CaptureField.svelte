<script lang="ts">
	import { parseCapture, type CapturedText } from '$lib/domain/capture';
	import { countdownFor } from '$lib/domain/countdown';
	import { app } from '$lib/stores/app.svelte';

	interface Props {
		/** Focus on mount. Used when the field is the point of the screen. */
		autofocus?: boolean;
		placeholder?: string;
		/** Called after each successful capture, with the text that was stored. */
		oncaptured?: (text: string) => void;
	}

	let { autofocus = false, placeholder = 'What is on your mind?', oncaptured }: Props = $props();

	let value = $state('');
	let input = $state<HTMLInputElement | null>(null);
	let busy = $state(false);

	/**
	 * The parse result, and the exact string it was computed from.
	 *
	 * Capture must not wait on chrono-node: it is a dynamically-imported chunk, and
	 * awaiting it on submit would put a network or disk fetch between Enter and the item
	 * appearing. So parsing runs ahead as a hint, and submit uses the result only when it
	 * matches what is currently typed. The worst case is an item with no date, which is
	 * exactly what "no required fields" promises.
	 */
	let parsed = $state<CapturedText | null>(null);
	let parsedFor = $state('');

	let hint = $derived(parsed && parsed.raw === value && parsed.date ? parsed : null);
	let hintCountdown = $derived(hint?.date ? countdownFor(hint.date, app.now) : null);

	$effect(() => {
		const current = value;
		if (current.trim() === '' || current === parsedFor) return;

		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				const result = await parseCapture(current, app.now);
				if (!cancelled) {
					parsed = result;
					parsedFor = current;
				}
			} catch {
				// A parser that fails to load must never block capture.
			}
		}, 180);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();

		const raw = value.trim();
		if (raw === '' || busy) return;

		// Only trust a parse computed from exactly this string.
		const usable = parsed && parsed.raw === value && parsed.date ? parsed : null;
		const text = usable?.title.trim() || raw;

		busy = true;
		try {
			await app.repository.captureInboxItem(text, usable?.date ?? undefined);
			value = '';
			parsed = null;
			parsedFor = '';
			oncaptured?.(text);
		} finally {
			busy = false;
			input?.focus();
		}
	}
</script>

<form onsubmit={submit} class="capture">
	<!-- svelte-ignore a11y_autofocus -->
	<input
		bind:this={input}
		bind:value
		{autofocus}
		{placeholder}
		class="input"
		type="text"
		name="capture"
		autocomplete="off"
		autocapitalize="sentences"
		spellcheck="false"
		enterkeyhint="done"
		aria-label="Capture a thought"
		aria-describedby={hint ? 'capture-hint' : undefined}
		data-testid="capture-input"
	/>
	<button
		type="submit"
		class="btn btn-primary"
		disabled={value.trim() === ''}
		data-testid="capture-submit"
	>
		Add
	</button>
</form>

{#if hint && hintCountdown}
	<p class="hint" id="capture-hint" data-testid="capture-hint">
		Reads as <strong>{hint.title}</strong>
		<span class="chip">{hintCountdown.label}</span>
	</p>
{/if}

<style>
	.capture {
		display: flex;
		gap: var(--space-2);
	}

	.capture .input {
		flex: 1;
	}

	.hint {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
	}

	.hint strong {
		font-weight: 500;
		color: var(--stone-text);
	}

	.chip {
		display: inline-block;
		margin-left: var(--space-1);
		padding: 0.0625rem 0.4375rem;
		border-radius: 999px;
		background: var(--stone-accent-soft);
		color: var(--stone-accent-text);
		font-size: var(--text-xs);
		font-weight: 500;
	}
</style>
