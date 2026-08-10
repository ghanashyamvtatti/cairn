<script lang="ts">
	import {
		loadedChrono,
		parseCapture,
		parseCaptureWith,
		type CapturedText
	} from '$lib/domain/capture';
	import { countdownFor } from '$lib/domain/countdown';
	import { app } from '$lib/stores/app.svelte';

	interface Props {
		/**
		 * Takes focus whenever this flips to true.
		 *
		 * Deliberately a reactive prop driving an imperative `focus()` rather than the
		 * `autofocus` attribute. This field lives inside a `<dialog>` that spends most of
		 * its life closed, and a declarative `autofocus` on a hidden element gets deferred
		 * by the browser and then honoured on the next interaction — quietly moving focus
		 * into an invisible input, which swallows keystrokes and disables every
		 * single-key shortcut in the app.
		 */
		focusWhen?: boolean;
		placeholder?: string;
		/** Called after each successful capture, with the text that was stored. */
		oncaptured?: (text: string) => void;
	}

	let { focusWhen = false, placeholder = 'What is on your mind?', oncaptured }: Props = $props();

	let value = $state('');
	let input = $state<HTMLInputElement | null>(null);

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
		if (!focusWhen) return;
		// One frame later, so the dialog has actually been shown and the element is
		// focusable. Focusing a `display: none` input silently does nothing.
		const frame = requestAnimationFrame(() => input?.focus());
		return () => cancelAnimationFrame(frame);
	});

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
		/*
		 * No in-flight guard.
		 *
		 * There used to be one, to stop a double submit of the same text — but the field is
		 * now cleared synchronously below, so a repeat submit sees nothing and returns
		 * anyway. Keeping the guard meant a second thought entered while the first was
		 * still saving was silently dropped, which is precisely the burst a brain dump is.
		 * Concurrent writes are fine; they carry different text.
		 */
		if (raw === '') return;

		/*
		 * Take one last look at exactly what was typed.
		 *
		 * The background parse is debounced, so submitting quickly used to beat it and the
		 * date was lost. Once chrono is in memory a parse is a synchronous millisecond, so
		 * this costs nothing and makes recognition depend on the text rather than on
		 * typing speed. Before the chunk has loaded there is simply no parser, and capture
		 * still goes through with no date — which is the promise.
		 */
		const chrono = loadedChrono();
		const fresh =
			parsed?.raw === value ? parsed : chrono ? parseCaptureWith(chrono, value, app.now) : null;
		const usable = fresh?.date ? fresh : null;
		const text = usable?.title.trim() || raw;

		/*
		 * Clear BEFORE awaiting the write.
		 *
		 * Clearing afterwards wipes anything typed during the save — a brain dump is fast
		 * enough that the first characters of the next thought routinely land inside that
		 * window, and they were silently discarded.
		 */
		value = '';
		parsed = null;
		parsedFor = '';

		input?.focus();
		await app.repository.captureInboxItem(text, usable?.date ?? undefined);
		oncaptured?.(text);
	}
</script>

<form onsubmit={submit} class="capture">
	<input
		bind:this={input}
		bind:value
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
