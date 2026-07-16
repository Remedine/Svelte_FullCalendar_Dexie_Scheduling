<!-- src/lib/components/SyncStatus.svelte -->
<script lang="ts">
	import { pullJobsFromServer, syncAppDataFromServer, APP_DATA_SYNCED_EVENT } from '$lib/db/pb';
	import { onJobsRealtime } from '$lib/db/realtime';
	import { pb } from '$lib/db/pb';
	import { auth } from '$lib/stores/auth.svelte';

	let isOnline = $state(true);
	let lastSynced = $state(new Date());
	let isSyncing = $state(false);

	$effect(() => {
		if (!pb.authStore.isValid) {
			isOnline = false;
			return;
		}

		isOnline = true;

		const off = onJobsRealtime(async () => {
			lastSynced = new Date();
			await pullJobsFromServer();
		});

		const onSynced = () => {
			lastSynced = new Date();
			isOnline = true;
		};
		window.addEventListener(APP_DATA_SYNCED_EVENT, onSynced);

		return () => {
			off();
			window.removeEventListener(APP_DATA_SYNCED_EVENT, onSynced);
		};
	});

	async function manualSync() {
		try {
			isSyncing = true;
			isOnline = true;

			console.log('🔄 Manual sync triggered');

			await syncAppDataFromServer({
				user: auth.currentUser,
				force: true,
				reason: 'manual'
			});

			lastSynced = new Date();
		} catch (err) {
			isOnline = false;
			console.error('Manual sync failed', err);
		} finally {
			isSyncing = false;
		}
	}
</script>

<div class="sync-status">
	<div class="sync-status__dot sync-status__dot--{isOnline ? 'online' : 'offline'}"></div>
	<span class="sync-status__text">
		{#if isOnline}
			Synced • Last: {lastSynced.toLocaleTimeString()}
		{:else}
			Offline — will sync when connected
		{/if}
	</span>
	<button class="sync-status__btn button" onclick={manualSync} disabled={isSyncing}>
		{isSyncing ? 'Syncing...' : 'Sync Now'}
	</button>
</div>

<style>
	.sync-status {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		background: var(--color-surface-alt);
		border-radius: var(--radius-full);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.sync-status__dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.sync-status__dot--online {
		background: var(--color-success);
	}
	.sync-status__dot--offline {
		background: var(--color-danger);
	}

	.sync-status__btn {
		margin-left: auto;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
</style>