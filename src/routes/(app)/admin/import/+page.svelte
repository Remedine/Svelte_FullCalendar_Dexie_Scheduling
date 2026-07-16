<!-- Redirect legacy /admin/import → Options Import tab -->
<script lang="ts">
	import { goto } from '$app/navigation';

	$effect(() => {
		goto('/admin/options?tab=import', { replaceState: true });
	});
</script>

<p class="bulk-import-redirect">Redirecting to Options → Import…</p>

<style>
	.bulk-import-redirect {
		padding: 2rem;
		text-align: center;
		color: var(--color-text-muted, #64748b);
	}
</style>
