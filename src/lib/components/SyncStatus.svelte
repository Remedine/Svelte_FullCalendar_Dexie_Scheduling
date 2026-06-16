<!-- src/lib/components/SyncStatus.svelte -->
<script lang="ts">
	import { pullJobsFromServer } from '$lib/db/pb';
	import { onJobsRealtime } from '$lib/db/realtime';
	import { processSyncQueue } from '$lib/db';
	import { pb } from '$lib/db/pb';

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

		return off;
	});

	async function manualSync() {
		try {
			isSyncing = true;
			isOnline = true;

			console.log('🔄 Manual sync triggered');

			await pullJobsFromServer();
			await processSyncQueue();

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