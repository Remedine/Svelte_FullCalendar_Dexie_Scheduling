<!-- src/routes/login/+page.svelte -->
<script lang="ts">
	import { loginWithEmail, loginWithPasskey, requestPasswordReset } from '$lib/db/pb';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db';
	import type { User } from '$lib/db';
	import WelcomeModal from '$lib/components/WelcomeModal.svelte';
	import ForcePhotoUpdate from '$lib/components/ForcePhotoUpdate.svelte';
	import { canUsePasskeys } from '$lib/auth/passkeys';
	import {
		canOfferQuickUnlockToastAfterLogin,
		shouldOfferQuickUnlockSetup,
		userNeedsPhotoOnboarding,
		userNeedsWelcomeOnboarding
	} from '$lib/auth/deviceUnlock';
	import { toast } from '$lib/stores/toast.svelte';
	import { page } from '$app/state';
	import { getLastLoginEmail } from '$lib/auth/sessionPersist';
	import { auth } from '$lib/stores/auth.svelte';

	let email = $state(getLastLoginEmail());
	let password = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let showForgotPassword = $state(false);
	let forgotEmail = $state('');
	let forgotLoading = $state(false);
	let forgotError = $state('');
	let forgotSuccess = $state(false);
	let showWelcome = $state(false);
	let welcomeUser = $state<User | null>(null);

	// Separate force-photo gate (can appear after Welcome password step for new crew,
	// or directly on login for verified users where an admin set forcePhotoUpdate).
	let showForcePhoto = $state(false);
	let forcePhotoUser = $state<User | null>(null);
	const passkeysAvailable = $derived(canUsePasskeys());
	const sessionExpiredNotice = $derived(
		page.url.searchParams.get('session') === 'expired'
			? 'Session timed out. Sign in again — email remembered.'
			: ''
	);
	const rememberedEmailHint = $derived(
		!sessionExpiredNotice && email ? 'Email prefilled from your last sign-in.' : ''
	);

	// Session may restore after a PWA foreground retry — return to the app (quick unlock if needed).
	$effect(() => {
		if (auth.loading) return;
		if (auth.isAuthenticated && auth.currentUser) {
			goto('/calendar', { replaceState: true });
		}
	});

	let loginRestoreAttempted = $state(false);
	$effect(() => {
		if (auth.loading || auth.isAuthenticated || loginRestoreAttempted) return;
		loginRestoreAttempted = true;
		void import('$lib/auth/sessionPersist').then(async ({ hasRestorableSession }) => {
			if (await hasRestorableSession()) {
				const { restoreSession } = await import('$lib/stores/auth.svelte');
				await restoreSession({ retry: true });
			}
		});
	});

	async function lookupFreshUser(fallback?: User | null): Promise<User | null> {
		const currentEmail = (email || '').trim().toLowerCase();
		if (!currentEmail) return fallback ?? null;

		try {
			let fresh = await db.users.where('email').equalsIgnoreCase(currentEmail).first();

			if (!fresh) {
				const guess = currentEmail.split('@')[0];
				fresh =
					(await db.users.where('firstName').equalsIgnoreCase(guess).first()) ||
					(await db.users.where('name').equalsIgnoreCase(guess).first());
			}

			return fresh ?? fallback ?? null;
		} catch {
			return fallback ?? null;
		}
	}

	async function finishLoginToApp(user: User | null, offerQuickUnlockToast: boolean) {
		goto('/calendar', { replaceState: true });
		if (!user || !offerQuickUnlockToast || !canOfferQuickUnlockToastAfterLogin(user)) return;
		const showQuickUnlockHint = await shouldOfferQuickUnlockSetup(String(user.id));
		if (showQuickUnlockHint) {
			toast.showWithAction('Click here to set a quick login PIN', () => {
				goto('/profile?quickUnlock=setup');
			});
		}
	}

	type ContinueAfterAuthOptions = {
		/** User chose "Later" on ForcePhotoUpdate — enter app without re-showing photo modal or toast. */
		deferPhoto?: boolean;
	};

	function openForgotPassword() {
		forgotEmail = (email || '').trim().toLowerCase();
		forgotError = '';
		forgotSuccess = false;
		showForgotPassword = true;
	}

	function closeForgotPassword() {
		showForgotPassword = false;
		forgotError = '';
		forgotSuccess = false;
	}

	async function handleForgotPassword() {
		forgotLoading = true;
		forgotError = '';
		forgotSuccess = false;

		try {
			await requestPasswordReset(forgotEmail);
			forgotSuccess = true;
		} catch (err: any) {
			forgotError = err?.message || 'Failed to send reset email. Please try again.';
			console.error('Password reset request failed:', err);
		} finally {
			forgotLoading = false;
		}
	}

	async function continueAfterAuth(localUser: User, options: ContinueAfterAuthOptions = {}) {
		if (userNeedsWelcomeOnboarding(localUser)) {
			welcomeUser = localUser;
			showWelcome = true;
			return;
		}
		if (!options.deferPhoto && userNeedsPhotoOnboarding(localUser)) {
			forcePhotoUser = localUser;
			showForcePhoto = true;
			return;
		}
		const offerToast =
			!options.deferPhoto && canOfferQuickUnlockToastAfterLogin(localUser);
		await finishLoginToApp(localUser, offerToast);
	}

	async function handlePasskeyLogin() {
		isLoading = true;
		error = '';

		const loginUiTimeout = setTimeout(() => {
			if (isLoading) {
				isLoading = false;
				error = 'Passkey sign-in is taking too long. Try email and password instead.';
			}
		}, 45_000);

		try {
			const normalizedEmail = (email || '').trim().toLowerCase();
			if (!normalizedEmail) {
				clearTimeout(loginUiTimeout);
				error = 'Enter your email, then use passkey sign-in';
				isLoading = false;
				return;
			}
			const { localUser } = await loginWithPasskey(normalizedEmail);
			clearTimeout(loginUiTimeout);
			email = normalizedEmail;
			isLoading = false;
			await continueAfterAuth(localUser);
		} catch (err: any) {
			clearTimeout(loginUiTimeout);
			error = err?.message || 'Passkey sign-in failed';
			isLoading = false;
		}
	}

	async function handleLogin() {
		isLoading = true;
		error = '';

		const loginUiTimeout = setTimeout(() => {
			if (isLoading) {
				isLoading = false;
				error =
					'Login is taking too long. Check your mobile connection and try again.';
			}
		}, 45_000);

		try {
			const normalizedEmail = (email || '').trim().toLowerCase();
			const { localUser } = await loginWithEmail(normalizedEmail, password);
			clearTimeout(loginUiTimeout);
			email = normalizedEmail;
			isLoading = false;

			// Separate gates:
			// - !verified → WelcomeModal (temp password → real password + verified flag)
			// - verified + forcePhotoUpdate → ForcePhotoUpdate modal
			// PB verified is source of truth (mergeAuthUserIntoLocal); local false only applies
			// when PB has not yet marked the account verified (temp-password first login).
			await continueAfterAuth(localUser);
		} catch (err: any) {
			clearTimeout(loginUiTimeout);
			const pbData = err?.response?.data;
			error = pbData?.password?.message || pbData?.email?.message || err?.message || 'Login failed';
			console.error('Login attempt failed:', err);
			isLoading = false;
		}
	}

	// Re-check Dexie after WelcomeModal completes, then run the same post-auth gates.
	async function checkPhotoRequirementAndContinue() {
		const fresh = await lookupFreshUser();
		if (fresh) {
			await continueAfterAuth(fresh);
		} else {
			await finishLoginToApp(null, false);
		}
	}

	async function handleForcePhotoClose() {
		const fallback = forcePhotoUser;
		showForcePhoto = false;
		forcePhotoUser = null;

		const fresh = await lookupFreshUser(fallback);
		if (!fresh) {
			await finishLoginToApp(null, false);
			return;
		}

		const deferPhoto = userNeedsPhotoOnboarding(fresh);
		await continueAfterAuth(fresh, { deferPhoto });
	}
</script>

<div class="login-page">
	{#if !showWelcome && !showForcePhoto}
		<div class="login-card">
			<h1 class="login-card__title">CapitalCity Windows</h1>
			<p class="login-card__subtitle">
				{showForgotPassword ? 'Reset Password' : 'Crew Login'}
			</p>

			{#if sessionExpiredNotice && !showForgotPassword}
				<p class="login-form__notice">{sessionExpiredNotice}</p>
			{:else if rememberedEmailHint && !showForgotPassword}
				<p class="login-form__notice login-form__notice--subtle">{rememberedEmailHint}</p>
			{/if}

			{#if showForgotPassword}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleForgotPassword();
					}}
					class="login-form"
				>
					<p class="login-forgot__intro">
						Enter your email and we'll send you a link to reset your password.
					</p>

					<div class="login-form__field">
						<label for="forgot-email" class="login-form__label">Email</label>
						<input
							id="forgot-email"
							type="email"
							class="login-form__input"
							bind:value={forgotEmail}
							placeholder="you@company.com"
							autocomplete="email"
							required
							disabled={forgotLoading || forgotSuccess}
						/>
					</div>

					{#if forgotError}
						<p class="login-form__error">{forgotError}</p>
					{/if}

					{#if forgotSuccess}
						<p class="login-forgot__success">
							If an account exists for that email, you'll receive reset instructions shortly.
							Check your inbox and spam folder.
						</p>
					{/if}

					<button
						type="submit"
						class="login-form__btn"
						disabled={forgotLoading || forgotSuccess}
					>
						{forgotLoading ? 'Sending...' : 'Send reset link'}
					</button>

					<button
						type="button"
						class="login-forgot__back"
						onclick={closeForgotPassword}
						disabled={forgotLoading}
					>
						Back to login
					</button>
				</form>
			{:else}
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
						<div class="login-form__label-row">
							<label for="login-password" class="login-form__label">Password</label>
							<button
								type="button"
								class="login-form__forgot-link"
								onclick={openForgotPassword}
							>
								Forgot password?
							</button>
						</div>
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

				{#if passkeysAvailable}
					<button
						type="button"
						class="login-form__passkey-btn"
						onclick={handlePasskeyLogin}
						disabled={isLoading}
					>
						Sign in with passkey
					</button>
				{/if}
			</form>

			<p class="login-card__help login-card__help--desktop">
				Sign in with email and password.
				{#if passkeysAvailable}
					Passkeys are for signing in — optional device PIN / fingerprint unlock can be set in Profile.
				{/if}
			</p>
			{/if}
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
		<ForcePhotoUpdate user={forcePhotoUser} onClose={handleForcePhotoClose} />
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

	@media (max-width: 768px) {
		.login-page {
			min-height: 100dvh;
			padding: max(var(--space-2), env(safe-area-inset-top, 0px))
				max(var(--space-3), env(safe-area-inset-right, 0px))
				max(var(--space-2), env(safe-area-inset-bottom, 0px))
				max(var(--space-3), env(safe-area-inset-left, 0px));
		}

		.login-card {
			padding: var(--space-4) var(--space-4);
			border-radius: var(--radius-lg);
		}

		.login-card__title {
			font-size: var(--font-size-2xl);
			margin-bottom: 0;
		}

		.login-card__subtitle {
			margin-bottom: var(--space-3);
			font-size: var(--font-size-sm);
		}

		.login-form__field {
			margin-bottom: var(--space-3);
		}

		.login-form__label {
			margin-bottom: var(--space-1);
			font-size: var(--font-size-sm);
		}

		.login-form__input {
			padding: var(--space-2) var(--space-3);
			font-size: var(--font-size-base);
		}

		.login-form__btn {
			padding: var(--space-3);
			font-size: var(--font-size-base);
			margin-top: var(--space-1);
		}

		.login-form__passkey-btn {
			padding: var(--space-2);
			margin-top: var(--space-2);
		}

		.login-form__notice {
			margin: 0 0 var(--space-3);
			padding: var(--space-2);
			font-size: var(--font-size-xs);
			line-height: 1.35;
		}

		.login-form__notice--subtle {
			display: none;
		}

		.login-form__error {
			margin: var(--space-2) 0;
		}

		.login-card__help--desktop {
			display: none;
		}

		.login-forgot__intro,
		.login-forgot__success {
			font-size: var(--font-size-xs);
			line-height: 1.35;
		}

		.login-forgot__intro {
			margin-bottom: var(--space-3);
		}

		.login-forgot__success {
			padding: var(--space-2);
		}

		.login-forgot__back {
			margin-top: var(--space-2);
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

	.login-form__label-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.login-form__label-row .login-form__label {
		margin-bottom: 0;
	}

	.login-form__forgot-link {
		border: none;
		background: none;
		padding: 0;
		font-size: var(--font-size-sm);
		color: var(--color-primary);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.login-form__forgot-link:hover {
		color: var(--color-primary-hover);
	}

	.login-forgot__intro {
		margin: 0 0 var(--space-5);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: 1.5;
		text-align: left;
	}

	.login-forgot__success {
		margin: var(--space-3) 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		line-height: 1.5;
		text-align: left;
	}

	.login-forgot__back {
		display: block;
		width: 100%;
		margin-top: var(--space-4);
		padding: var(--space-2);
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.login-forgot__back:hover:not(:disabled) {
		color: var(--color-text);
	}

	.login-forgot__back:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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

	.login-form__passkey-btn {
		width: 100%;
		padding: var(--space-3);
		margin-top: var(--space-3);
		border: 2px solid var(--color-primary);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-primary);
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.login-form__passkey-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
	}

	.login-form__error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin: var(--space-3) 0;
		text-align: center;
	}

	.login-form__notice {
		margin: calc(-1 * var(--space-4)) 0 var(--space-5);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: 1.45;
		text-align: left;
	}

	.login-form__notice--subtle {
		background: transparent;
		padding: 0;
		margin-bottom: var(--space-4);
	}

	.login-card__help {
		margin-top: var(--space-6);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: 1.4;
	}
</style>