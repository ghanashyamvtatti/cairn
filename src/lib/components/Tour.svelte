<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { tour } from '$lib/stores/tour.svelte';

	/**
	 * A spotlight tour over the real interface.
	 *
	 * It highlights actual elements rather than showing screenshots, so what you are
	 * told about is the thing in front of you. Every step degrades: if its target is
	 * missing — a project card on an empty board, say — the step still runs as a centred
	 * card rather than pointing at nothing or breaking the sequence.
	 */
	const PADDING = 8;
	/** How long to wait for a target to appear after navigating before giving up on it. */
	const TARGET_TIMEOUT_MS = 1500;

	interface Rect {
		top: number;
		left: number;
		width: number;
		height: number;
	}

	let rect = $state<Rect | null>(null);
	let card = $state<HTMLDivElement | null>(null);
	let cardHeight = $state(0);
	let viewport = $state({ width: 0, height: 0 });

	const step = $derived(tour.step);

	function measure(element: Element): Rect {
		const box = element.getBoundingClientRect();
		return {
			top: box.top - PADDING,
			left: box.left - PADDING,
			width: box.width + PADDING * 2,
			height: box.height + PADDING * 2
		};
	}

	/** Navigate to the step's route before trying to find anything on it. */
	$effect(() => {
		const current = step;
		if (!current) return;
		if (page.url.pathname !== current.route) void goto(resolve(current.route));
	});

	/**
	 * Find and follow the target.
	 *
	 * The element may not exist the instant the route changes, so this polls per frame
	 * for a short while, then keeps re-measuring so the spotlight tracks scrolling,
	 * resizing and any layout the app does underneath.
	 */
	$effect(() => {
		const current = step;
		if (!current) {
			rect = null;
			return;
		}

		let cancelled = false;
		let frame = 0;
		const startedAt = performance.now();
		let found: Element | null = null;

		const tick = () => {
			if (cancelled) return;

			if (!found && current.target) {
				found = document.querySelector(current.target);
				if (found) {
					found.scrollIntoView({ block: 'center', behavior: 'auto' });
				} else if (performance.now() - startedAt > TARGET_TIMEOUT_MS) {
					rect = null;
					return; // Give up quietly; the step becomes a centred card.
				}
			}

			viewport = { width: window.innerWidth, height: window.innerHeight };
			rect = found && found.isConnected ? measure(found) : null;
			frame = requestAnimationFrame(tick);
		};

		frame = requestAnimationFrame(tick);
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
		};
	});

	/** Move focus to the card on every step so a keyboard user follows along. */
	$effect(() => {
		if (tour.step) card?.focus();
	});

	/**
	 * Place the card below the target, or above when there is no room. Falls back to the
	 * middle of the screen when there is no target at all.
	 */
	const placement = $derived.by(() => {
		// Measured, not estimated: the steps differ in length by enough that a fixed guess
		// puts the card off-screen on the long ones.
		const height = cardHeight || 240;
		const cardWidth = Math.min(380, viewport.width - 32);
		const clampTop = (value: number) =>
			Math.min(Math.max(16, value), Math.max(16, viewport.height - height - 16));

		if (!rect) {
			return {
				centred: true,
				top: clampTop(viewport.height / 2 - height / 2),
				left: Math.max(16, viewport.width / 2 - cardWidth / 2),
				width: cardWidth
			};
		}

		const below = rect.top + rect.height + 12;
		const above = rect.top - height - 12;

		/*
		 * Below, then above, then pinned to the bottom of the screen.
		 *
		 * The third case matters: a target taller than the viewport — the whole projects
		 * list, say — leaves no room on either side, and an earlier version flipped the
		 * card upward into the header where it was half cut off. Overlapping the target is
		 * better than being unreadable.
		 */
		let top: number;
		if (below + height < viewport.height - 16) top = below;
		else if (above > 16) top = above;
		else top = viewport.height - height - 16;

		const left = Math.min(Math.max(16, rect.left), Math.max(16, viewport.width - cardWidth - 16));

		return { centred: false, top: clampTop(top), left, width: cardWidth };
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			tour.end();
		} else if (event.key === 'ArrowRight' || event.key === 'Enter') {
			event.preventDefault();
			tour.next();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			tour.back();
		}
	}
</script>

{#if step}
	<!--
		The backdrop is a plain element, not a <dialog>: the point of a tour is that you
		can see the application underneath it, and `showModal` renders everything else
		inert and behind an opaque top layer.
	-->
	<div
		class="scrim"
		class:has-hole={rect !== null}
		style:--hole-top={`${rect?.top ?? 0}px`}
		style:--hole-left={`${rect?.left ?? 0}px`}
		style:--hole-width={`${rect?.width ?? 0}px`}
		style:--hole-height={`${rect?.height ?? 0}px`}
		aria-hidden="true"
		data-testid="tour-scrim"
	></div>

	<div
		bind:this={card}
		bind:clientHeight={cardHeight}
		class="card"
		class:centred={placement.centred}
		style:top={`${placement.top}px`}
		style:left={`${placement.left}px`}
		style:width={`${placement.width}px`}
		role="dialog"
		aria-modal="false"
		aria-labelledby="tour-title"
		aria-describedby="tour-body"
		tabindex="-1"
		onkeydown={onKeydown}
		data-testid="tour-card"
	>
		<p class="count numeric">Step {tour.index + 1} of {tour.total}</p>
		<h2 id="tour-title">{step.title}</h2>
		<p id="tour-body" class="body">{step.body}</p>

		<div class="actions">
			<button
				type="button"
				class="btn btn-sm btn-quiet"
				onclick={() => tour.end()}
				data-testid="tour-skip"
			>
				{tour.isLast ? 'Close' : 'Skip'}
			</button>
			<div class="spacer"></div>
			{#if !tour.isFirst}
				<button
					type="button"
					class="btn btn-sm"
					onclick={() => tour.back()}
					data-testid="tour-back"
				>
					Back
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-sm btn-primary"
				onclick={() => tour.next()}
				data-testid="tour-next"
			>
				{tour.isLast ? 'Done' : 'Next'}
			</button>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		background: var(--stone-overlay);
	}

	/*
		The "hole" is a zero-size box wearing an enormous spread shadow, which dims
		everything except the target. Cheaper and crisper than four separate panels, and
		it follows the element without any layout thrash.
	*/
	.scrim.has-hole {
		background: transparent;
		inset: auto;
		top: var(--hole-top);
		left: var(--hole-left);
		width: var(--hole-width);
		height: var(--hole-height);
		border-radius: var(--radius);
		box-shadow: 0 0 0 100vmax var(--stone-overlay);
		outline: 2px solid var(--stone-accent);
		outline-offset: 0;
	}

	.card {
		position: fixed;
		z-index: 81;
		background: var(--stone-surface);
		border: 1px solid var(--stone-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--stone-shadow);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.card:focus {
		outline: none;
	}

	.count {
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--stone-text-faint);
		font-weight: 600;
	}

	h2 {
		font-size: var(--text-md);
	}

	.body {
		font-size: var(--text-sm);
		color: var(--stone-text-muted);
		line-height: 1.55;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.spacer {
		flex: 1;
	}

	@media (max-width: 32rem) {
		.card {
			left: 1rem !important;
			width: calc(100vw - 2rem) !important;
		}
	}
</style>
