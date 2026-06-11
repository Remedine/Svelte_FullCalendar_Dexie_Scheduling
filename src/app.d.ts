// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// )=- Environment variable typing for Vite/SvelteKit.
// All PUBLIC_* vars are exposed to the browser.
// Currently only PUBLIC_POCKETBASE_URL is used (see src/lib/db/pb.ts).
interface ImportMetaEnv {
	readonly PUBLIC_POCKETBASE_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

export {};
