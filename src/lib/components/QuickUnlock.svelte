<script lang="ts">
	import { unlockApp } from '$lib/stores/auth.svelte';
	import {
		getDeviceAuthSettings,
		unlockWithBiometric,
		verifyPinUnlock
	} from '$lib/auth/deviceUnlock';

	let pin = $state('');
	let error = $state('');
	let loading = $state(false);
	let settings = $state<Awaited<ReturnType<typeof getDeviceAuthSettings>>>(null);

	$effect(() => {
		void getDeviceAuthSettings().then((s) => {
			settings = s;
		});
	});

	async function tryBiometric() {
		loading = true;
		error = '';
		try {
			const ok = await unlockWithBiometric();
			if (ok) {
				unlockApp();
			} else {
				error = 'Biometric unlock failed. Try your PIN or sign out.';
			}
		} catch (e: any) {
			error = e?.message || 'Biometric unlock unavailable';
		} finally {
			loading = false;
		}
	}

	async function tryPin() {
		if (!pin.trim()) {
			error = 'Enter your PIN';
			return;
		}
		loading = true;
		error = '';
		try {
			const ok = await verifyPinUnlock(pin);
			if (ok) {
				pin = '';
				unlockApp();
			} else {
				error = 'Incorrect PIN';
			}
		} finally {
			loading = false;
		}
	}

	async function useFullLogin() {
		const { logout } = await import('$lib/stores/auth.svelte');
		const { goto } = await import('$app/navigation');
		await logout();
		goto('/login', { replaceState: true });
	}
</script>

<div class="quick-unlock">
	<div class="quick-unlock__card">
		<h2 class="quick-unlock__title">Unlock app</h2>
		<p class="quick-unlock__subtitle">Verify it's you to continue</p>

		{#if settings?.biometricEnabled}
			<button
				type="button"
				class="quick-unlock__bio-btn"
				onclick={tryBiometric}
				disabled={loading}
			>
				{loading ? 'Checking…' : 'Use fingerprint / Face ID'}
			</button>
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
					bind:value={pin}
					disabled={loading}
				/>
				<button type="submit" class="quick-unlock__pin-btn" disabled={loading}>
					Unlock
				</button>
			</form>
		{/if}

		{#if error}
			<p class="quick-unlock__error">{error}</p>
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
	}

	.quick-unlock__bio-btn {
		width: 100%;
		padding: var(--space-4);
		margin-bottom: var(--space-4);
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

	.quick-unlock__pin-form {
		text-align: left;
		margin-bottom: var(--space-4);
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

	.quick-unlock__error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin: 0 0 var(--space-3);
	}

	.quick-unlock__fallback {
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		text-decoration: underline;
		cursor: pointer;
	}
</style>