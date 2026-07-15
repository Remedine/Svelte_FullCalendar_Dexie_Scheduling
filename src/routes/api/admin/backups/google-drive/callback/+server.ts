import { isRedirect, redirect } from '@sveltejs/kit';
import { patchOptionsRecord } from '$lib/server/backups';
import {
	completeGoogleDriveOAuth,
	optionsPageRedirect,
	resolveAppOrigin,
	sealDriveRefreshToken
} from '$lib/server/googleDrive';

/**
 * Google OAuth redirect target (no auth header — validated via signed state).
 * Stores refresh token server-side and returns admin to Options → Backups.
 */
export async function GET({ request, url }: { request: Request; url: URL }) {
	const origin = resolveAppOrigin(request);
	const errorParam = url.searchParams.get('error');
	if (errorParam) {
		throw redirect(
			302,
			optionsPageRedirect(origin, {
				gdrive: 'error',
				message: errorParam === 'access_denied' ? 'Google sign-in was cancelled.' : errorParam
			})
		);
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) {
		throw redirect(
			302,
			optionsPageRedirect(origin, {
				gdrive: 'error',
				message: 'Missing authorization code from Google.'
			})
		);
	}

	try {
		const result = await completeGoogleDriveOAuth(origin, code, state);
		const sealedToken = sealDriveRefreshToken(result.refreshToken);
		const ok = await patchOptionsRecord({
			backupGoogleDriveRefreshToken: sealedToken,
			backupGoogleDriveEmail: result.email,
			backupGoogleDriveFolderId: result.folderId,
			backupGoogleDriveFolderName: result.folderName,
			// Auto-enable Drive destination once connected
			backupDestGoogleDrive: true
		});
		if (!ok) {
			throw new Error('Connected to Google but failed to save settings. Try again.');
		}
		// Confirm token is readable via internal options (catches hidden-field / schema issues).
		const { fetchOptionsRecord } = await import('$lib/server/backups');
		const verify = await fetchOptionsRecord();
		const stored = verify?.backupGoogleDriveRefreshToken?.trim() || '';
		if (!stored) {
			throw new Error(
				'Google connected but the server could not store the Drive token on options. Check PocketBase options fields, then try Connect again.'
			);
		}
		throw redirect(
			302,
			optionsPageRedirect(origin, {
				gdrive: 'connected',
				email: result.email || 'Google Drive'
			})
		);
	} catch (err) {
		if (isRedirect(err)) throw err;
		const message =
			err instanceof Error ? err.message : 'Could not finish Google Drive connection.';
		throw redirect(
			302,
			optionsPageRedirect(origin, {
				gdrive: 'error',
				message: message.slice(0, 200)
			})
		);
	}
}
