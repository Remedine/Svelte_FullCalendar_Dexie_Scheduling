<!-- src/lib/components/SyncStatus.svelte -->
<script lang="ts">
	import { pb, pullJobsFromServer } from '$lib/db/pb';
	import { processSyncQueue } from '$lib/db'; // )=- Moved here

	let isOnline = $state(true);
	let lastSynced = $state(new Date());
	let isSyncing = $state(false); // )=- NEW
	let currentSubscription: any = null;

	$effect(() => {
		if (currentSubscription) {
			try {
				if (typeof currentSubscription.unsubscribe === 'function') {
					currentSubscription.unsubscribe();
				}
			} catch (e) {
				console.warn('Cleanup warning:', e);
			}
			currentSubscription = null;
		}

		if (!pb.authStore.isValid) {
			isOnline = false;
			return;
		}

		isOnline = true;

		try {
			// Force a clean realtime connection before (re)subscribing.
			// This prevents "Invalid realtime client" 400s that can occur after login,
			// token restore on refresh, or when a previous (possibly anonymous) realtime client
			// is still registered on the server. Disconnect resets the internal clientId.
			// Await the subscribe so errors are caught here and we know the connection succeeded.
			if (pb.realtime && typeof (pb.realtime as any).disconnect === 'function') {
				try {
					(pb.realtime as any).disconnect();
				} catch {}
			}

			// Wrap in IIFE because the $effect arrow itself is not async, but we want to await the PB subscribe promise.
			(async () => {
				currentSubscription = await pb.collection('jobs').subscribe('*', async (e) => {
					console.log('🔔 Realtime change:', e.action);
					lastSynced = new Date();
					await pullJobsFromServer();
				});
			})().catch((err) => {
				console.warn('[calendar] realtime jobs subscribe failed (non-fatal)', err);
			});
		} catch (err) {
			console.warn('[calendar] realtime jobs subscribe failed (non-fatal)', err);
		}

		return () => {
			if (currentSubscription) {
				try {
					if (typeof currentSubscription.unsubscribe === 'function') {
						currentSubscription.unsubscribe();
					}
				} catch {}
				currentSubscription = null;
			}
			// Also disconnect the realtime transport on unmount to avoid stale client IDs on next mount/login.
			if (pb.realtime && typeof (pb.realtime as any).disconnect === 'function') {
				try {
					(pb.realtime as any).disconnect();
				} catch {}
			}
		};
	});

	async function manualSync() {
		try {
			isSyncing = true; // )=- Start loading
			isOnline = true;

			console.log('🔄 Manual sync triggered');

			await pullJobsFromServer();
			await processSyncQueue();

			lastSynced = new Date();
		} catch (err) {
			isOnline = false;
			console.error('Manual sync failed', err);
		} finally {
			isSyncing = false; // )=- End loading
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
		/* base button */
		margin-left: auto;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
</style>
