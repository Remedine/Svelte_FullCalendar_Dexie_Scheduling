<!-- Patches SvelteKit runtime-injected preload links so credentials mode matches fetch (silences console noise). -->
<script lang="ts">
	import { browser } from '$app/environment';

	$effect(() => {
		if (!browser) return;

		const fixPreloadLinks = () => {
			document
				.querySelectorAll(
					'link[rel="modulepreload"], link[rel="preload"][as="script"], link[rel="preload"][as="style"]'
				)
				.forEach((link) => {
					// Same-origin assets load without crossorigin; preloads must match or the browser
					// warns "request credentials mode does not match" and discards the preload.
					if (link.hasAttribute('crossorigin')) {
						link.removeAttribute('crossorigin');
					}
				});
			document.querySelectorAll('link[rel="preload"][as="font"]').forEach((link) => {
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