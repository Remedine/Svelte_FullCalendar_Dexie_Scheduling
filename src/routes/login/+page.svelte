<!-- src/routes/login/+page.svelte -->
<script lang="ts">
	import { loginWithEmail } from '$lib/db/pb';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db';
	import type { User } from '$lib/db';
	import WelcomeModal from '$lib/components/WelcomeModal.svelte';
	import ForcePhotoUpdate from '$lib/components/ForcePhotoUpdate.svelte';

	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let showWelcome = $state(false);
	let welcomeUser = $state<User | null>(null);

	// Separate force-photo gate (can appear after Welcome password step for new crew,
	// or directly on login for verified users where an admin set forcePhotoUpdate).
	let showForcePhoto = $state(false);
	let forcePhotoUser = $state<User | null>(null);

	function userNeedsPhoto(user: User): boolean {
		if (!user.forcePhotoUpdate) return false;
		const photo = user.photo?.trim();
		return !photo;
	}

	async function handleLogin() {
		isLoading = true;
		error = '';

		try {
			const normalizedEmail = (email || '').trim().toLowerCase();
			const { localUser } = await loginWithEmail(normalizedEmail, password);
			email = normalizedEmail;

			// Separate gates:
			// - !verified → WelcomeModal (temp password → real password + verified flag)
			// - verified + forcePhotoUpdate → ForcePhotoUpdate modal
			// PB verified is source of truth (mergeAuthUserIntoLocal); local false only applies
			// when PB has not yet marked the account verified (temp-password first login).
			if (localUser.verified === false) {
				welcomeUser = localUser;
				showWelcome = true;
			} else if (userNeedsPhoto(localUser)) {
				forcePhotoUser = localUser;
				showForcePhoto = true;
			} else {
				goto('/calendar', { replaceState: true });
			}
		} catch (err: any) {
			const pbData = err?.response?.data;
			error = pbData?.password?.message || pbData?.email?.message || err?.message || 'Login failed';
			console.error('Login attempt failed:', err);
		} finally {
			isLoading = false;
		}
	}

	// Re-check Dexie after WelcomeModal completes (the Welcome step only sets verified, not forcePhotoUpdate).
	async function checkPhotoRequirementAndContinue() {
		const currentEmail = (email || '').trim().toLowerCase();
		if (!currentEmail) {
			goto('/calendar', { replaceState: true });
			return;
		}

		try {
			let fresh = await db.users.where('email').equalsIgnoreCase(currentEmail).first();

			if (!fresh) {
				const guess = currentEmail.split('@')[0];
				fresh =
					(await db.users.where('firstName').equalsIgnoreCase(guess).first()) ||
					(await db.users.where('name').equalsIgnoreCase(guess).first());
			}

			if (fresh && userNeedsPhoto(fresh)) {
				forcePhotoUser = fresh;
				showForcePhoto = true;
			} else {
				goto('/calendar', { replaceState: true });
			}
		} catch {
			goto('/calendar', { replaceState: true });
		}
	}
</script>

<div class="login-page">
	{#if !showWelcome && !showForcePhoto}
		<div class="login-card">
			<h1 class="login-card__title">CapitalCity Windows</h1>
			<p class="login-card__subtitle">Crew Login</p>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleLogin();
				}}
				class="login-form"
			>
				<div class="login-form__field">
					<label for="login-email" class="login-form__label">Email</label>
					<input
						id="login-email"
						type="email"
						class="login-form__input"
						bind:value={email}
						placeholder="you@company.com"
						autocomplete="email"
						required
					/>
				</div>

				<div class="login-form__field">
					<label for="login-password" class="login-form__label">Password</label>
					<input
						id="login-password"
						type="password"
						class="login-form__input"
						bind:value={password}
						placeholder="••••••••"
						autocomplete="current-password"
						required
					/>
				</div>

				{#if error}
					<p class="login-form__error">{error}</p>
				{/if}

				<button type="submit" class="login-form__btn" disabled={isLoading}>
					{isLoading ? 'Logging in...' : 'Login'}
				</button>
			</form>

			<p class="login-card__help">Sign in with your email and password.</p>
		</div>
	{/if}

	{#if showWelcome && welcomeUser}
		<WelcomeModal
			user={welcomeUser}
			onClose={() => {
				showWelcome = false;
				welcomeUser = null;
				checkPhotoRequirementAndContinue();
			}}
		/>
	{/if}

	{#if showForcePhoto && forcePhotoUser}
		<ForcePhotoUpdate
			user={forcePhotoUser}
			onClose={() => {
				showForcePhoto = false;
				forcePhotoUser = null;
				goto('/calendar', { replaceState: true });
			}}
		/>
	{/if}
</div>

<style>
	/* Login now uses the global design tokens (cohesive with the rest of the app overhaul).
	   Gradient kept tasteful; falls back gracefully in dark via the surface/primary tokens if needed. */
	.login-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, var(--color-primary-emphasis), var(--color-primary));
		padding: var(--space-4);
	}

	.login-card {
		background: var(--color-surface);
		width: 100%;
		max-width: 380px;
		border-radius: var(--radius-xl);
		padding: var(--space-8) var(--space-6);
		box-shadow: var(--shadow-lg);
		text-align: center;
	}

	/* Mobile: tighter card padding on small screens for cohesion with the rest of the app. */
	@media (max-width: 380px) {
		.login-card {
			padding: var(--space-6) var(--space-4);
		}
	}

	.login-card__title {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-primary-emphasis);
		margin: 0 0 var(--space-1);
	}

	.login-card__subtitle {
		color: var(--color-text-muted);
		margin-bottom: var(--space-8);
	}

	.login-form__field {
		margin-bottom: var(--space-5);
		text-align: left;
	}

	.login-form__label {
		display: block;
		margin-bottom: var(--space-2);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
	}

	.login-form__input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		font-size: var(--font-size-lg);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.login-form__input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}

	.login-form__btn {
		width: 100%;
		padding: var(--space-4);
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-lg);
		cursor: pointer;
		margin-top: var(--space-2);
		transition: background var(--transition-fast);
	}

	.login-form__btn:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.login-form__error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin: var(--space-3) 0;
		text-align: center;
	}

	.login-card__help {
		margin-top: var(--space-6);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
</style>