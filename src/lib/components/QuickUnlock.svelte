<script lang="ts">
	import { onMount } from 'svelte';
	import { unlockApp } from '$lib/stores/auth.svelte';
	import PinInput from '$lib/components/PinInput.svelte';
	import {
		MAX_PIN_ATTEMPTS,
		disableQuickUnlock,
		getDeviceAuthSettings,
		getPinAttemptsRemaining,
		hasUsableUnlockMethod,
		unlockWithBiometric,
		verifyPinUnlock
	} from '$lib/auth/deviceUnlock';
	import type { DeviceAuthSettings } from '$lib/auth/deviceUnlock';

	let pin = $state('');
	let error = $state('');
	let bioLoading = $state(false);
	let pinLoading = $state(false);
	let pinResetKey = $state(0);
	let attemptsRemaining = $state(MAX_PIN_ATTEMPTS);
	let settings = $state<DeviceAuthSettings | null | undefined>(undefined);
	let bioAutoAttempted = $state(false);

	const settingsReady = $derived(settings !== undefined);
	const pinLockedOut = $derived(attemptsRemaining <= 0);
	const pinAvailable = $derived(!!settings?.pinEnabled && !!settings?.pinHash);
	const bioAvailable = $derived(
		!!settings?.biometricEnabled && !!settings?.biometricCredentialId
	);

	$effect(() => {
		void (async () => {
			const s = await getDeviceAuthSettings();
			settings = s;
			attemptsRemaining = getPinAttemptsRemaining();

			if (s && !hasUsableUnlockMethod(s)) {
				await disableQuickUnlock();
				unlockApp();
			}
		})();
	});

	// Prevent browser back from bypassing the lock overlay.
	onMount(() => {
		const lockState = { ccwLocked: true };
		history.pushState(lockState, '');

		const onPopState = (event: PopStateEvent) => {
			if (event.state?.ccwLocked) return;
			history.pushState(lockState, '');
		};

		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	});

	$effect(() => {
		if (!settingsReady || !bioAvailable || bioAutoAttempted || pinLockedOut) return;
		bioAutoAttempted = true;
		void tryBiometric(true);
	});

	async function tryBiometric(silent = false) {
		if (pinLockedOut || !bioAvailable) return;
		bioLoading = true;
		if (!silent) error = '';
		try {
			const ok = await unlockWithBiometric();
			if (ok) {
				pin = '';
				unlockApp();
			} else if (!silent) {
				error = 'Biometric unlock failed. Try your PIN or sign in again.';
			}
		} catch (e: any) {
			if (!silent) {
				error = e?.message || 'Biometric unlock unavailable';
			}
		} finally {
			bioLoading = false;
		}
	}

	async function tryPin(code: string) {
		if (pinLockedOut) {
			error = 'Too many incorrect PIN attempts. Sign in with email instead.';
			return;
		}
		pinLoading = true;
		error = '';
		try {
			const result = await verifyPinUnlock(code);
			attemptsRemaining = result.ok ? MAX_PIN_ATTEMPTS : result.remaining;

			if (result.ok) {
				pin = '';
				unlockApp();
			} else if (result.lockedOut) {
				error = 'Too many incorrect PIN attempts. Sign in with email instead.';
				pinResetKey++;
			} else {
				error =
					result.remaining === 1
						? 'Incorrect PIN. One attempt remaining.'
						: `Incorrect PIN. ${result.remaining} attempts remaining.`;
				pinResetKey++;
			}
		} finally {
			pinLoading = false;
		}
	}

	async function useFullLogin() {
		const { logout } = await import('$lib/stores/auth.svelte');
		const { goto } = await import('$app/navigation');
		await logout();
		goto('/login', { replaceState: true });
	}

	const loading = $derived(bioLoading || pinLoading);
</script>

<div class="quick-unlock" role="dialog" aria-modal="true" aria-labelledby="quick-unlock-title">
	<div class="quick-unlock__card">
		<h2 id="quick-unlock-title" class="quick-unlock__title">Unlock app</h2>

		{#if !settingsReady}
			<p class="quick-unlock__subtitle">Loading…</p>
		{:else if pinLockedOut}
			<p class="quick-unlock__subtitle">
				PIN entry is locked. Sign in with your email and password.
			</p>
		{:else if bioAvailable && pinAvailable}
			<p class="quick-unlock__subtitle">Use fingerprint, Face ID, or your 4-digit PIN</p>
		{:else if bioAvailable}
			<p class="quick-unlock__subtitle">Confirm with fingerprint or Face ID</p>
		{:else if pinAvailable}
			<p class="quick-unlock__subtitle">Enter your 4-digit PIN to continue</p>
		{:else}
			<p class="quick-unlock__subtitle">Quick unlock is not configured on this device.</p>
		{/if}

		{#if settingsReady}
			{#if bioAvailable && !pinLockedOut}
				<button
					type="button"
					class="quick-unlock__bio-btn"
					onclick={() => tryBiometric(false)}
					disabled={loading}
				>
					{bioLoading ? 'Checking…' : 'Use fingerprint / Face ID'}
				</button>
			{/if}

			{#if bioAvailable && pinAvailable && !pinLockedOut}
				<p class="quick-unlock__or">or</p>
			{/if}

			{#if pinAvailable && !pinLockedOut}
				<div class="quick-unlock__pin-wrap">
					<p class="quick-unlock__label">Quick PIN</p>
					<PinInput
						bind:value={pin}
						disabled={loading}
						hasError={!!error}
						resetKey={pinResetKey}
						onComplete={tryPin}
					/>
				</div>
			{/if}

			{#if error}
				<p class="quick-unlock__error" role="alert">{error}</p>
			{/if}

			<button type="button" class="quick-unlock__fallback" onclick={useFullLogin} disabled={loading}>
				Sign in with email instead
			</button>
		{/if}
	</div>
</div>

<style>
	.quick-unlock {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, var(--color-primary-emphasis), var(--color-primary));
		padding: var(--space-4);
	}

	.quick-unlock__card {
		width: 100%;
		max-width: 360px;
		background: var(--color-surface);
		border-radius: var(--radius-xl);
		padding: var(--space-8) var(--space-6);
		box-shadow: var(--shadow-lg);
		text-align: center;
	}

	.quick-unlock__title {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-2xl);
		color: var(--color-primary-emphasis);
	}

	.quick-unlock__subtitle {
		margin: 0 0 var(--space-6);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.quick-unlock__bio-btn {
		width: 100%;
		padding: var(--space-4);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-primary);
		color: white;
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}

	.quick-unlock__bio-btn:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.quick-unlock__bio-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.quick-unlock__or {
		margin: var(--space-4) 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.quick-unlock__pin-wrap {
		margin-bottom: var(--space-2);
	}

	.quick-unlock__label {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.quick-unlock__error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin: var(--space-3) 0 0;
	}

	.quick-unlock__fallback {
		margin-top: var(--space-5);
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		text-decoration: underline;
		cursor: pointer;
	}

	.quick-unlock__fallback:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>