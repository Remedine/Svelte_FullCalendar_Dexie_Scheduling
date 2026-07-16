import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	randomUUID,
	timingSafeEqual
} from 'node:crypto';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { INTERNAL_SECRET } from '$env/static/private';
import {
	isNonFullBackupArtifact,
	isRestorableBackupFilename
} from '$lib/backups/names';
import { dateFromBackupFilename, shouldKeepBackupDate } from '$lib/backups/retention';

/** Prefix for AES-GCM sealed refresh tokens stored on options (readable by internal API). */
const TOKEN_SEAL_PREFIX = 'enc:v1:';

function tokenEncryptionKey(): Buffer {
	return createHash('sha256').update(`ccw-gdrive-token:${INTERNAL_SECRET}`).digest();
}

/** Seal a Google refresh token for storage (internal options field is not hidden — encrypt). */
export function sealDriveRefreshToken(plain: string): string {
	const value = plain?.trim();
	if (!value) return '';
	if (value.startsWith(TOKEN_SEAL_PREFIX)) return value;
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', tokenEncryptionKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return TOKEN_SEAL_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/** Open a stored refresh token (supports sealed + legacy plain values). */
export function openDriveRefreshToken(stored?: string | null): string {
	const value = stored?.trim();
	if (!value) return '';
	if (!value.startsWith(TOKEN_SEAL_PREFIX)) return value;
	try {
		const raw = Buffer.from(value.slice(TOKEN_SEAL_PREFIX.length), 'base64url');
		const iv = raw.subarray(0, 12);
		const tag = raw.subarray(12, 28);
		const data = raw.subarray(28);
		const decipher = createDecipheriv('aes-256-gcm', tokenEncryptionKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
	} catch (err) {
		console.error('[googleDrive] failed to open sealed refresh token:', err);
		return '';
	}
}

type DriveFile = { id: string; name: string };

export type DriveBackupFile = {
	id: string;
	name: string;
	size: number;
	modifiedTime: string;
	restorable: boolean;
};

export type GoogleDriveConnectionMeta = {
	refreshToken?: string | null;
	folderId?: string | null;
	folderName?: string | null;
	email?: string | null;
};

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEFAULT_FOLDER_NAME = 'Capital City Windows Backups';
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function serviceAccountJson(): string | null {
	const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim();
	return raw || null;
}

export function oauthClientId(): string | null {
	return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
}

export function oauthClientSecret(): string | null {
	return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;
}

/** True when the app can start a user OAuth connect flow (developer one-time env). */
export function isGoogleOAuthAppConfigured(): boolean {
	return Boolean(oauthClientId() && oauthClientSecret());
}

export function resolveGoogleDriveFolderId(optionsFolderId?: string | null): string | null {
	const fromOptions = optionsFolderId?.trim();
	if (fromOptions) return fromOptions;
	const fromEnv = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
	return fromEnv || null;
}

/** Ready to upload: OAuth refresh token or service account, plus a folder id. */
export function isGoogleDriveConfigured(
	optionsFolderId?: string | null,
	refreshToken?: string | null
): boolean {
	const folderId = resolveGoogleDriveFolderId(optionsFolderId);
	if (!folderId) return false;
	if (refreshToken?.trim()) return true;
	return Boolean(serviceAccountJson());
}

export function isGoogleDriveConnected(meta: GoogleDriveConnectionMeta): boolean {
	return Boolean(meta.refreshToken?.trim() || serviceAccountJson());
}

function oauthRedirectUri(appOrigin: string): string {
	const origin = appOrigin.replace(/\/$/, '');
	return `${origin}/api/admin/backups/google-drive/callback`;
}

function createOAuth2Client(appOrigin: string) {
	const clientId = oauthClientId();
	const clientSecret = oauthClientSecret();
	if (!clientId || !clientSecret) {
		throw new Error('Google OAuth is not configured (GOOGLE_OAUTH_CLIENT_ID / SECRET)');
	}
	return new google.auth.OAuth2(clientId, clientSecret, oauthRedirectUri(appOrigin));
}

function signOAuthState(payload: Record<string, unknown>): string {
	const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const sig = createHmac('sha256', INTERNAL_SECRET).update(body).digest('base64url');
	return `${body}.${sig}`;
}

function verifyOAuthState(state: string): { exp: number; nonce: string } | null {
	const [body, sig] = state.split('.');
	if (!body || !sig) return null;
	const expected = createHmac('sha256', INTERNAL_SECRET).update(body).digest('base64url');
	try {
		const a = Buffer.from(sig);
		const b = Buffer.from(expected);
		if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
			exp?: number;
			nonce?: string;
		};
		if (!parsed.exp || !parsed.nonce || Date.now() > parsed.exp) return null;
		return { exp: parsed.exp, nonce: parsed.nonce };
	} catch {
		return null;
	}
}

/** Build Google consent URL for admin Connect button. */
export function buildGoogleDriveAuthUrl(appOrigin: string): string {
	const client = createOAuth2Client(appOrigin);
	const state = signOAuthState({
		exp: Date.now() + OAUTH_STATE_TTL_MS,
		nonce: randomUUID()
	});
	return client.generateAuthUrl({
		access_type: 'offline',
		prompt: 'consent',
		scope: [DRIVE_FILE_SCOPE],
		include_granted_scopes: true,
		state
	});
}

export type OAuthExchangeResult = {
	refreshToken: string;
	email: string;
	folderId: string;
	folderName: string;
};

/** Exchange OAuth code, ensure backup folder exists, return connection fields. */
export async function completeGoogleDriveOAuth(
	appOrigin: string,
	code: string,
	state: string
): Promise<OAuthExchangeResult> {
	if (!verifyOAuthState(state)) {
		throw new Error('Invalid or expired Google sign-in. Please try Connect again.');
	}
	const client = createOAuth2Client(appOrigin);
	const { tokens } = await client.getToken(code);
	if (!tokens.refresh_token) {
		throw new Error(
			'Google did not return a refresh token. Disconnect the app in your Google Account permissions and try Connect again.'
		);
	}
	client.setCredentials(tokens);
	const drive = google.drive({ version: 'v3', auth: client });

	let email = '';
	try {
		const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' });
		email = about.data.user?.emailAddress?.trim() || '';
	} catch {
		// drive.file may still work without about; email is display-only
	}

	const folder = await ensureBackupFolder(drive, DEFAULT_FOLDER_NAME);

	return {
		refreshToken: tokens.refresh_token,
		email,
		folderId: folder.id,
		folderName: folder.name
	};
}

async function ensureBackupFolder(
	drive: ReturnType<typeof google.drive>,
	folderName: string
): Promise<{ id: string; name: string }> {
	const escaped = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
	const existing = await drive.files.list({
		q: `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
		fields: 'files(id, name)',
		pageSize: 5,
		spaces: 'drive'
	});
	const found = existing.data.files?.[0];
	if (found?.id && found.name) {
		return { id: found.id, name: found.name };
	}

	const created = await drive.files.create({
		requestBody: {
			name: folderName,
			mimeType: 'application/vnd.google-apps.folder'
		},
		fields: 'id, name'
	});
	if (!created.data.id) {
		throw new Error('Could not create Google Drive backup folder');
	}
	return {
		id: created.data.id,
		name: created.data.name || folderName
	};
}

async function getDriveClient(meta: GoogleDriveConnectionMeta = {}) {
	const refreshToken = meta.refreshToken?.trim();
	if (refreshToken) {
		const clientId = oauthClientId();
		const clientSecret = oauthClientSecret();
		if (!clientId || !clientSecret) {
			throw new Error('Google OAuth is not configured on the server');
		}
		// Redirect URI is not used for refresh, but OAuth2 client still needs credentials
		const client = new google.auth.OAuth2(clientId, clientSecret);
		client.setCredentials({ refresh_token: refreshToken });
		return google.drive({ version: 'v3', auth: client });
	}

	const json = serviceAccountJson();
	if (!json) {
		throw new Error('Google Drive is not connected');
	}
	const credentials = JSON.parse(json) as Record<string, unknown>;
	const auth = new google.auth.GoogleAuth({
		credentials,
		scopes: ['https://www.googleapis.com/auth/drive']
	});
	return google.drive({ version: 'v3', auth });
}

function mimeTypeForFilename(name: string): string {
	return name.toLowerCase().endsWith('.json') ? 'application/json' : 'application/zip';
}

async function listAllFilesInFolder(
	drive: ReturnType<typeof google.drive>,
	folderId: string
): Promise<DriveFile[]> {
	const files: DriveFile[] = [];
	let pageToken: string | undefined;
	do {
		const res = await drive.files.list({
			q: `'${folderId}' in parents and trashed=false`,
			fields: 'nextPageToken, files(id, name)',
			pageSize: 200,
			pageToken,
			supportsAllDrives: true,
			includeItemsFromAllDrives: true
		});
		for (const f of res.data.files ?? []) {
			if (f.id && f.name) files.push({ id: f.id, name: f.name });
		}
		pageToken = res.data.nextPageToken ?? undefined;
	} while (pageToken);
	return files;
}

/** List backup artifacts in the connected Drive folder (with size / modified). */
export async function listGoogleDriveBackupFiles(
	folderId: string,
	meta: GoogleDriveConnectionMeta = {}
): Promise<DriveBackupFile[]> {
	const drive = await getDriveClient(meta);
	const files: DriveBackupFile[] = [];
	let pageToken: string | undefined;
	do {
		const res = await drive.files.list({
			q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
			fields: 'nextPageToken, files(id, name, size, modifiedTime, createdTime)',
			pageSize: 200,
			pageToken,
			orderBy: 'modifiedTime desc',
			supportsAllDrives: true,
			includeItemsFromAllDrives: true
		});
		for (const f of res.data.files ?? []) {
			if (!f.id || !f.name) continue;
			// Only show known backup-style artifacts
			const lower = f.name.toLowerCase();
			if (!lower.endsWith('.zip') && !lower.endsWith('.json')) continue;
			files.push({
				id: f.id,
				name: f.name,
				size: Number(f.size ?? 0),
				modifiedTime: f.modifiedTime || f.createdTime || '',
				restorable: isRestorableBackupFilename(f.name)
			});
		}
		pageToken = res.data.nextPageToken ?? undefined;
	} while (pageToken);

	files.sort((a, b) => {
		const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
		const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
		return tb - ta;
	});
	return files;
}

/** Download a file from the connected Google Drive account into a Buffer. */
export async function downloadGoogleDriveFileBuffer(
	fileId: string,
	meta: GoogleDriveConnectionMeta = {}
): Promise<Buffer> {
	const drive = await getDriveClient(meta);
	const res = await drive.files.get(
		{
			fileId,
			alt: 'media',
			supportsAllDrives: true
		},
		{ responseType: 'arraybuffer' }
	);
	const data = res.data as ArrayBuffer | Buffer | string;
	if (Buffer.isBuffer(data)) return data;
	if (typeof data === 'string') return Buffer.from(data);
	return Buffer.from(data);
}

/** Upload backup artifacts from buffers to the connected Google Drive folder. */
export async function uploadBackupArtifactsToDrive(
	folderId: string,
	artifacts: Array<{ name: string; buffer: Buffer }>,
	meta: GoogleDriveConnectionMeta = {}
): Promise<string[]> {
	if (artifacts.length === 0) return [];
	const drive = await getDriveClient(meta);
	const uploaded: string[] = [];

	const existingByName = new Map(
		(await listAllFilesInFolder(drive, folderId)).map((f) => [f.name, f.id])
	);

	for (const artifact of artifacts) {
		const oldId = existingByName.get(artifact.name);
		if (oldId) {
			await drive.files.delete({ fileId: oldId, supportsAllDrives: true });
		}

		await drive.files.create({
			requestBody: {
				name: artifact.name,
				parents: [folderId]
			},
			media: {
				mimeType: mimeTypeForFilename(artifact.name),
				body: Readable.from(artifact.buffer)
			},
			fields: 'id, name',
			supportsAllDrives: true
		});
		uploaded.push(artifact.name);
	}

	return uploaded;
}

/** Delete retired fragment/legacy backup files from the Drive backup folder. */
export async function pruneGoogleDriveNonFullArtifacts(
	folderId: string,
	meta: GoogleDriveConnectionMeta = {}
): Promise<string[]> {
	const drive = await getDriveClient(meta);
	const files = await listAllFilesInFolder(drive, folderId);
	const pruned: string[] = [];

	for (const file of files) {
		if (!isNonFullBackupArtifact(file.name)) continue;
		try {
			await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
			pruned.push(file.name);
		} catch (err) {
			console.error('[googleDrive] non-full prune failed for', file.name, err);
		}
	}

	return pruned;
}

/** Prune dated full backups on Google Drive per calendar retention. */
export async function pruneGoogleDriveBackupsByRetention(
	folderId: string,
	now = new Date(),
	meta: GoogleDriveConnectionMeta = {}
): Promise<{ pruned: string[]; kept: number }> {
	const drive = await getDriveClient(meta);
	const files = await listAllFilesInFolder(drive, folderId);
	const pruned: string[] = [];
	let kept = 0;

	for (const file of files) {
		if (isNonFullBackupArtifact(file.name)) {
			// Handled by pruneGoogleDriveNonFullArtifacts
			continue;
		}
		const date = dateFromBackupFilename(file.name);
		if (!date) {
			kept++;
			continue;
		}
		if (shouldKeepBackupDate(date, now)) {
			kept++;
			continue;
		}
		await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
		pruned.push(file.name);
	}

	return { pruned, kept };
}

export function optionsPageRedirect(
	appOrigin: string,
	params: Record<string, string>
): string {
	const origin = appOrigin.replace(/\/$/, '');
	const qs = new URLSearchParams({ tab: 'backups', ...params });
	return `${origin}/admin/options?${qs.toString()}`;
}

export function resolveAppOrigin(request: Request): string {
	const envUrl =
		process.env.PUBLIC_APP_URL?.trim() ||
		(process.env.RAILWAY_PUBLIC_DOMAIN
			? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`
			: '');
	if (envUrl) return envUrl.replace(/\/$/, '');

	const proto = request.headers.get('x-forwarded-proto') || 'https';
	const host =
		request.headers.get('x-forwarded-host') ||
		request.headers.get('host') ||
		'localhost';
	return `${proto}://${host}`.replace(/\/$/, '');
}
