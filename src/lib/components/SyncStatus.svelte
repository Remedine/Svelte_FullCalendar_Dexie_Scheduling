<!-- src/lib/components/SyncStatus.svelte -->
<script lang="ts">

  import { pb, pullJobsFromServer } from '$lib/pb';

  let isOnline = $state(true);
  let lastSynced = $state(new Date());
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

    // Subscribe
    try {
      currentSubscription = pb.collection('jobs').subscribe('*', async (e) => {
        console.log('🔔 Realtime change:', e.action);
        lastSynced = new Date();
        await pullJobsFromServer();
      });
    } catch (err) {
      console.error('Subscribe failed:', err);
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
    };
  });

  async function manualSync() {
    try {
      isOnline = true;
      await pullJobsFromServer();
      lastSynced = new Date();
    } catch (err) {
      isOnline = false;
      console.error('Manual sync failed', err);
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
  <button class="sync-status__btn" onclick={manualSync}>Sync Now</button>
</div>

<style>
  .sync-status {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    background: #f8fafc;
    border-radius: 9999px;
    font-size: 0.875rem;
    color: #64748b;
  }
  .sync-status__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .sync-status__dot--online { background: #22c55e; }
  .sync-status__dot--offline { background: #ef4444; }
  .sync-status__btn {
    margin-left: auto;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid #e2e8f0;
    background: white;
    font-size: 0.8rem;
    cursor: pointer;
  }
</style>