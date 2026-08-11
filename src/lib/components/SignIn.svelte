<script lang="ts">
	import Icon from './Icon.svelte';
	import { MIN_PASSWORD_LENGTH } from '$lib/domain/credentials';
	import { account } from '$lib/stores/account.svelte';

	/**
	 * The gate. Shown instead of the app when nobody is signed in.
	 *
	 * One form for both signing in and signing up, because the difference between "I have
	 * an account" and "I do not" is not a decision worth a separate screen — and getting
	 * it wrong should cost a click, not a navigation.
	 */
	let mode = $state<'sign-in' | 'sign-up'>('sign-in');
	let email = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	const isSignUp = $derived(mode === 'sign-up');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		busy = true;
		error = null;
		try {
			if (isSignUp) await account.signUp(email, password);
			else await account.signIn(email, password);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'That did not work.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="gate">
	<div class="card panel">
		<div class="brand">
			<Icon name="cairn" size={28} />
			<h1>Cairn</h1>
		</div>

		<p class="muted">
			{isSignUp
				? 'One account keeps your projects, dates and inbox the same on every device.'
				: 'Sign in to pick up where the other device left off.'}
		</p>

		<form onsubmit={submit}>
			<div class="field">
				<label for="email">Email</label>
				<input
					id="email"
					class="input"
					type="email"
					bind:value={email}
					autocomplete="username"
					required
					data-testid="auth-email"
				/>
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					class="input"
					type="password"
					bind:value={password}
					autocomplete={isSignUp ? 'new-password' : 'current-password'}
					required
					data-testid="auth-password"
				/>
				{#if isSignUp}
					<p class="small faint">
						At least {MIN_PASSWORD_LENGTH} characters. Length beats punctuation — and there is no password
						reset yet, so pick something you will not lose.
					</p>
				{/if}
			</div>

			{#if error}
				<p class="error small" role="alert" data-testid="auth-error">{error}</p>
			{/if}

			<button
				type="submit"
				class="btn btn-primary submit"
				disabled={busy}
				data-testid="auth-submit"
			>
				{busy ? 'One moment…' : isSignUp ? 'Create account' : 'Sign in'}
			</button>
		</form>

		<button
			type="button"
			class="btn btn-quiet switch"
			onclick={() => {
				mode = isSignUp ? 'sign-in' : 'sign-up';
				error = null;
			}}
			data-testid="auth-switch"
		>
			{isSignUp ? 'I already have an account' : 'Create an account instead'}
		</button>
	</div>

	<p class="colophon small faint">
		Your data is stored on Cairn's own server so it can reach your other devices. It is not shared,
		sold, or analysed, and you can export all of it at any time.
	</p>
</div>

<style>
	.gate {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: var(--space-5);
	}

	.panel {
		width: min(24rem, 100%);
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.brand h1 {
		font-size: var(--text-lg);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.field .small {
		margin-top: var(--space-2);
	}

	.submit {
		width: 100%;
	}

	.switch {
		align-self: center;
	}

	.error {
		color: var(--stone-attention);
	}

	.colophon {
		max-width: 24rem;
		text-align: center;
	}
</style>
