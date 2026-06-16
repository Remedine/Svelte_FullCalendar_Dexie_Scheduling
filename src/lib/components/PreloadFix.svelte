<!-- Patches SvelteKit runtime-injected preload links so credentials mode matches fetch (silences console noise). -->
<script lang="ts">
	import { browser } from '$app/environment';

	$effect(() => {
		if (!browser) return;

		const fixPreloadLinks = () => {
			document
				.querySelectorAll('link[rel="modulepreload"], link[rel="preload"]')
				.forEach((link) => {
					if (!link.getAttribute('crossorigin')) {
						link.setAttribute('crossorigin', 'anonymous');
					}
				});
		};

		fixPreloadLinks();
		const observer = new MutationObserver(fixPreloadLinks);
		observer.observe(document.head, { childList: true, subtree: true });

		return () => observer.disconnect();
	});
</script>