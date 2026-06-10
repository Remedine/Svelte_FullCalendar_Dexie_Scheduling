<!-- src/routes/(app)/admin/crew/+page.svelte -->
<script lang="ts">
  // )=- Defensive role guard on the page itself (in addition to layout).
  // Ensures consistency even if deep-linked or layout guard is bypassed.
  import { auth } from '$lib/stores/auth.svelte';
  import { goto } from '$app/navigation';
  import CrewManagement from '$lib/components/CrewManagement.svelte';

  $effect(() => {
    if (!auth.loading && auth.currentUser?.role !== 'admin') {
      goto('/calendar', { replaceState: true });
    }
  });
</script>

<svelte:head>
  <title>User Management - Admin</title>  <!--  Updated title to reflect all users -->
</svelte:head>

{#if auth.currentUser?.role === 'admin'}
  <CrewManagement />
{:else}
  <div class="access-denied">Access denied. Admin only.</div>
{/if}