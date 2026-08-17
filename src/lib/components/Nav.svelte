<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { app } from '$lib/stores/app.svelte';
	import type { AppRoute } from '$lib/routes';
	import Icon, { type IconName } from './Icon.svelte';

	interface NavItem {
		href: AppRoute;
		label: string;
		icon: IconName;
		/** Count shown beside the label. Never rendered when zero. */
		count?: number;
	}

	/**
	 * Five places, each answering one question: Today (what now?), Projects (what am I
	 * moving?), Dates (what arrives?), Inbox (what did I jot down?), Review (weekly
	 * reset). Counts appear only for the inbox and only when there is something in it.
	 *
	 * There is deliberately no badge for overdue anything. A permanent red number is the
	 * mechanic that turns one missed week into a deleted app, and the product's whole
	 * position is the opposite of that.
	 */
	let items = $derived<NavItem[]>([
		{ href: '/', label: 'Today', icon: 'today' },
		{ href: '/projects', label: 'Projects', icon: 'projects' },
		{ href: '/manifest', label: 'Dates', icon: 'manifest' },
		{ href: '/inbox', label: 'Inbox', icon: 'inbox', count: app.inbox.length },
		{ href: '/review', label: 'Review', icon: 'review' }
	]);

	function isCurrent(href: AppRoute): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<nav class="nav" aria-label="Main">
	{#each items as item (item.href)}
		<a
			href={resolve(item.href)}
			class="item"
			class:current={isCurrent(item.href)}
			aria-current={isCurrent(item.href) ? 'page' : undefined}
			data-testid={`nav-${item.label.toLowerCase()}`}
		>
			<Icon name={item.icon} />
			<span class="label">{item.label}</span>
			{#if item.count}
				<span class="count numeric" aria-label={`${item.count} waiting`}>{item.count}</span>
			{/if}
		</a>
	{/each}
</nav>

<style>
	.nav {
		display: flex;
		gap: var(--space-1);
	}

	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0.4375rem 0.75rem;
		border-radius: var(--radius);
		color: var(--stone-text-muted);
		text-decoration: none;
		font-size: var(--text-sm);
		font-weight: 500;
		transition: background var(--duration) var(--ease);
	}

	.item:hover {
		background: var(--stone-sunken);
		color: var(--stone-text);
	}

	.item.current {
		color: var(--stone-text);
		background: var(--stone-sunken);
	}

	.count {
		font-size: var(--text-xs);
		min-width: 1.125rem;
		height: 1.125rem;
		padding-inline: 0.25rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: var(--stone-accent-soft);
		color: var(--stone-accent-text);
	}

	/* Bottom tab bar on small screens: icons stacked over labels, full width. */
	@media (max-width: 47.999rem) {
		.nav {
			gap: 0;
		}

		.item {
			flex: 1;
			flex-direction: column;
			gap: 0.125rem;
			padding: var(--space-2) var(--space-1);
			font-size: var(--text-xs);
			border-radius: var(--radius-sm);
			position: relative;
		}

		/*
			Colour alone must not carry the "you are here" signal. On the tab bar the
			current item also gets a weight change and a marker above the icon, so it reads
			without colour vision and in a high-contrast mode that flattens the palette.
		*/
		.item.current {
			background: transparent;
			color: var(--stone-accent-text);
			font-weight: 600;
		}

		.item.current::before {
			content: '';
			position: absolute;
			top: 0;
			left: 50%;
			transform: translateX(-50%);
			width: 1.25rem;
			height: 2px;
			border-radius: 0 0 2px 2px;
			background: currentColor;
		}

		.count {
			position: absolute;
			top: 0.1875rem;
			left: 50%;
			margin-left: 0.25rem;
		}
	}
</style>
