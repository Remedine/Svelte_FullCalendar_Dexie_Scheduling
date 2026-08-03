/**
 * Mobile camera / gallery photos are often multi‑MB HEIC/JPEG that:
 * - exceed PocketBase practical upload limits
 * - use mime types outside the users.photo allowlist (jpeg/png/gif/webp/svg)
 * - bloat the Dexie sync queue when stored as data URLs
 *
 * Normalize to a modest JPEG data URL before local save + PB multipart upload.
 */

export type CompressAvatarOptions = {
	/** Longest edge in CSS pixels (default 1024). */
	maxEdge?: number;
	/** JPEG quality 0–1 (default 0.85). */
	quality?: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not decode photo'));
		img.src = src;
	});
}

function scaleDimensions(
	width: number,
	height: number,
	maxEdge: number
): { w: number; h: number } {
	const longest = Math.max(width, height) || 1;
	const scale = Math.min(1, maxEdge / longest);
	return {
		w: Math.max(1, Math.round(width * scale)),
		h: Math.max(1, Math.round(height * scale))
	};
}

function canvasToJpegDataUrl(
	width: number,
	height: number,
	quality: number,
	paint: (ctx: CanvasRenderingContext2D) => void
): string {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not process photo (canvas unavailable)');
	// White fill so transparent PNGs don't become black JPEG backgrounds.
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, width, height);
	paint(ctx);
	return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Decode a Blob/File and re-encode as a compressed `image/jpeg` data URL.
 * Falls back to FileReader data URL if canvas decode fails (rare HEIC edge cases).
 */
export async function compressImageToJpegDataUrl(
	source: Blob | File,
	options: CompressAvatarOptions = {}
): Promise<string> {
	const maxEdge = options.maxEdge ?? 1024;
	const quality = options.quality ?? 0.85;

	if (typeof document === 'undefined') {
		// SSR / non-DOM: return raw data URL (caller should only use this in browser).
		return readAsDataUrl(source);
	}

	// Prefer createImageBitmap (handles EXIF orientation on modern browsers).
	if (typeof createImageBitmap === 'function') {
		try {
			const bitmap = await createImageBitmap(source);
			try {
				const { w, h } = scaleDimensions(bitmap.width, bitmap.height, maxEdge);
				return canvasToJpegDataUrl(w, h, quality, (ctx) => {
					ctx.drawImage(bitmap, 0, 0, w, h);
				});
			} finally {
				bitmap.close();
			}
		} catch {
			// Fall through to HTMLImageElement path.
		}
	}

	const objectUrl = URL.createObjectURL(source);
	try {
		const img = await loadImage(objectUrl);
		const { w, h } = scaleDimensions(
			img.naturalWidth || img.width,
			img.naturalHeight || img.height,
			maxEdge
		);
		return canvasToJpegDataUrl(w, h, quality, (ctx) => {
			ctx.drawImage(img, 0, 0, w, h);
		});
	} catch {
		// Last resort: keep original bytes as data URL (may still fail PB mime/size).
		return readAsDataUrl(source);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function readAsDataUrl(source: Blob | File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result || '');
			if (!result.startsWith('data:')) {
				reject(new Error('Invalid photo data'));
				return;
			}
			resolve(result);
		};
		reader.onerror = () => reject(new Error('Could not read photo'));
		reader.readAsDataURL(source);
	});
}

/** True when a stored photo still looks like a local-only camera capture. */
export function isPendingLocalPhoto(photo: string | undefined | null): boolean {
	return typeof photo === 'string' && photo.startsWith('data:');
}
