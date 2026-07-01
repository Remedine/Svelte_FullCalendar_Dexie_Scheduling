<!-- Patches SvelteKit runtime-injected preload links so credentials mode matches fetch (silences console noise). -->
<script lang="ts">
	import { browser } from '$app/environment';

	$effect(() => {
		if (!browser) return;

		const fixPreloadLinks = () => {
			document.querySelectorAll('link[rel="preload"], link[rel="modulepreload"]').forEach((link) => {
				const as = link.getAttribute('as') || '';
				const href = link.getAttribute('href') || '';
				const isFont = as === 'font';
				const isStyle = as === 'style' || /\.css(?:\?|$)/i.test(href);
				const isScript = as === 'script' || link.getAttribute('rel') === 'modulepreload';

				if (isFont) return;

				if ((isStyle || isScript) && link.hasAttribute('crossorigin')) {
					// Same-origin CSS/JS preloads must not use crossorigin or credentials mode mismatches.
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