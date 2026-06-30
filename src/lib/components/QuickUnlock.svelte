<script lang="ts">
	import { unlockApp } from '$lib/stores/auth.svelte';
	import {
		getDeviceAuthSettings,
		unlockWithBiometric,
		verifyPinUnlock
	} from '$lib/auth/deviceUnlock';

	let pin = $state('');
	let error = $state('');
	let bioLoading = $state(false);
	let pinLoading = $state(false);
	let settings = $state<Awaited<ReturnType<typeof getDeviceAuthSettings>>>(null);
	let bioAutoAttempted = $state(false);

	$effect(() => {
		void getDeviceAuthSettings().then((s) => {
			settings = s;
		});
	});

	// )=- Try biometric immediately when the overlay opens (PIN remains fallback).
	$effect(() => {
		if (!settings?.biometricEnabled || bioAutoAttempted) return;
		bioAutoAttempted = true;
		void tryBiometric(true);
	});

	async function tryBiometric(silent = false) {
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

	async function tryPin() {
		if (!pin.trim()) {
			error = 'Enter your PIN';
			return;
		}
		pinLoading = true;
		error = '';
		try {
			const ok = await verifyPinUnlock(pin);
			if (ok) {
				pin = '';
				unlockApp();
			} else {
				error = 'Incorrect PIN';
				pin = '';
			}
		} finally {
			pinLoading = false;
		}
	}

	function onPinInput() {
		error = '';
		if (pin.length >= 4 && settings?.pinEnabled) {
			void tryPin();
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

<div class="quick-unlock">
	<div class="quick-unlock__card">
		<h2 class="quick-unlock__title">Unlock app</h2>
		<p class="quick-unlock__subtitle">
			{#if settings?.biometricEnabled && settings?.pinEnabled}
				Use fingerprint, Face ID, or your quick PIN
			{:else if settings?.biometricEnabled}
				Confirm with fingerprint or Face ID
			{:else}
				Enter your quick PIN to continue
			{/if}
		</p>

		{#if settings?.biometricEnabled}
			<button
				type="button"
				class="quick-unlock__bio-btn"
				onclick={() => tryBiometric(false)}
				disabled={loading}
			>
				{bioLoading ? 'Checking…' : 'Use fingerprint / Face ID'}
			</button>
		{/if}

		{#if settings?.biometricEnabled && settings?.pinEnabled}
			<p class="quick-unlock__or">or</p>
		{/if}

		{#if settings?.pinEnabled}
			<form
				class="quick-unlock__pin-form"
				onsubmit={(e) => {
					e.preventDefault();
					tryPin();
				}}
			>
				<label class="quick-unlock__label" for="quick-unlock-pin">Quick PIN</label>
				<input
					id="quick-unlock-pin"
					class="quick-unlock__pin-input"
					type="password"
					inputmode="numeric"
					pattern="[0-9]*"
					maxlength="8"
					autocomplete="off"
					placeholder="••••"
					bind:value={pin}
					oninput={onPinInput}
					disabled={loading}
				/>
				<button type="submit" class="quick-unlock__pin-btn" disabled={loading || !pin.trim()}>
					{pinLoading ? 'Checking…' : 'Unlock with PIN'}
				</button>
			</form>
		{/if}

		{#if error}
			<p class="quick-unlock__error" role="alert">{error}</p>
		{/if}

		<button type="button" class="quick-unlock__fallback" onclick={useFullLogin} disabled={loading}>
			Sign in with email instead
		</button>
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

	.quick-unlock__pin-form {
		text-align: left;
	}

	.quick-unlock__label {
		display: block;
		margin-bottom: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.quick-unlock__pin-input {
		width: 100%;
		padding: var(--space-3);
		margin-bottom: var(--space-3);
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		font-size: var(--font-size-xl);
		letter-spacing: 0.3em;
		text-align: center;
	}

	.quick-unlock__pin-btn {
		width: 100%;
		padding: var(--space-3);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-primary);
		color: white;
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}

	.quick-unlock__pin-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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