<!-- src/routes/login/+page.svelte -->
<script lang="ts">
	// )=- Completely removed PIN login option (per user request). Now ONLY email/password via PocketBase authWithPassword.
	// No tabs, no PIN fields, no activeTab, no pinLogin import or forcePin redirects.
	// handleLogin does email path + Dexie lookup + setCurrentUser + goto('/calendar').
	// Layout + auth store provide the single source of truth (no more dual auth paths).
	// BEM classes preserved on the form (login-card, login-form__*).
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	import { loginWithEmail } from '$lib/db/pb';
	import { goto } from '$app/navigation';
	import { setCurrentUser } from '$lib/stores/auth.svelte';
	import { db } from '$lib/db';
	import WelcomeModal from '$lib/components/WelcomeModal.svelte';
	import ForcePhotoUpdate from '$lib/components/ForcePhotoUpdate.svelte';

	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let showWelcome = $state(false);
	let welcomeUser = $state<any>(null);

	// Separate force-photo gate (can appear after Welcome password step for new crew,
	// or directly on login for verified users where an admin set forcePhotoUpdate).
	let showForcePhoto = $state(false);
	let forcePhotoUser = $state<any>(null);

	$effect(() => {
		// Auto-redirect if already authenticated via layout/store restore.
	});

	async function handleLogin() {
		isLoading = true;
		error = '';

		try {
			// Email / PB path only. Always normalize to lowercase before PB (case can cause validation/auth errors).
			const normalizedEmail = (email || '').trim().toLowerCase();
			await loginWithEmail(normalizedEmail, password);

			// Sync the PB-authenticated user into the central Dexie-backed store
			// so the UI (nav, guards, role checks) sees a consistent user object.
			// Prefer email lookup (unique). Fallback to firstName or legacy name.
			let cachedUser = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();

			if (!cachedUser) {
				const guess = normalizedEmail.split('@')[0];
				cachedUser =
					(await db.users.where('firstName').equalsIgnoreCase(guess).first()) ||
					(await db.users.where('name').equalsIgnoreCase(guess).first());
			}

			if (!cachedUser) {
				// Fallback to a seeded admin for development if email user not yet in Dexie
				cachedUser = await db.users.where('name').equalsIgnoreCase('admin').first();
			}

			// Keep original email var in sync for any UI display (the normalized one is used for all PB/Dexie logic).
			email = normalizedEmail;

			if (cachedUser) {
				setCurrentUser(cachedUser);
				console.log('✅ User synced to central auth store after PB email login');

				// Separate gates:
				// - !verified → WelcomeModal (temp password → real password + verified flag)
				// - verified + forcePhotoUpdate → ForcePhotoUpdate modal (reusable; can be triggered
				//   without a password change when admin forces a new photo later via Crew).
				// The Welcome onClose will chain into ForcePhoto (if still flagged) so first-time
				// crew get both steps in one flow without re-logging in.
				// Use explicit === false (the marker we set at admin creation time for temp-password crew).
				// After protection in loginWithEmail / pullUsers, already-onboarded users keep verified:true
				// even if later forcePhotoUpdate is set by admin. This prevents "force photo" from also
				// triggering the password Welcome flow.
				if (cachedUser.verified === false) {
					welcomeUser = cachedUser;
					showWelcome = true;
				} else if (cachedUser.forcePhotoUpdate) {
					forcePhotoUser = cachedUser;
					showForcePhoto = true;
				} else {
					goto('/calendar', { replaceState: true });
				}
			} else {
				goto('/calendar', { replaceState: true });
			}
		} catch (err: any) {
			// Surface better messages from PocketBase auth errors (e.g. bad credentials, disabled, etc.)
			const pbData = err?.response?.data;
			error = pbData?.password?.message || pbData?.email?.message || err?.message || 'Login failed';
			console.error('Login attempt failed:', err);
		} finally {
			isLoading = false;
		}
	}

	// Re-check Dexie after WelcomeModal completes (the Welcome step only sets verified, not forcePhotoUpdate).
	// Uses the email $state (which is normalized to lowercase in handleLogin) for lookups.
	// If the flag is still true we show the dedicated photo component immediately.
	async function checkPhotoRequirementAndContinue() {
		const currentEmail = (email || '').trim().toLowerCase();
		if (!currentEmail) {
			goto('/calendar', { replaceState: true });
			return;
		}

		try {
			let fresh = await db.users.where('email').equalsIgnoreCase(currentEmail).first();

			if (!fresh) {
				// Fallbacks (same as handleLogin)
				const guess = currentEmail.split('@')[0];
				fresh =
					(await db.users.where('firstName').equalsIgnoreCase(guess).first()) ||
					(await db.users.where('name').equalsIgnoreCase(guess).first());
			}

			if (fresh && fresh.forcePhotoUpdate) {
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

			<!-- )=- PIN login completely removed. This page is now email/password ONLY.
         No tabs, no activeTab, no pinLogin path, no forcePinUpdate redirects.
         All auth goes through PocketBase authWithPassword (loginWithEmail).
         Layout guards + central auth store handle post-login state.
         )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
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
				// After password+verify step, check Dexie for the (possibly still-set) forcePhotoUpdate flag.
				// This makes the photo step part of the natural first-login flow for new crew without requiring another login.
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
		padding: 0.85rem 1rem;
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
		padding: 1rem;
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
