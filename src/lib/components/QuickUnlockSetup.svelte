<script lang="ts">
	import PinInput from '$lib/components/PinInput.svelte';
	import {
		declineQuickUnlockSetup,
		enableQuickUnlock,
		isPlatformAuthenticatorAvailable,
		PIN_LENGTH,
		validatePinFormat
	} from '$lib/auth/deviceUnlock';

	type Props = {
		userId: string;
		email: string;
		displayName: string;
		onComplete: () => void;
		onSkip: () => void;
	};

	let { userId, email, displayName, onComplete, onSkip }: Props = $props();

	let pin = $state('');
	let confirmPin = $state('');
	let confirmStep = $state(false);
	let useBiometric = $state(true);
	let biometricAvailable = $state(false);
	let loading = $state(false);
	let error = $state('');
	let pinResetKey = $state(0);

	$effect(() => {
		void isPlatformAuthenticatorAvailable().then((ok) => {
			biometricAvailable = ok;
			if (!ok) useBiometric = false;
		});
	});

	function onFirstPinComplete(code: string) {
		const pinErr = validatePinFormat(code);
		if (pinErr) {
			error = pinErr;
			pinResetKey++;
			return;
		}
		error = '';
		pin = code;
		confirmStep = true;
		confirmPin = '';
	}

	function onConfirmPinComplete(code: string) {
		if (code !== pin) {
			error = 'PINs do not match. Try again.';
			confirmStep = false;
			pin = '';
			confirmPin = '';
			pinResetKey++;
			return;
		}
		void saveWithPin(code);
	}

	async function save() {
		error = '';
		const wantsPin = pin.length === PIN_LENGTH || confirmPin.length === PIN_LENGTH;

		if (wantsPin) {
			if (!confirmStep) {
				error = 'Enter and confirm your 4-digit PIN';
				return;
			}
			if (pin !== confirmPin) {
				error = 'PINs do not match';
				return;
			}
			await saveWithPin(pin);
			return;
		}

		if (!(useBiometric && biometricAvailable)) {
			error = 'Set a 4-digit PIN and/or enable biometric unlock';
			return;
		}

		loading = true;
		try {
			await enableQuickUnlock({
				userId,
				email,
				displayName,
				enableBiometric: true
			});
			onComplete();
		} catch (e: any) {
			error = e?.message || 'Could not enable quick unlock';
		} finally {
			loading = false;
		}
	}

	async function saveWithPin(code: string) {
		const pinErr = validatePinFormat(code);
		if (pinErr) {
			error = pinErr;
			return;
		}

		loading = true;
		error = '';
		try {
			await enableQuickUnlock({
				userId,
				email,
				displayName,
				pin: code,
				enableBiometric: useBiometric && biometricAvailable
			});
			onComplete();
		} catch (e: any) {
			error = e?.message || 'Could not enable quick unlock';
		} finally {
			loading = false;
		}
	}
</script>

<div class="quick-unlock-setup">
	<div class="quick-unlock-setup__card">
		<h2 class="quick-unlock-setup__title">Unlock this device</h2>
		<p class="quick-unlock-setup__intro">
			Optional layer for <strong>this phone or tablet</strong> — fingerprint, Face ID, or a 4-digit PIN
			when you return to the app. Does not change your account password. You can set this up later in
			Profile.
		</p>

		{#if biometricAvailable}
			<label class="quick-unlock-setup__check">
				<input type="checkbox" bind:checked={useBiometric} disabled={loading} />
				Use fingerprint / Face ID
			</label>
		{/if}

		<div class="quick-unlock-setup__field">
			<p class="quick-unlock-setup__label">
				{confirmStep ? 'Confirm your 4-digit PIN' : 'Choose a 4-digit PIN (optional)'}
			</p>
			{#if confirmStep}
				<PinInput
					bind:value={confirmPin}
					disabled={loading}
					hasError={!!error}
					resetKey={pinResetKey}
					onComplete={onConfirmPinComplete}
				/>
				<button
					type="button"
					class="quick-unlock-setup__back"
					onclick={() => {
						confirmStep = false;
						pin = '';
						confirmPin = '';
						pinResetKey++;
						error = '';
					}}
					disabled={loading}
				>
					Change PIN
				</button>
			{:else}
				<PinInput
					bind:value={pin}
					disabled={loading}
					hasError={!!error}
					resetKey={pinResetKey}
					onComplete={onFirstPinComplete}
				/>
			{/if}
		</div>

		{#if error}
			<p class="quick-unlock-setup__error">{error}</p>
		{/if}

		{#if !confirmStep && !pin && useBiometric && biometricAvailable}
			<button type="button" class="quick-unlock-setup__primary" onclick={save} disabled={loading}>
				{loading ? 'Saving…' : 'Enable biometric only'}
			</button>
		{/if}

		<button
			type="button"
			class="quick-unlock-setup__skip"
			onclick={() => {
				declineQuickUnlockSetup(userId);
				onSkip();
			}}
			disabled={loading}
		>
			Skip for now
		</button>
	</div>
</div>

<style>
	.quick-unlock-setup {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.45);
		padding: var(--space-4);
	}

	.quick-unlock-setup__card {
		width: 100%;
		max-width: 400px;
		background: var(--color-surface);
		border-radius: var(--radius-xl);
		padding: var(--space-6);
		box-shadow: var(--shadow-lg);
		text-align: center;
	}

	.quick-unlock-setup__title {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-xl);
	}

	.quick-unlock-setup__intro {
		margin: 0 0 var(--space-5);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.quick-unlock-setup__check {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
		font-size: var(--font-size-sm);
	}

	.quick-unlock-setup__field {
		margin-bottom: var(--space-4);
	}

	.quick-unlock-setup__label {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.quick-unlock-setup__back {
		margin-top: var(--space-3);
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		text-decoration: underline;
		cursor: pointer;
	}

	.quick-unlock-setup__error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin: 0 0 var(--space-3);
	}

	.quick-unlock-setup__primary {
		width: 100%;
		padding: var(--space-3);
		margin-bottom: var(--space-2);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-primary);
		color: white;
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}

	.quick-unlock-setup__skip {
		width: 100%;
		padding: var(--space-2);
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-decoration: underline;
	}
</style>