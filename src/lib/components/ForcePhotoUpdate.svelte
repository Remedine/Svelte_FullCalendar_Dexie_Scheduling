<!-- src/lib/components/ForcePhotoUpdate.svelte
     Dedicated, reusable modal for forcing a crew photo update.
     - Can be shown after WelcomeModal password step (for new crew) OR independently on login
       when a verified user has forcePhotoUpdate=true (admin re-forced via Crew edit).
     - Uses camera-friendly file input (capture=user) + gallery fallback.
     - Previews the selected photo before save.
     - Persists via updateUser (Dexie + PB queue with dataUrl->Blob handling).
     - Clears forcePhotoUpdate on success.
     - BEM naming, design tokens, Svelte 5 runes only. Cohesive with WelcomeModal + profile photo UI.
     Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
<script lang="ts">
	import { updateUser, getUserPhotoSrc, type User } from '$lib/db';
	import { auth } from '$lib/stores/auth.svelte';

	interface Props {
		user: User;
		onClose: () => void;
	}

	const { user, onClose }: Props = $props();

	let photoInput: HTMLInputElement | null = $state(null);
	let photoDataUrl = $state<string | null>(null); // newly selected (data: URL), not yet saved
	let isLoading = $state(false);
	let error = $state('');
	let success = $state(false);

	// Current (or previously saved) photo for initial preview. Uses the central helper (handles data:, http, PB filename).
	const currentPhoto = $derived(getUserPhotoSrc(user.photo, user));

	function triggerPhotoPicker() {
		photoInput?.click();
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		error = '';

		const reader = new FileReader();
		reader.onload = (ev) => {
			photoDataUrl = ev.target?.result as string;
		};
		reader.onerror = () => {
			error = 'Could not read the selected photo. Please try again.';
		};
		reader.readAsDataURL(file);

		// Allow re-selecting the same file later
		target.value = '';
	}

	async function savePhoto() {
		if (!photoDataUrl) {
			error = 'Please choose or take a photo first.';
			return;
		}
		if (!user?.id) {
			error = 'Unable to identify user record.';
			return;
		}

		isLoading = true;
		error = '';

		try {
			await updateUser(user.id, {
				photo: photoDataUrl,
				forcePhotoUpdate: false,
				updatedAt: new Date()
			});

			// Optimistic live update if the auth store is already populated (common after login + setCurrentUser).
			if (auth?.currentUser && (auth.currentUser.id === user.id || auth.currentUser.pbId === user.pbId)) {
				auth.currentUser.photo = photoDataUrl;
				auth.currentUser.forcePhotoUpdate = false;
			}

			// Note: We no longer mutate the `user` prop directly (caused Svelte ownership warnings).
			// The Dexie update + auth store patch are sufficient; parent closes the modal on success.
			// For the PB side, updateUser queues the change (with blob conversion); on 404 the processor now clears stale pbId.

			success = true;
		} catch (err: any) {
			console.error('Force photo update failed:', err);
			error = err?.message || 'Failed to save photo. Please try again.';
		} finally {
			isLoading = false;
		}
	}

	function finish() {
		onClose();
	}
</script>

<div
	class="force-photo-update__overlay"
	role="presentation"
	onclick={success ? finish : undefined}
>
	<div
		class="force-photo-update__content"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Escape' && success) {
				e.stopPropagation();
				finish();
			}
		}}
	>
		<h2 class="force-photo-update__title">Photo Required</h2>

		{#if success}
			<div class="force-photo-update__success">
				<div class="force-photo-update__success-preview">
					{#if photoDataUrl}
						<img src={photoDataUrl} alt="Your new photo" class="force-photo-update__success-img" />
					{:else if currentPhoto}
						<img src={currentPhoto} alt="Your photo" class="force-photo-update__success-img" />
					{/if}
				</div>
				<p class="force-photo-update__success-text">
					Photo saved successfully. It will appear on job cards, the schedule, and crew lists.
				</p>
				<button onclick={finish} class="force-photo-update__btn force-photo-update__btn--primary">
					Continue to Schedule
				</button>
			</div>
		{:else}
			<p class="force-photo-update__intro">
				Your administrator requires a current photo for identification on the schedule and job cards.
			</p>

			<!-- Large centered preview (current or newly chosen) -->
			<div class="force-photo-update__preview">
				{#if photoDataUrl}
					<img src={photoDataUrl} alt="Selected photo preview" class="force-photo-update__preview-img" />
				{:else if currentPhoto}
					<img src={currentPhoto} alt="Current photo" class="force-photo-update__preview-img" />
				{:else}
					<div class="force-photo-update__preview-placeholder">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="48"
							height="48"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
							<circle cx="12" cy="7" r="4" />
						</svg>
						<span>No photo yet</span>
					</div>
				{/if}
			</div>

			<!-- Photo picker controls (large tap targets) -->
			<div class="force-photo-update__picker">
				<button
					onclick={triggerPhotoPicker}
					disabled={isLoading}
					class="force-photo-update__btn force-photo-update__btn--photo"
				>
					📷 Take Photo or Choose from Library
				</button>
				<input
					bind:this={photoInput}
					type="file"
					accept="image/*"
					capture="user"
					style="display:none"
					onchange={handleFileSelect}
				/>
				{#if photoDataUrl}
					<button
						onclick={triggerPhotoPicker}
						disabled={isLoading}
						class="force-photo-update__btn force-photo-update__btn--retake"
					>
						Retake
					</button>
				{/if}
			</div>

			{#if error}
				<p class="force-photo-update__error">{error}</p>
			{/if}

			<div class="force-photo-update__actions">
				<button onclick={finish} class="force-photo-update__btn force-photo-update__btn--ghost">
					Later (from Profile)
				</button>
				<button
					onclick={savePhoto}
					disabled={isLoading || !photoDataUrl}
					class="force-photo-update__btn force-photo-update__btn--primary"
				>
					{isLoading ? 'Saving photo...' : 'Save Photo'}
				</button>
			</div>

			<p class="force-photo-update__note">
				Your photo stays private to the crew and is only used inside this app.
			</p>
		{/if}
	</div>
</div>

<style>
	.force-photo-update__overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.65);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--space-4);
	}

	.force-photo-update__content {
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		width: 100%;
		max-width: 420px;
		padding: var(--space-6);
		box-shadow: var(--shadow-md);
		text-align: center;
	}

	.force-photo-update__title {
		margin: 0 0 var(--space-3) 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.force-photo-update__intro {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-4) 0;
		line-height: 1.4;
	}

	/* Large round preview area (cohesive with profile badge + crew avatars) */
	.force-photo-update__preview {
		width: 140px;
		height: 140px;
		margin: 0 auto var(--space-4);
		border-radius: var(--radius-full);
		overflow: hidden;
		border: 3px solid var(--color-border-strong);
		background: var(--color-surface-alt);
		box-shadow: var(--shadow-sm);
	}

	.force-photo-update__preview-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.force-photo-update__preview-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	/* Picker row */
	.force-photo-update__picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	/* Buttons (BEM, token driven, large targets) */
	.force-photo-update__btn {
		padding: var(--space-3) var(--space-5);
		border-radius: var(--radius-md);
		border: none;
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		font-size: var(--font-size-base);
		transition: background var(--transition-fast), opacity var(--transition-fast);
		min-height: 48px; /* good mobile tap target */
	}

	.force-photo-update__btn--primary {
		background: var(--color-primary);
		color: white;
	}

	.force-photo-update__btn--primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.force-photo-update__btn--primary:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.force-photo-update__btn--photo {
		background: var(--color-surface-alt);
		color: var(--color-text);
		border: 1px solid var(--color-border-strong);
	}

	.force-photo-update__btn--photo:hover:not(:disabled) {
		background: var(--color-border);
	}

	.force-photo-update__btn--retake {
		background: transparent;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		font-size: var(--font-size-sm);
		padding: var(--space-2) var(--space-4);
		min-height: 40px;
	}

	.force-photo-update__btn--ghost {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.force-photo-update__btn--ghost:hover:not(:disabled) {
		background: var(--color-border);
	}

	.force-photo-update__actions {
		display: flex;
		gap: var(--space-3);
		justify-content: center;
		margin-top: var(--space-2);
	}

	.force-photo-update__error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin: var(--space-2) 0;
	}

	.force-photo-update__note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-top: var(--space-4);
	}

	/* Success state */
	.force-photo-update__success {
		text-align: center;
	}

	.force-photo-update__success-preview {
		width: 110px;
		height: 110px;
		margin: 0 auto var(--space-4);
		border-radius: var(--radius-full);
		overflow: hidden;
		border: 3px solid var(--color-border);
		background: var(--color-surface-alt);
	}

	.force-photo-update__success-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.force-photo-update__success-text {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-bottom: var(--space-4);
	}
</style>
