import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { fetchOptionsRecord, patchOptionsRecord } from '$lib/server/backups';
import {
	buildGoogleDriveAuthUrl,
	isGoogleDriveConfigured,
	isGoogleOAuthAppConfigured,
	openDriveRefreshToken,
	resolveAppOrigin,
	resolveGoogleDriveFolderId
} from '$lib/server/googleDrive';

function authHeader(request: Request): string | null {
	return request.headers.get('Authorization');
}

/** GET: connection status for Options → Backups UI. */
export async function GET({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const options = await fetchOptionsRecord();
	const refreshToken = openDriveRefreshToken(options?.backupGoogleDriveRefreshToken);
	const folderId = resolveGoogleDriveFolderId(options?.backupGoogleDriveFolderId);
	const oauthAppReady = isGoogleOAuthAppConfigured();
	const connected = isGoogleDriveConfigured(options?.backupGoogleDriveFolderId, refreshToken);
	const hasOAuthToken = Boolean(refreshToken);
	const hasServiceAccount = Boolean(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim());
	// Folder saved without token (e.g. schema missing fields on first connect)
	const needsReconnect = Boolean(folderId && !hasOAuthToken && !hasServiceAccount);

	return json({
		oauthAppReady,
		connected,
		hasOAuthToken,
		hasServiceAccount,
		needsReconnect,
		email: options?.backupGoogleDriveEmail || '',
		folderId: folderId || '',
		folderName: options?.backupGoogleDriveFolderName || '',
		destEnabled: Boolean(options?.backupDestGoogleDrive)
	});
}

/** POST: start OAuth connect → { url }. DELETE: disconnect Google Drive. */
export async function POST({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	if (!isGoogleOAuthAppConfigured()) {
		return json(
			{
				error:
					'Google Drive connect is not available yet. The app needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET set once on the server.'
			},
			{ status: 503 }
		);
	}

	const origin = resolveAppOrigin(request);
	const url = buildGoogleDriveAuthUrl(origin);
	return json({ url });
}

export async function DELETE({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const ok = await patchOptionsRecord({
		backupGoogleDriveRefreshToken: '',
		backupGoogleDriveEmail: '',
		backupGoogleDriveFolderId: '',
		backupGoogleDriveFolderName: '',
		backupDestGoogleDrive: false
	});

	if (!ok) {
		return json({ error: 'Failed to clear Google Drive connection' }, { status: 500 });
	}

	return json({ ok: true });
}
