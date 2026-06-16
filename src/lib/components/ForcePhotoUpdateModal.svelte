<!-- ForcePhotoUpdateModal.svelte — shown after login when admin flagged forcePhotoUpdate -->
<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { updateUser, getUserPhotoSrc, type User } from '$lib/db';

	interface Props {
		user: User;
		onClose: () => void;
	}

	const { user, onClose }: Props = $props();

	let previewDataUrl = $state<string | null>(null);
	let saving = $state(false);
	let error = $state('');
	let done = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	const displayPhoto = $derived(
		previewDataUrl || (user.photo ? getUserPhotoSrc(user.photo, user) : '')
	);

	function openPicker() {
		fileInput?.click();
	}

	function onFileSelected(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		error = '';
		const reader = new FileReader();
		reader.onload = (ev) => {
			previewDataUrl = ev.target?.result as string;
		};
		reader.onerror = () => {
			error = 'Could not read the selected photo. Please try again.';
		};
		reader.readAsDataURL(file);
		(e.target as HTMLInputElement).value = '';
	}

	async function savePhoto() {
		if (!previewDataUrl || !user.id) {
			error = 'Please choose or take a photo first.';
			return;
		}
		saving = true;
		error = '';
		try {
			await updateUser(user.id, {
				photo: previewDataUrl,
				forcePhotoUpdate: false,
				updatedAt: new Date()
			});
			if (auth.currentUser && auth.currentUser.id === user.id) {
				auth.currentUser.photo = previewDataUrl;
				auth.currentUser.forcePhotoUpdate = false;
			}
			done = true;
		} catch (e: any) {
			error = e?.message || 'Failed to save photo. Please try again.';
		} finally {
			saving = false;
		}
	}
</script>

<div
	class="force-photo-update__overlay"
	role="presentation"
	onclick={() => (done ? onClose() : undefined)}
>
	<div
		class="force-photo-update__content"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Escape' && done) onClose();
		}}
	>
		<h2 class="force-photo-update__title">Photo Required</h2>

		{#if done}
			<div class="force-photo-update__success">
				{#if displayPhoto}
					<img src={displayPhoto} alt="Your new photo" class="force-photo-update__preview-img" />
				{/if}
				<p class="force-photo-update__success-text">
					Photo saved. It will appear on job cards, the schedule, and crew lists.
				</p>
				<button class="force-photo-update__btn force-photo-update__btn--primary" onclick={onClose}>
					Continue to Schedule
				</button>
			</div>
		{:else}
			<p class="force-photo-update__intro">
				Your administrator requires a current photo for identification on the schedule and job cards.
			</p>

			<div class="force-photo-update__preview">
				{#if displayPhoto}
					<img src={displayPhoto} alt="Photo preview" class="force-photo-update__preview-img" />
				{:else}
					<div class="force-photo-update__preview-placeholder">
						<span>No photo yet</span>
					</div>
				{/if}
			</div>

			<div class="force-photo-update__picker">
				<button
					type="button"
					class="force-photo-update__btn force-photo-update__btn--photo"
					disabled={saving}
					onclick={openPicker}
				>
					📷 Take Photo or Choose from Library
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*"
					capture="user"
					style="display: none"
					onchange={onFileSelected}
				/>
			</div>

			{#if error}
				<p class="force-photo-update__error">{error}</p>
			{/if}

			<div class="force-photo-update__actions">
				<button
					type="button"
					class="force-photo-update__btn force-photo-update__btn--ghost"
					disabled={saving}
					onclick={onClose}
				>
					Later (from Profile)
				</button>
				<button
					type="button"
					class="force-photo-update__btn force-photo-update__btn--primary"
					disabled={saving || !previewDataUrl}
					onclick={savePhoto}
				>
					{saving ? 'Saving photo...' : 'Save Photo'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.force-photo-update__overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 1000;
	}

	.force-photo-update__content {
		background: white;
		border-radius: 12px;
		padding: 1.5rem;
		max-width: 420px;
		width: 100%;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
	}

	.force-photo-update__title {
		margin: 0 0 0.75rem;
		font-size: 1.35rem;
		color: #1e3a8a;
	}

	.force-photo-update__intro,
	.force-photo-update__success-text {
		color: #64748b;
		margin: 0 0 1rem;
		line-height: 1.5;
	}

	.force-photo-update__preview {
		display: flex;
		justify-content: center;
		margin-bottom: 1rem;
	}

	.force-photo-update__preview-img {
		width: 120px;
		height: 120px;
		border-radius: 50%;
		object-fit: cover;
		border: 3px solid #e2e8f0;
	}

	.force-photo-update__preview-placeholder {
		width: 120px;
		height: 120px;
		border-radius: 50%;
		background: #f1f5f9;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #94a3b8;
		font-size: 0.85rem;
	}

	.force-photo-update__picker {
		margin-bottom: 1rem;
	}

	.force-photo-update__actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.force-photo-update__btn {
		border: none;
		border-radius: 8px;
		padding: 0.65rem 1rem;
		font-weight: 600;
		cursor: pointer;
	}

	.force-photo-update__btn--primary {
		background: #3b82f6;
		color: white;
	}

	.force-photo-update__btn--photo {
		width: 100%;
		background: #eff6ff;
		color: #1d4ed8;
	}

	.force-photo-update__btn--ghost {
		background: transparent;
		color: #64748b;
	}

	.force-photo-update__btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.force-photo-update__error {
		color: #ef4444;
		font-size: 0.9rem;
		margin: 0 0 0.75rem;
	}

	.force-photo-update__success {
		text-align: center;
	}
</style>