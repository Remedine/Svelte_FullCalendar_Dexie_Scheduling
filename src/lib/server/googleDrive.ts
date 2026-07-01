import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { dateFromBackupFilename, shouldKeepBackupDate } from '$lib/backups/retention';

type DriveFile = { id: string; name: string };

function serviceAccountJson(): string | null {
	const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim();
	return raw || null;
}

export function resolveGoogleDriveFolderId(optionsFolderId?: string | null): string | null {
	const fromOptions = optionsFolderId?.trim();
	if (fromOptions) return fromOptions;
	const fromEnv = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
	return fromEnv || null;
}

export function isGoogleDriveConfigured(optionsFolderId?: string | null): boolean {
	return Boolean(serviceAccountJson() && resolveGoogleDriveFolderId(optionsFolderId));
}

async function getDriveClient() {
	const json = serviceAccountJson();
	if (!json) {
		throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not configured');
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

/** Upload backup artifacts from buffers to a shared Google Drive folder. */
export async function uploadBackupArtifactsToDrive(
	folderId: string,
	artifacts: Array<{ name: string; buffer: Buffer }>
): Promise<string[]> {
	if (artifacts.length === 0) return [];
	const drive = await getDriveClient();
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

/** Prune dated backup artifacts on Google Drive per spec §14.4 retention calendar. */
export async function pruneGoogleDriveBackupsByRetention(
	folderId: string,
	now = new Date()
): Promise<{ pruned: string[]; kept: number }> {
	const drive = await getDriveClient();
	const files = await listAllFilesInFolder(drive, folderId);
	const pruned: string[] = [];
	let kept = 0;

	for (const file of files) {
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