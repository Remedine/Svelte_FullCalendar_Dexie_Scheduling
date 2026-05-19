<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let username = $state('');
	let pin = $state('');
	let error = $state('');
	let isLoading = $state(false);

	let authModule: any = null;

	onMount(async () => {
		authModule = await import('$lib/stores/auth.svelte.ts');

		// )=- Access via wrapped object
		if (authModule.auth.currentUser) {
			goto('/calendar');
		}
	});

	async function handleLogin() {
		if (!authModule) {
			error = 'Auth module not loaded yet';
			return;
		}

		if (!username || pin.length !== 4) {
			error = 'Please enter name and 4-digit PIN';
			return;
		}

		isLoading = true;
		error = '';

		const result = await authModule.login(username, pin);

		if (result.success) {
			goto('/calendar');
		} else {
			error = result.message || 'Login failed';
			pin = '';
		}

		isLoading = false;
	}
</script>

<!-- Rest of your template stays exactly the same -->

<div class="login-page">
	<div class="login-card">
		<h1 class="login-card__title">CapitalCity Windows</h1>
		<p class="login-card__subtitle">Crew Login</p>

		<form 
			onsubmit={(e) => { e.preventDefault(); handleLogin(); }} 
			class="login-form"
		>
			<div class="login-form__field">
				<label class="login-form__label">Name</label>
				<input 
					type="text" 
					class="login-form__input"
					bind:value={username}
					placeholder="e.g. Mike Thompson"
				/>
			</div>

			<div class="login-form__field">
				<label class="login-form__label">4-Digit PIN</label>
				<input 
					type="password" 
					class="login-form__input"
					bind:value={pin}
					maxlength="4"
					inputmode="numeric"
					placeholder="••••"
				/>
			</div>

			{#if error}
				<p class="login-form__error">{error}</p>
			{/if}

			<button 
				type="submit"
				class="login-form__btn"
				disabled={isLoading || !username || pin.length !== 4}
			>
				{isLoading ? 'Logging in...' : 'Login'}
			</button>
		</form>

		<p class="login-card__help">Ask admin for your PIN</p>
	</div>
</div>

<style>
	/* (your existing styles can stay the same) */
	.login-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #1e3a8a, #3b82f6);
		padding: 1rem;
	}

	.login-card {
		background: white;
		width: 100%;
		max-width: 380px;
		border-radius: 16px;
		padding: 2rem 1.5rem;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
		text-align: center;
	}

	.login-card__title {
		font-size: 1.75rem;
		font-weight: 700;
		color: #1e3a8a;
		margin: 0 0 0.25rem;
	}

	.login-card__subtitle {
		color: #64748b;
		margin-bottom: 2rem;
	}

	.login-form__field {
		margin-bottom: 1.25rem;
		text-align: left;
	}

	.login-form__label {
		display: block;
		margin-bottom: 0.35rem;
		font-weight: 500;
		color: #334155;
	}

	.login-form__input {
		width: 100%;
		padding: 0.85rem 1rem;
		border: 2px solid #e2e8f0;
		border-radius: 8px;
		font-size: 1.1rem;
	}

	.login-form__btn {
		width: 100%;
		padding: 1rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 1.1rem;
		cursor: pointer;
		margin-top: 0.5rem;
	}

	.login-form__error {
		color: #ef4444;
		font-size: 0.95rem;
		margin: 0.75rem 0;
		text-align: center;
	}

	.login-card__help {
		margin-top: 1.5rem;
		color: #64748b;
		font-size: 0.9rem;
	}
</style>