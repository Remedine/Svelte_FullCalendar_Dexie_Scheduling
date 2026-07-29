<!-- src/routes/(app)/admin/options/+page.svelte -->
<script lang="ts">
	// )=- Complete Options Page - All sections active with dynamic data
	// )=- Cleaned up redundant role guards and legacy onMount (causing load-time errors and potential auth redirects on navigation).
	// Central layout guard in (app)/+layout.svelte now handles admin-only access consistently.
	import { optionsStore } from '$lib/stores/options.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import {
		toast,
		isRestoreCountdownActive,
		RESTORE_COUNTDOWN_KEY
	} from '$lib/stores/toast.svelte';
	import {
		hour12To24,
		hour24To12,
		type Hour12Period
	} from '$lib/utils/dates';
	import { db } from '$lib/db';
	import { pb } from '$lib/db/pb';
	import { isFullBackupFilename } from '$lib/backups/names';
	import { dateFromBackupFilename, SERVER_SAFETY_NET_DAYS } from '$lib/backups/retention';
	import { page } from '$app/state';
	import BulkImportPanel from '$lib/components/BulkImportPanel.svelte';

	// )=- Removed top-level non-admin redirect $effect (layout guard already handles role-based access and redirects non-admins away from /admin/* to /calendar).
	// This avoids duplicate redirects and race conditions on navigation.

	// )=- Converted from onMount to $effect for Svelte 5 runes compliance (auth cleanup / HYG-01).
	$effect(() => {
		// Load options once when authenticated as admin
		if (!auth.loading && auth.currentUser?.role === 'admin' && !optionsInitialized) {
			optionsInitialized = true;
			optionsStore.load();

			if (navigator.onLine) {
				optionsStore.pullFromPB().then((pulled) => {
					if (pulled) {
						console.log('✅ Fresh options pulled from PocketBase on load');
					}
				});
			}
		}
	});

	let isSaving = $state(false);
	let activeTab = $state<'scheduling' | 'security' | 'invoice' | 'backups' | 'import'>(
		'scheduling'
	);

	type DriveStatus = {
		oauthAppReady: boolean;
		connected: boolean;
		hasOAuthToken: boolean;
		hasServiceAccount: boolean;
		needsReconnect?: boolean;
		email: string;
		folderId: string;
		folderName: string;
		destEnabled: boolean;
	};
	let driveStatus = $state<DriveStatus | null>(null);
	let driveStatusLoading = $state(false);
	let driveActionBusy = $state(false);
	let driveReturnHandled = false;
	/** Sticky on-page error (toasts alone dismiss too fast for long Google setup messages). */
	let driveErrorBanner = $state('');

	// )=- One-time flag to ensure options load/pull happens only once, preventing repeated pull attempts and error spam if pull fails.
	let optionsInitialized = $state(false);

	// )=- Removed redundant role guard $effect (central layout guard in (app)/+layout.svelte already enforces admin-only access).
	// Rely on layout for consistency and to avoid race conditions during navigation.

	// )=- Removed duplicate top-level role guard $effect (was causing potential premature redirects during auth hydration/navigation).
	// The layout guard + the loading $effect below are sufficient.

	const tabs = [
		{ id: 'scheduling', label: 'Scheduling Options' },
		{ id: 'invoice', label: 'Invoice Options' },
		{ id: 'security', label: 'App Security' },
		{ id: 'backups', label: 'Backups' },
		{ id: 'import', label: 'Import' }
	] as const;

	type BackupRow = { name: string; size: number; created: string };
	type DriveBackupRow = {
		id: string;
		name: string;
		size: number;
		modifiedTime: string;
		restorable: boolean;
	};
	type UnifiedBackupRow = {
		name: string;
		size: number;
		created: string;
		onServer: boolean;
		onDrive: boolean;
		driveFileId?: string;
	};
	let backupItems = $state<BackupRow[]>([]);
	let backupRetention = $state<{ total: number; wouldKeep: number; wouldPrune: number } | null>(
		null
	);
	let backupLoading = $state(false);
	let backupRunning = $state(false);
	let backupUploading = $state(false);
	let driveBackupItems = $state<DriveBackupRow[]>([]);
	let driveBackupLoading = $state(false);
	let driveBackupError = $state('');
	let restoreTarget = $state<string | null>(null);
	let backupsHowOpen = $state(false);
	let backupsAdvancedOpen = $state(false);

	/** Merge server + Drive full backups by filename. */
	const unifiedBackupItems = $derived.by((): UnifiedBackupRow[] => {
		const map = new Map<string, UnifiedBackupRow>();

		for (const item of backupItems) {
			if (!isFullBackupFilename(item.name)) continue;
			map.set(item.name, {
				name: item.name,
				size: item.size,
				created: item.created,
				onServer: true,
				onDrive: false
			});
		}

		for (const item of driveBackupItems) {
			if (!isFullBackupFilename(item.name)) continue;
			const existing = map.get(item.name);
			if (existing) {
				existing.onDrive = true;
				existing.driveFileId = item.id;
				if (!existing.size && item.size) existing.size = item.size;
				if (!existing.created && item.modifiedTime) existing.created = item.modifiedTime;
			} else {
				map.set(item.name, {
					name: item.name,
					size: item.size,
					created: item.modifiedTime,
					onServer: false,
					onDrive: true,
					driveFileId: item.id
				});
			}
		}

		return [...map.values()].sort((a, b) => {
			const da = dateFromBackupFilename(a.name) || '';
			const db = dateFromBackupFilename(b.name) || '';
			if (da !== db) return db.localeCompare(da);
			return b.name.localeCompare(a.name);
		});
	});

	const backupStatusTone = $derived.by(() => {
		const s = String(editingOptions?.lastBackupStatus || '').toLowerCase();
		if (s === 'success' || s === 'ok') return 'ok';
		if (s === 'failed' || s === 'error') return 'fail';
		return 'unknown';
	});

	function locationLabel(row: UnifiedBackupRow): string {
		if (row.onServer && row.onDrive) return 'Server + Drive';
		if (row.onDrive) return 'Google Drive';
		return 'Server';
	}

	function friendlyBackupDate(row: UnifiedBackupRow): string {
		const fromName = dateFromBackupFilename(row.name);
		if (fromName) {
			try {
				const [y, m, d] = fromName.split('-').map(Number);
				return new Date(y, m - 1, d).toLocaleDateString('en-US', {
					weekday: 'short',
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					timeZone: 'America/Anchorage'
				});
			} catch {
				return fromName;
			}
		}
		return formatBackupDate(row.created);
	}

	function openRestoreForRow(row: UnifiedBackupRow) {
		if (row.onServer) {
			openRestoreDialog(row.name);
			return;
		}
		if (row.onDrive && row.driveFileId) {
			openRestoreDialog(row.name, { source: 'drive', fileId: row.driveFileId });
		}
	}
	let restoreSource = $state<'server' | 'drive'>('server');
	let restoreDriveFileId = $state<string | null>(null);
	let restoreConfirmText = $state('');
	let restoreRestoring = $state(false);
	let uploadFileInput = $state<HTMLInputElement | null>(null);
	/** Prevents the backups-tab $effect from re-fetching after ensureFreshAdminSession touches auth. */
	let backupListPrimedForTab = false;
	let backupListLoadInFlight: Promise<void> | null = null;

	let editingOptions = $state<any>({});
	let crewAssignmentHour12 = $state(7);
	let crewAssignmentPeriod = $state<Hour12Period>('AM');
	let backupScheduledHour12 = $state(11);
	let backupScheduledPeriod = $state<Hour12Period>('PM');

	function safeClone(obj: any) {
		if (!obj) return {};
		try {
			return JSON.parse(
				JSON.stringify(obj, (key, value) => {
					if (value instanceof Date) return value.toISOString();
					return value;
				})
			);
		} catch {
			return { ...obj };
		}
	}

	$effect(() => {
		const hour24 = Number(editingOptions.crewAssignmentHour);
		if (!Number.isNaN(hour24) && hour24 >= 0 && hour24 <= 23) {
			const { hour12, period } = hour24To12(hour24);
			crewAssignmentHour12 = hour12;
			crewAssignmentPeriod = period;
		}
	});

	$effect(() => {
		const hour24 = Number(editingOptions.backupScheduledHour);
		if (!Number.isNaN(hour24) && hour24 >= 0 && hour24 <= 23) {
			const { hour12, period } = hour24To12(hour24);
			backupScheduledHour12 = hour12;
			backupScheduledPeriod = period;
		}
	});

	$effect(() => {
		if (optionsStore.data) {
			editingOptions = safeClone(optionsStore.data);
		} else if (!editingOptions?.id) {
			// )=- Fallback: if store data not yet populated (e.g. first load), seed a minimal
			// object with id so saveOptions doesn't immediately error with "No options data loaded to save".
			editingOptions = {
				id: 1,
				defaultJobDurationHours: 2,
				taxRate: 5,
				invoiceDueDays: 30,
				businessName: 'Capital City Windows',
				salesTaxJurisdiction: 'City and Borough of Juneau sales tax',
				invoiceNumberPrefix: 'CCW',
				nextInvoiceNumber: 1,
				crewAssignmentDaysBefore: 1,
				crewAssignmentHour: 7,
				calendarDayStartHour: 6,
				calendarDayEndHour: 22,
				quickUnlockIdleMinutes: 120,
				desktopSecurityIdleMinutes: 30,
				backupScheduledEnabled: false,
				backupScheduledHour: 23,
				backupDestEmail: false,
				backupDestGoogleDrive: false,
				backupGoogleDriveFolderId: '',
				backupGoogleDriveEmail: '',
				backupGoogleDriveFolderName: '',
				backupAlertEmails: '',
				areasOfTown: [],
				defaultBillableItems: [],
				cancelReasons: []
			};
		}
	});

	/** Deep-link from Google OAuth callback: /admin/options?tab=backups&gdrive=… */
	$effect(() => {
		const tab = page.url.searchParams.get('tab');
		if (
			tab === 'backups' ||
			tab === 'scheduling' ||
			tab === 'security' ||
			tab === 'invoice' ||
			tab === 'import'
		) {
			activeTab = tab;
		}
		if (driveReturnHandled) return;
		const gdrive = page.url.searchParams.get('gdrive');
		if (!gdrive) return;
		driveReturnHandled = true;
		if (gdrive === 'connected') {
			driveErrorBanner = '';
			const email = page.url.searchParams.get('email') || 'Google Drive';
			toast.success(`Google Drive connected (${email}). Backups can upload there.`);
			if (editingOptions) {
				editingOptions.backupDestGoogleDrive = true;
				editingOptions.backupGoogleDriveEmail = email === 'Google Drive' ? '' : email;
			}
			void loadDriveStatus();
		} else if (gdrive === 'error') {
			const message =
				page.url.searchParams.get('message') || 'Could not connect Google Drive.';
			driveErrorBanner = message;
			toast.error(message, 20000);
		}
		// Clean query params without full navigation noise
		if (typeof history !== 'undefined' && page.url.searchParams.has('gdrive')) {
			const clean = new URL(page.url);
			clean.searchParams.delete('gdrive');
			clean.searchParams.delete('message');
			clean.searchParams.delete('email');
			if (!clean.searchParams.get('tab')) clean.searchParams.set('tab', 'backups');
			history.replaceState(history.state, '', clean.pathname + clean.search);
		}
	});

	async function saveOptions() {
		if (!editingOptions?.id) {
			toast.error('No options data loaded to save');
			return;
		}

		const daysBefore = Number(editingOptions.crewAssignmentDaysBefore);
		const hour12 = Number(crewAssignmentHour12);
		if (Number.isNaN(daysBefore) || daysBefore < 0 || daysBefore > 365) {
			toast.error('Crew notification days-before must be between 0 and 365.');
			return;
		}
		if (Number.isNaN(hour12) || hour12 < 1 || hour12 > 12) {
			toast.error('Crew notification time must be between 1 and 12.');
			return;
		}
		if (crewAssignmentPeriod !== 'AM' && crewAssignmentPeriod !== 'PM') {
			toast.error('Select AM or PM for crew notification time.');
			return;
		}
		const hour = hour12To24(hour12, crewAssignmentPeriod);
		if (Number.isNaN(hour)) {
			toast.error('Invalid crew notification time.');
			return;
		}

		const backupHour12 = Number(backupScheduledHour12);
		if (Number.isNaN(backupHour12) || backupHour12 < 1 || backupHour12 > 12) {
			toast.error('Scheduled backup time must be between 1 and 12.');
			return;
		}
		if (backupScheduledPeriod !== 'AM' && backupScheduledPeriod !== 'PM') {
			toast.error('Select AM or PM for scheduled backup time.');
			return;
		}
		const backupHour = hour12To24(backupHour12, backupScheduledPeriod);
		if (Number.isNaN(backupHour)) {
			toast.error('Invalid scheduled backup time.');
			return;
		}

		const calStart = Number(editingOptions.calendarDayStartHour);
		const calEnd = Number(editingOptions.calendarDayEndHour);
		if (Number.isNaN(calStart) || calStart < 0 || calStart > 22) {
			toast.error('Calendar start hour must be between 0 and 22.');
			return;
		}
		if (Number.isNaN(calEnd) || calEnd < 1 || calEnd > 24 || calEnd <= calStart) {
			toast.error('Calendar end hour must be after start hour (1–24).');
			return;
		}

		const idleMinutes = Number(editingOptions.quickUnlockIdleMinutes ?? 120);
		if (Number.isNaN(idleMinutes) || idleMinutes < 1 || idleMinutes > 24 * 60) {
			toast.error('Quick unlock idle time must be between 1 and 1440 minutes.');
			return;
		}

		const desktopIdleMinutes = Number(editingOptions.desktopSecurityIdleMinutes ?? 30);
		if (Number.isNaN(desktopIdleMinutes) || desktopIdleMinutes < 1 || desktopIdleMinutes > 24 * 60) {
			toast.error('Desktop security idle time must be between 1 and 1440 minutes.');
			return;
		}

		isSaving = true;

		try {
			const updated = {
				...editingOptions,
				calendarDayStartHour: calStart,
				calendarDayEndHour: calEnd,
				quickUnlockIdleMinutes: idleMinutes,
				desktopSecurityIdleMinutes: desktopIdleMinutes,
				crewAssignmentHour: hour,
				backupScheduledHour: backupHour,
				// Success email attach retired — failure alerts use backupAlertEmails only
				backupDestEmail: false,
				lastUpdated: new Date(),
				updatedBy: auth.currentUser?.name || 'Admin'
			};

			// Local-first + sync queue (offline edits flush on reconnect via processSyncQueue).
			await optionsStore.saveLocalAndQueue(updated);

			editingOptions = safeClone(updated);
			if (!navigator.onLine) {
				toast.success('Options saved offline. They will sync when you are back online.');
			} else {
				const stillPending = await db.syncQueue.where('collection').equals('options').count();
				if (stillPending > 0) {
					toast.success('Options saved locally. Cloud sync will retry shortly.');
				} else {
					toast.success('Options saved and synced successfully!');
				}
			}
		} catch (err) {
			console.error('Save error:', err);
			toast.error('Saved locally. Cloud sync encountered an issue.');
		} finally {
			isSaving = false;
		}
	}

	// === Areas of Town helpers ===
	function addNewArea() {
		if (!editingOptions.areasOfTown) editingOptions.areasOfTown = [];
		editingOptions.areasOfTown.push({
			id: 'new-area-' + Date.now(),
			label: 'New Area',
			color: '#64748b'
		});
		editingOptions.areasOfTown = [...editingOptions.areasOfTown];
	}

	function deleteArea(id: string) {
		if (confirm(`Delete this area?`)) {
			editingOptions.areasOfTown = editingOptions.areasOfTown.filter((a: any) => a.id !== id);
		}
	}

	function moveAreaUp(index: number) {
		if (index <= 0) return;
		const arr = editingOptions.areasOfTown;
		[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
		editingOptions.areasOfTown = [...arr];
	}

	function moveAreaDown(index: number) {
		const arr = editingOptions.areasOfTown;
		if (index === -1 || index === arr.length - 1) return;
		[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
		editingOptions.areasOfTown = [...arr];
	}

	function isDefaultArea(index: number): boolean {
		return index === 0;
	}

	// === Billable Items helpers ===
	function moveBillableUp(index: number) {
		if (index <= 0) return;
		const arr = editingOptions.defaultBillableItems;
		[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
		editingOptions.defaultBillableItems = [...arr];
	}

	function moveBillableDown(index: number) {
		const arr = editingOptions.defaultBillableItems;
		if (index === -1 || index === arr.length - 1) return;
		[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
		editingOptions.defaultBillableItems = [...arr];
	}

	function isDefaultBillable(index: number): boolean {
		return index === 0;
	}

	// === Cancellation Reasons helpers ===
	function addCancelReason() {
		if (!editingOptions.cancelReasons) editingOptions.cancelReasons = [];
		editingOptions.cancelReasons.push('New Cancellation Reason');
		editingOptions.cancelReasons = [...editingOptions.cancelReasons];
	}

	function deleteCancelReason(index: number) {
		if (confirm('Delete this cancellation reason?')) {
			editingOptions.cancelReasons.splice(index, 1);
			editingOptions.cancelReasons = [...editingOptions.cancelReasons];
		}
	}

	function moveCancelReasonUp(index: number) {
		if (index <= 0) return;
		const arr = editingOptions.cancelReasons;
		[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
		editingOptions.cancelReasons = [...arr];
	}

	function moveCancelReasonDown(index: number) {
		const arr = editingOptions.cancelReasons;
		if (index === -1 || index === arr.length - 1) return;
		[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
		editingOptions.cancelReasons = [...arr];
	}

	function isDefaultCancelReason(index: number): boolean {
		return index === 0;
	}

	function formatBytes(bytes: number): string {
		if (!bytes || bytes < 1) return '—';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	}

	function formatBackupDate(iso: string | undefined): string {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Anchorage' });
		} catch {
			return iso;
		}
	}

	async function ensureFreshAdminSession() {
		const { syncPbAuthRecord } = await import('$lib/db/pb');
		const rec = await syncPbAuthRecord();
		if (rec?.role === 'admin' && auth.currentUser) {
			const active = rec.active ?? true;
			// Avoid replacing auth.currentUser when nothing changed — that re-triggers reactive effects.
			if (auth.currentUser.role !== 'admin' || auth.currentUser.active !== active) {
				auth.currentUser = { ...auth.currentUser, role: 'admin', active };
			}
		}
	}

	async function loadBackupList(options: { showLoading?: boolean } = {}) {
		const { showLoading = backupItems.length === 0 } = options;
		if (!pb?.authStore?.token) return;
		if (backupListLoadInFlight) return backupListLoadInFlight;

		backupListLoadInFlight = (async () => {
			await ensureFreshAdminSession();
			if (showLoading) backupLoading = true;
			try {
				const res = await fetch('/api/admin/backups', {
					headers: { Authorization: pb.authStore.token }
				});
				if (!res.ok) throw new Error('Failed to load backups');
				const data = await res.json();
				backupItems = data.items ?? [];
				backupRetention = data.retention ?? null;
			} catch (err) {
				console.error(err);
				if (!isRestoreCountdownActive()) {
					toast.error('Could not load backup list');
				}
			} finally {
				if (showLoading) backupLoading = false;
			}
		})().finally(() => {
			backupListLoadInFlight = null;
		});

		return backupListLoadInFlight;
	}

	async function loadDriveStatus() {
		if (!pb?.authStore?.token) return;
		driveStatusLoading = true;
		try {
			await ensureFreshAdminSession();
			const res = await fetch('/api/admin/backups/google-drive', {
				headers: { Authorization: pb.authStore.token }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.error || 'Failed to load Google Drive status');
			}
			driveStatus = data as DriveStatus;
			if (editingOptions && data.connected) {
				editingOptions.backupGoogleDriveEmail = data.email || '';
				editingOptions.backupGoogleDriveFolderId = data.folderId || '';
				editingOptions.backupGoogleDriveFolderName = data.folderName || '';
				if (data.destEnabled) editingOptions.backupDestGoogleDrive = true;
			}
			if (data.connected) {
				void loadDriveBackupList();
			} else {
				driveBackupItems = [];
			}
		} catch (err: any) {
			console.warn('[backups] drive status:', err?.message || err);
		} finally {
			driveStatusLoading = false;
		}
	}

	async function connectGoogleDrive() {
		if (!pb?.authStore?.token) return;
		driveActionBusy = true;
		try {
			await ensureFreshAdminSession();
			const res = await fetch('/api/admin/backups/google-drive', {
				method: 'POST',
				headers: { Authorization: pb.authStore.token }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.error || 'Could not start Google sign-in');
			}
			if (!data.url) throw new Error('No Google sign-in URL returned');
			window.location.href = data.url as string;
		} catch (err: any) {
			const message = err?.message || 'Could not connect Google Drive';
			driveErrorBanner = message;
			toast.error(message, 20000);
			driveActionBusy = false;
		}
	}

	async function disconnectGoogleDrive() {
		if (!pb?.authStore?.token) return;
		const ok = confirm(
			'Disconnect Google Drive? Future backups will not upload to Drive until you connect again.'
		);
		if (!ok) return;
		driveActionBusy = true;
		try {
			await ensureFreshAdminSession();
			const res = await fetch('/api/admin/backups/google-drive', {
				method: 'DELETE',
				headers: { Authorization: pb.authStore.token }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.error || 'Disconnect failed');
			}
			if (editingOptions) {
				editingOptions.backupDestGoogleDrive = false;
				editingOptions.backupGoogleDriveFolderId = '';
				editingOptions.backupGoogleDriveEmail = '';
				editingOptions.backupGoogleDriveFolderName = '';
			}
			toast.success('Google Drive disconnected');
			await loadDriveStatus();
		} catch (err: any) {
			toast.error(err?.message || 'Disconnect failed');
		} finally {
			driveActionBusy = false;
		}
	}

	async function runBackupNow() {
		if (!pb?.authStore?.token) return;
		await ensureFreshAdminSession();
		backupRunning = true;
		try {
			const res = await fetch('/api/admin/backups', {
				method: 'POST',
				headers: {
					Authorization: pb.authStore.token,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.error || 'Backup failed');
			}
			const driveNote =
				Array.isArray(data.uploadedToDrive) && data.uploadedToDrive.length > 0
					? ' Saved to Google Drive.'
					: editingOptions.backupDestGoogleDrive
						? ' Kept on server (Drive upload did not complete).'
						: ' Saved on this server.';
			toast.success(`Backup complete.${driveNote}`);
			if (data.driveError) {
				driveErrorBanner = String(data.driveError);
				toast.error(String(data.driveError), 20000);
			}
			editingOptions.lastBackupAt = new Date().toISOString();
			editingOptions.lastBackupStatus = 'success';
			editingOptions.lastBackupFilename = data.filename;
			editingOptions.lastBackupSizeBytes = data.size;
			editingOptions.lastBackupError = '';
			await loadBackupList();
			void loadDriveBackupList();
			await optionsStore.pullFromPB();
		} catch (err: any) {
			toast.error(err?.message || 'Backup failed');
		} finally {
			backupRunning = false;
		}
	}

	function downloadBackup(name: string) {
		if (!pb?.authStore?.token) return;
		const url = `/api/admin/backups/download?name=${encodeURIComponent(name)}`;
		fetch(url, { headers: { Authorization: pb.authStore.token } })
			.then((res) => {
				if (!res.ok) throw new Error('Download failed');
				return res.blob();
			})
			.then((blob) => {
				const a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = name;
				a.click();
				URL.revokeObjectURL(a.href);
			})
			.catch(() => toast.error('Could not download backup'));
	}

	function openRestoreDialog(
		name: string,
		opts?: { source?: 'server' | 'drive'; fileId?: string }
	) {
		restoreTarget = name;
		restoreSource = opts?.source ?? 'server';
		restoreDriveFileId = opts?.fileId ?? null;
		restoreConfirmText = '';
	}

	function closeRestoreDialog() {
		restoreTarget = null;
		restoreSource = 'server';
		restoreDriveFileId = null;
		restoreConfirmText = '';
	}

	async function confirmRestore() {
		if (!restoreTarget || !pb?.authStore?.token) return;
		await ensureFreshAdminSession();
		if (restoreConfirmText.trim() !== restoreTarget) {
			toast.error('Type the exact backup filename to confirm');
			return;
		}
		if (restoreSource === 'drive' && !restoreDriveFileId) {
			toast.error('Missing Google Drive file id');
			return;
		}
		restoreRestoring = true;
		try {
			const url =
				restoreSource === 'drive'
					? '/api/admin/backups/google-drive/restore'
					: '/api/admin/backups/restore';
			const body =
				restoreSource === 'drive'
					? {
							fileId: restoreDriveFileId,
							name: restoreTarget,
							confirmName: restoreConfirmText.trim()
						}
					: {
							name: restoreTarget,
							confirmName: restoreConfirmText.trim()
						};
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: pb.authStore.token,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body)
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Restore failed');
			closeRestoreDialog();
			const fromDrive =
				restoreSource === 'drive' || data.stagedFromDrive
					? ' (downloaded from Google Drive first)'
					: '';
			toast.showCountdown(
				`Restore started${fromDrive}. PocketBase is restarting — all devices will sign out automatically`,
				90,
				{
					type: 'info',
					doneMessage:
						'Restore complete. You will be signed out shortly to refresh your data.',
					persistKey: RESTORE_COUNTDOWN_KEY
				}
			);
		} catch (err: any) {
			toast.error(err?.message || 'Restore failed', 20000);
		} finally {
			restoreRestoring = false;
		}
	}

	async function loadDriveBackupList() {
		if (!pb?.authStore?.token) return;
		// Only when Drive is actually usable for listing
		if (driveStatus && !driveStatus.connected && !driveStatus.hasOAuthToken) {
			driveBackupItems = [];
			driveBackupError = '';
			return;
		}
		driveBackupLoading = true;
		driveBackupError = '';
		try {
			await ensureFreshAdminSession();
			const res = await fetch('/api/admin/backups/google-drive/files', {
				headers: { Authorization: pb.authStore.token }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.error || 'Failed to list Google Drive backups');
			}
			driveBackupItems = (data.items ?? []) as DriveBackupRow[];
		} catch (err: any) {
			driveBackupItems = [];
			driveBackupError = err?.message || 'Could not list Google Drive backups';
		} finally {
			driveBackupLoading = false;
		}
	}

	async function uploadBackupZip() {
		const file = uploadFileInput?.files?.[0];
		if (!file || !pb?.authStore?.token) {
			toast.error('Choose a .zip backup file first');
			return;
		}
		if (!file.name.toLowerCase().endsWith('.zip')) {
			toast.error('Backup must be a .zip file');
			return;
		}
		if (!isFullBackupFilename(file.name)) {
			toast.error('Upload a full backup file (name ends with _full.zip)');
			return;
		}
		await ensureFreshAdminSession();
		backupUploading = true;
		try {
			const form = new FormData();
			form.append('file', file);
			const res = await fetch('/api/admin/backups/upload', {
				method: 'POST',
				headers: { Authorization: pb.authStore.token },
				body: form
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Upload failed');
			toast.success(`Uploaded ${data.name}. You can restore it from the list.`);
			if (uploadFileInput) uploadFileInput.value = '';
			await loadBackupList();
		} catch (err: any) {
			toast.error(err?.message || 'Upload failed');
		} finally {
			backupUploading = false;
		}
	}

	$effect(() => {
		if (activeTab !== 'backups') {
			backupListPrimedForTab = false;
			return;
		}
		if (auth.loading || auth.currentUser?.role !== 'admin') return;
		if (backupListPrimedForTab) return;
		backupListPrimedForTab = true;
		void loadBackupList();
		void loadDriveStatus().then(() => loadDriveBackupList());
	});

	// )=- Removed legacy onMount (duplicate of the $effect below, and onMount not imported — would throw ReferenceError on page load, potentially causing navigation/auth guard side-effects like redirect to login).
	// The $effect above (lines ~17-30) handles loading when admin role is confirmed and not loading.
	// )=- Also removed redundant role guard $effects that could fire during auth transitions and cause unwanted redirects (layout guard is the single source of truth).
</script>

<svelte:head>
	<title>Options - Capital City Windows</title>
</svelte:head>

<div class="options-page">
	<div class="options-page__header">
		<h1 class="options-page__title">Business Options</h1>
		<p class="options-page__subtitle">Configure system-wide settings • Admin only</p>
	</div>

	<!-- Tabs -->
	<div class="options-page__tabs">
		{#each tabs as tab, idx (idx)}
			<button
				class="options-page__tab {activeTab === tab.id ? 'options-page__tab--active' : ''}"
				onclick={() => (activeTab = tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Tab Content -->
	<div class="options-page__content">
		{#if activeTab === 'scheduling'}
			<h2>Scheduling Options</h2>

			<!-- General -->
			<div class="form-section">
				<h3>General</h3>
				<div class="form-grid">
					<label for="opt-duration" class="label">Default Job Duration (hours)</label>
					<input
						id="opt-duration"
						type="number"
						step="0.25"
						class="input"
						bind:value={editingOptions.defaultJobDurationHours}
					/>
				</div>
			</div>

			<!-- Areas of Town -->
			<div class="form-section">
				<h3>Areas of Town</h3>
				<p class="options-page__help">
					The **top area** is used as the default for new jobs. Use arrows to reorder.
				</p>

				{#if editingOptions?.areasOfTown?.length}
					<div class="areas-list">
						{#each editingOptions.areasOfTown as area, index (area.id)}
							<div class="area-item {isDefaultArea(index) ? 'area-item--default' : ''}">
								<input
									class="area-item__label-input input"
									bind:value={area.label}
									placeholder="Area name"
								/>

								<input type="color" class="area-item__color" bind:value={area.color} />

								<div class="area-item__controls">
									<button
										type="button"
										class="area-item__move-btn"
										onclick={() => moveAreaUp(index)}
										disabled={index === 0}
									>
										↑
									</button>
									<button
										type="button"
										class="area-item__move-btn"
										onclick={() => moveAreaDown(index)}
										disabled={index === editingOptions.areasOfTown.length - 1}
									>
										↓
									</button>
									<button
										type="button"
										class="area-item__remove"
										onclick={() => deleteArea(area.id)}
									>
										✕
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<button type="button" class="options-page__btn options-page__btn--add" onclick={addNewArea}>
					+ Add New Area
				</button>
			</div>

			<div class="form-section">
				<h3>Calendar Business Hours</h3>
				<p class="options-page__help">
					Controls the visible time range on the schedule day/week views (local time).
				</p>
				<div class="form-grid">
					<label for="opt-cal-start" class="label">Day starts (hour, 0–23)</label>
					<input
						id="opt-cal-start"
						type="number"
						min="0"
						max="22"
						class="input"
						bind:value={editingOptions.calendarDayStartHour}
					/>
					<label for="opt-cal-end" class="label">Day ends (hour, 1–24)</label>
					<input
						id="opt-cal-end"
						type="number"
						min="1"
						max="24"
						class="input"
						bind:value={editingOptions.calendarDayEndHour}
					/>
				</div>
			</div>

			<div class="form-section">
				<h3>Crew Assignment Notifications</h3>
				<p class="options-page__help">
					When crew are assigned to a job, an email is queued for each crew member (using their
					account email) and sent once on the notification day at the scheduled Alaska time — not
					immediately. Server cron and the open app both respect the same hour and dedup log.
				</p>
				<div class="form-grid">
					<label for="opt-crew-days" class="label">Send days before job</label>
					<input
						id="opt-crew-days"
						type="number"
						min="0"
						max="365"
						class="input"
						bind:value={editingOptions.crewAssignmentDaysBefore}
					/>
					<label for="opt-crew-hour" class="label">Send at time (AM/PM, Alaska)</label>
					<div class="options-page__time-row">
						<input
							id="opt-crew-hour"
							type="number"
							min="1"
							max="12"
							class="input options-page__time-hour"
							bind:value={crewAssignmentHour12}
						/>
						<select
							id="opt-crew-period"
							class="input options-page__time-period"
							bind:value={crewAssignmentPeriod}
						>
							<option value="AM">AM</option>
							<option value="PM">PM</option>
						</select>
					</div>
				</div>
			</div>

			<!-- Cancellation Reasons -->
			<div class="form-section">
				<h3>Cancellation Reasons</h3>
				<p class="options-page__help">
					The **top reason** appears first in dropdowns. Reorder as needed.
				</p>

				{#if editingOptions?.cancelReasons?.length}
					<div class="cancel-reasons-list">
						{#each editingOptions.cancelReasons as reason, index (index)}
							<div
								class="cancel-reason-item {isDefaultCancelReason(index)
									? 'cancel-reason-item--default'
									: ''}"
							>
								<input
									class="cancel-reason-item__input input"
									bind:value={editingOptions.cancelReasons[index]}
									placeholder="Enter cancellation reason"
								/>
								<div class="cancel-reason-item__controls">
									<button
										type="button"
										class="cancel-reason-item__move-btn"
										onclick={() => moveCancelReasonUp(index)}
										disabled={index === 0}
									>
										↑
									</button>
									<button
										type="button"
										class="cancel-reason-item__move-btn"
										onclick={() => moveCancelReasonDown(index)}
										disabled={index === editingOptions.cancelReasons.length - 1}
									>
										↓
									</button>
									<button
										type="button"
										class="cancel-reason-item__remove"
										onclick={() => deleteCancelReason(index)}
									>
										✕
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<button
					type="button"
					class="options-page__btn options-page__btn--add"
					onclick={addCancelReason}
				>
					+ Add New Reason
				</button>
			</div>
		{:else if activeTab === 'security'}
			<h2>App Security</h2>

			<div class="form-section">
				<h3>Mobile quick unlock</h3>
				<p class="options-page__help">
					On phones and small screens: how long the app can stay in the background before asking for
					PIN or biometric again. Does not affect sign-in.
				</p>
				<div class="form-grid">
					<label for="opt-idle-minutes" class="label">Re-lock after (minutes)</label>
					<input
						id="opt-idle-minutes"
						type="number"
						min="1"
						max="1440"
						class="input"
						bind:value={editingOptions.quickUnlockIdleMinutes}
					/>
				</div>
				<p class="options-page__help">
					Default is 120 minutes (2 hours). Common values: 15, 30, 60, 120.
				</p>
			</div>

			<div class="form-section">
				<h3>Desktop quick unlock</h3>
				<p class="options-page__help">
					On desktop browsers: how long a signed-in user can be inactive before the quick-unlock
					overlay appears (PIN or biometric, if configured in Profile). Separate from the mobile
					timer above.
				</p>
				<div class="form-grid">
					<label for="opt-desktop-idle-minutes" class="label">Re-lock after (minutes)</label>
					<input
						id="opt-desktop-idle-minutes"
						type="number"
						min="1"
						max="1440"
						class="input"
						bind:value={editingOptions.desktopSecurityIdleMinutes}
					/>
				</div>
				<p class="options-page__help">
					Default is 30 minutes. Common values: 15, 30, 60, 120.
				</p>
			</div>
		{:else if activeTab === 'invoice'}
			<h2>Invoice & Billing Settings</h2>

			<div class="form-section">
				<h3>Billing & Tax</h3>
				<div class="form-grid">
					<label for="opt-tax" class="label">Tax Rate (%)</label>
					<input id="opt-tax" type="number" step="0.01" class="input" bind:value={editingOptions.taxRate} />
					<label for="opt-due" class="label">Invoice Due Days</label>
					<input id="opt-due" type="number" class="input" bind:value={editingOptions.invoiceDueDays} />
					<label for="opt-tax-jurisdiction" class="label">Sales Tax Label</label>
					<input
						id="opt-tax-jurisdiction"
						type="text"
						class="input"
						bind:value={editingOptions.salesTaxJurisdiction}
						placeholder="City and Borough of Juneau sales tax"
					/>
				</div>
				<p class="options-page__help">
					Tax rate and due days are pulled from here when generating invoices. Terms show as
					<strong>Due within [days] days</strong> (not Net 30). Use <strong>Send to Client</strong> after
					reviewing the Word doc.
				</p>
			</div>

			<div class="form-section">
				<h3>Business Letterhead</h3>
				<p class="options-page__help">Shown on generated invoice .docx files.</p>
				<div class="form-grid">
					<label for="opt-biz-name" class="label">Business Name</label>
					<input id="opt-biz-name" type="text" class="input" bind:value={editingOptions.businessName} />
					<label for="opt-biz-street" class="label">Street Address</label>
					<input id="opt-biz-street" type="text" class="input" bind:value={editingOptions.businessStreet} />
					<label for="opt-biz-city" class="label">City</label>
					<input id="opt-biz-city" type="text" class="input" bind:value={editingOptions.businessCity} />
					<label for="opt-biz-state" class="label">State</label>
					<input id="opt-biz-state" type="text" class="input" bind:value={editingOptions.businessState} />
					<label for="opt-biz-zip" class="label">ZIP</label>
					<input id="opt-biz-zip" type="text" class="input" bind:value={editingOptions.businessZip} />
					<label for="opt-biz-phone" class="label">Phone</label>
					<input id="opt-biz-phone" type="text" class="input" bind:value={editingOptions.businessPhone} />
					<label for="opt-biz-email" class="label">Billing Email</label>
					<input id="opt-biz-email" type="email" class="input" bind:value={editingOptions.businessEmail} />
					<label for="opt-biz-web" class="label">Website</label>
					<input id="opt-biz-web" type="text" class="input" bind:value={editingOptions.businessWebsite} />
					<label for="opt-biz-tax-acct" class="label">CBJ Sales Tax Account #</label>
					<input
						id="opt-biz-tax-acct"
						type="text"
						class="input"
						bind:value={editingOptions.businessSalesTaxAccount}
					/>
				</div>
			</div>

			<div class="form-section">
				<h3>Check Mailing Address</h3>
				<p class="options-page__help">Used for check-billing clients. Leave blank to use street address above.</p>
				<div class="form-grid">
					<label for="opt-mail-street" class="label">Mailing Street / PO Box</label>
					<input
						id="opt-mail-street"
						type="text"
						class="input"
						bind:value={editingOptions.businessMailingStreet}
					/>
					<label for="opt-mail-city" class="label">City</label>
					<input id="opt-mail-city" type="text" class="input" bind:value={editingOptions.businessMailingCity} />
					<label for="opt-mail-state" class="label">State</label>
					<input
						id="opt-mail-state"
						type="text"
						class="input"
						bind:value={editingOptions.businessMailingState}
					/>
					<label for="opt-mail-zip" class="label">ZIP</label>
					<input id="opt-mail-zip" type="text" class="input" bind:value={editingOptions.businessMailingZip} />
				</div>
			</div>

			<div class="form-section">
				<h3>Invoice Numbering</h3>
				<div class="form-grid">
					<label for="opt-inv-prefix" class="label">Prefix</label>
					<input
						id="opt-inv-prefix"
						type="text"
						class="input"
						bind:value={editingOptions.invoiceNumberPrefix}
					/>
					<label for="opt-inv-next" class="label">Next Number</label>
					<input
						id="opt-inv-next"
						type="number"
						min="1"
						class="input"
						bind:value={editingOptions.nextInvoiceNumber}
					/>
				</div>
				<p class="options-page__help">
					Format: PREFIX-YEAR-#### (e.g. CCW-2026-0001). Counter resets each calendar year.
				</p>
			</div>

			<div class="form-section">
				<h3>Default Billable Items</h3>
				<p class="options-page__help">The first item is default for dropdown lists.</p>

				{#if editingOptions?.defaultBillableItems?.length}
					<div class="billable-list">
						{#each editingOptions.defaultBillableItems as item, index (index)}
							<div class="billable-item {isDefaultBillable(index) ? 'billable-item--default' : ''}">
								<input
									class="billable-item__input input"
									bind:value={item.title}
									placeholder="Service name"
								/>
								<div class="billable-item__type-toggle">
									<button
										type="button"
										class="billable-item__type-btn"
										class:active={item.hours === undefined}
										onclick={() => {
											if (item.hours !== undefined) {
												item.quantity = item.hours ?? 1;
												delete item.hours;
											}
										}}
									>
										Per Qty
									</button>
									<button
										type="button"
										class="billable-item__type-btn"
										class:active={item.hours !== undefined}
										onclick={() => {
											if (item.hours === undefined) {
												item.hours = item.quantity ?? 1;
												delete item.quantity;
											}
										}}
									>
										Per Hour
									</button>
								</div>
								<div class="billable-item__price">
									<span>{item.hours !== undefined ? '$' : '#'}</span>
									<input
										type="number"
										class="billable-item__input billable-item__input--price input"
										bind:value={item.price}
										onfocus={(e) => {
											if (item.price === 0) {
												e.currentTarget.select();
											}
										}}
									/>
								</div>

								<div class="billable-item__controls">
									<button
										type="button"
										class="billable-item__move-btn"
										onclick={() => moveBillableUp(index)}
										disabled={index === 0}
									>
										↑
									</button>
									<button
										type="button"
										class="billable-item__move-btn"
										onclick={() => moveBillableDown(index)}
										disabled={index === editingOptions.defaultBillableItems.length - 1}
									>
										↓
									</button>
									<button
										type="button"
										class="billable-item__remove"
										onclick={() => editingOptions.defaultBillableItems.splice(index, 1)}
									>
										✕
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<button
					type="button"
					class="options-page__btn options-page__btn--add"
					onclick={() => {
						if (!editingOptions.defaultBillableItems) editingOptions.defaultBillableItems = [];
						editingOptions.defaultBillableItems.push({ title: '', price: 0, quantity: 1 });
					}}
				>
					+ Add New Billable Item
				</button>
			</div>
		{:else if activeTab === 'backups'}
			<h2>Backups</h2>
			<p class="options-page__help">
				Automatic copies of your CRM data. Most days you only need <strong>Backup now</strong> and
				the list below if something goes wrong.
			</p>

			<!-- Status hero -->
			<div
				class="backup-status-hero"
				class:backup-status-hero--ok={backupStatusTone === 'ok'}
				class:backup-status-hero--fail={backupStatusTone === 'fail'}
				role="status"
			>
				<div class="backup-status-hero__main">
					{#if backupStatusTone === 'ok'}
						<p class="backup-status-hero__title">Last backup succeeded</p>
					{:else if backupStatusTone === 'fail'}
						<p class="backup-status-hero__title">Last backup failed</p>
					{:else}
						<p class="backup-status-hero__title">No backup recorded yet</p>
					{/if}
					<p class="backup-status-hero__when">
						{formatBackupDate(editingOptions.lastBackupAt)}
						{#if editingOptions.lastBackupFilename}
							· {editingOptions.lastBackupFilename}
						{/if}
						{#if editingOptions.lastBackupSizeBytes}
							· {formatBytes(Number(editingOptions.lastBackupSizeBytes))}
						{/if}
					</p>
					{#if backupStatusTone === 'fail' && editingOptions.lastBackupError}
						<pre class="backup-error backup-status-hero__error">{editingOptions.lastBackupError}</pre>
					{/if}
					<p class="backup-status-hero__meta">
						{#if editingOptions.backupScheduledEnabled}
							Scheduled daily at {backupScheduledHour12}
							{backupScheduledPeriod} Alaska time.
						{:else}
							Schedule is off — only manual backups run.
						{/if}
					</p>
					<p class="backup-status-hero__meta">
						Copies go to:
						<strong>this server</strong>
						{#if editingOptions.backupDestGoogleDrive && driveStatus?.connected}
							· <strong>Google Drive</strong>
							{#if driveStatus.email || editingOptions.backupGoogleDriveEmail}
								({driveStatus.email || editingOptions.backupGoogleDriveEmail})
							{/if}
							<span class="options-page__help-inline">
								(Drive is the long-term store; server keeps about {SERVER_SAFETY_NET_DAYS} recent days)
							</span>
						{:else if editingOptions.backupDestGoogleDrive}
							· Google Drive (not connected yet)
						{/if}
					</p>
				</div>
				<button
					type="button"
					class="options-page__btn options-page__btn--save backup-now-btn"
					onclick={runBackupNow}
					disabled={backupRunning}
				>
					{backupRunning ? 'Creating backup…' : 'Backup now'}
				</button>
			</div>

			<details class="backup-details" bind:open={backupsHowOpen}>
				<summary class="backup-details__summary">How backups work</summary>
				<div class="backup-details__body options-page__help">
					<ul class="backup-details__list">
						<li>
							Each backup is one <strong>full restore point</strong> (database + uploaded files).
						</li>
						<li>Dates and the daily schedule use <strong>Alaska time</strong>.</li>
						<li>
							With Google Drive connected and enabled, new backups upload there. The server keeps
							about the last <strong>{SERVER_SAFETY_NET_DAYS} days</strong> as a safety net; older
							server copies are removed. Drive keeps longer history using calendar retention.
						</li>
						<li>
							If Drive upload fails, the copy stays on the server and alert emails are notified.
						</li>
						<li>Email is used for <strong>failure alerts only</strong> (no backup attachments).</li>
					</ul>
				</div>
			</details>

			<div class="form-section">
				<h3>Schedule</h3>
				<div class="backup-settings">
					<label class="backup-settings__check">
						<input type="checkbox" bind:checked={editingOptions.backupScheduledEnabled} />
						Run a backup every day
					</label>
					<label for="opt-backup-hour" class="label">Time (Alaska)</label>
					<div class="options-page__time-row">
						<input
							id="opt-backup-hour"
							type="number"
							min="1"
							max="12"
							class="input options-page__time-hour"
							bind:value={backupScheduledHour12}
						/>
						<select
							id="opt-backup-period"
							class="input options-page__time-period"
							bind:value={backupScheduledPeriod}
						>
							<option value="AM">AM</option>
							<option value="PM">PM</option>
						</select>
					</div>
					<p class="options-page__help">
						Tap <strong>Save All Changes</strong> at the bottom after changing schedule or destinations.
					</p>
				</div>
			</div>

			<div class="form-section">
				<h3>Where copies are saved</h3>
				<div class="backup-settings">
					<div class="backup-dest-row">
						<span class="backup-dest-row__label">This server</span>
						<span class="backup-dest-row__value">
							{#if editingOptions.backupDestGoogleDrive && driveStatus?.connected}
								Safety net (~{SERVER_SAFETY_NET_DAYS} days). Long-term copies live on Drive.
							{:else}
								Primary store (always available for download &amp; restore).
							{/if}
						</span>
					</div>

					<div class="backup-gdrive">
						<div class="backup-dest-row backup-dest-row--gdrive">
							<span class="backup-dest-row__label">Google Drive</span>
							{#if driveStatus?.connected}
								<span class="backup-gdrive__badge">Connected</span>
							{:else if driveStatus?.needsReconnect}
								<span class="backup-gdrive__badge backup-gdrive__badge--warn">Reconnect needed</span>
							{:else}
								<span class="backup-dest-row__value">Not connected</span>
							{/if}
						</div>

						{#if driveErrorBanner}
							<div class="backup-gdrive__error" role="alert">
								<p class="backup-gdrive__error-text">{driveErrorBanner}</p>
								<button
									type="button"
									class="options-page__btn options-page__btn--add"
									onclick={() => (driveErrorBanner = '')}
								>
									Dismiss
								</button>
							</div>
						{/if}

						{#if driveStatusLoading && !driveStatus}
							<p class="options-page__help">Checking Google Drive…</p>
						{:else if driveStatus?.connected || driveStatus?.needsReconnect || driveStatus?.folderId}
							{#if driveStatus.email || editingOptions.backupGoogleDriveEmail}
								<p class="backup-gdrive__line">
									<strong>Account:</strong>
									{driveStatus.email || editingOptions.backupGoogleDriveEmail}
								</p>
							{/if}
							<p class="backup-gdrive__line">
								<strong>Folder:</strong>
								{driveStatus.folderName ||
									editingOptions.backupGoogleDriveFolderName ||
									'Capital City Windows Backups'}
							</p>
							{#if driveStatus.needsReconnect || !driveStatus.hasOAuthToken}
								<p class="options-page__help">
									Connection expired or incomplete. Connect Google Drive again, save, then run
									<strong>Backup now</strong>.
								</p>
							{/if}
							<label class="backup-settings__check">
								<input
									type="checkbox"
									bind:checked={editingOptions.backupDestGoogleDrive}
									disabled={!driveStatus.connected}
								/>
								Also save a copy to Google Drive
							</label>
							<div class="backup-gdrive__actions">
								{#if driveStatus.oauthAppReady}
									<button
										type="button"
										class="options-page__btn options-page__btn--save"
										onclick={connectGoogleDrive}
										disabled={driveActionBusy}
									>
										{driveActionBusy
											? 'Redirecting…'
											: driveStatus.connected
												? 'Reconnect Google Drive'
												: 'Connect Google Drive'}
									</button>
								{/if}
								{#if driveStatus.hasOAuthToken}
									<button
										type="button"
										class="options-page__btn options-page__btn--danger"
										onclick={disconnectGoogleDrive}
										disabled={driveActionBusy}
									>
										Disconnect
									</button>
								{/if}
							</div>
						{:else}
							<label class="backup-settings__check backup-settings__check--disabled">
								<input type="checkbox" checked={false} disabled />
								Also save a copy to Google Drive
								<span class="backup-gdrive__hint">(connect first)</span>
							</label>
							{#if driveStatus && !driveStatus.oauthAppReady}
								<p class="backup-gdrive__setup-warn">
									Off-site backup isn’t set up on this server yet. Contact your administrator.
								</p>
							{:else}
								<div class="backup-gdrive__actions">
									<button
										type="button"
										class="options-page__btn options-page__btn--save"
										onclick={connectGoogleDrive}
										disabled={driveActionBusy || driveStatusLoading}
									>
										{driveActionBusy ? 'Redirecting to Google…' : 'Connect Google Drive'}
									</button>
								</div>
								<p class="options-page__help">
									Sign in with Google, approve access, then return here. Save settings and run
									<strong>Backup now</strong> (or wait for the daily schedule).
								</p>
							{/if}
						{/if}
					</div>

					<label for="opt-backup-alerts" class="label">Failure alert emails</label>
					<textarea
						id="opt-backup-alerts"
						class="input backup-settings__textarea"
						rows="2"
						placeholder="admin@example.com, ops@example.com"
						bind:value={editingOptions.backupAlertEmails}
					></textarea>
					<p class="options-page__help">
						Comma-separated. Notified only when a backup fails (or Drive upload fails). Backups are
						not emailed as attachments.
					</p>
				</div>
			</div>

			<div class="form-section">
				<h3>Restore points</h3>
				<p class="options-page__help">
					Each row is a full restore point. <strong>Stored on</strong> shows whether the file is on
					this server, Google Drive, or both.
				</p>
				{#if driveBackupError}
					<p class="backup-gdrive__error-text" style="margin-bottom: var(--space-3)">
						Drive list: {driveBackupError}
					</p>
				{/if}
				{#if backupLoading || driveBackupLoading}
					<p>Loading backups…</p>
				{:else if unifiedBackupItems.length === 0}
					<p class="options-page__help">
						No restore points yet.
						<button
							type="button"
							class="options-page__btn options-page__btn--save"
							style="margin-top: var(--space-2)"
							onclick={runBackupNow}
							disabled={backupRunning}
						>
							{backupRunning ? 'Creating backup…' : 'Create first backup'}
						</button>
					</p>
				{:else}
					<div class="backup-list backup-list--unified" role="table" aria-label="Restore points">
						<div class="backup-list__header" role="row">
							<span class="backup-list__col backup-list__col--file" role="columnheader">When</span>
							<span class="backup-list__col backup-list__col--location" role="columnheader"
								>Stored on</span
							>
							<span class="backup-list__col backup-list__col--meta" role="columnheader">Size</span>
							<span class="backup-list__col backup-list__col--actions" role="columnheader"
								>Actions</span
							>
						</div>
						{#each unifiedBackupItems as item (item.name)}
							<div class="backup-list__row backup-list__row--unified" role="row">
								<div class="backup-list__col backup-list__col--file" role="cell">
									<span class="backup-list__name">
										<span class="backup-list__badge backup-list__badge--full">Full</span>
										<span class="backup-list__date">{friendlyBackupDate(item)}</span>
									</span>
									<span class="backup-list__detail backup-list__filename" title={item.name}
										>{item.name}</span
									>
								</div>
								<div class="backup-list__col backup-list__col--location" role="cell">
									<span
										class="backup-list__location"
										class:backup-list__location--both={item.onServer && item.onDrive}
										class:backup-list__location--drive={item.onDrive && !item.onServer}
										class:backup-list__location--server={item.onServer && !item.onDrive}
										title={locationLabel(item)}
									>
										{locationLabel(item)}
									</span>
								</div>
								<div class="backup-list__col backup-list__col--meta" role="cell">
									<span class="backup-list__detail">{formatBytes(item.size)}</span>
								</div>
								<div
									class="backup-list__col backup-list__col--actions backup-list__actions"
									role="cell"
								>
									{#if item.onServer}
										<button
											type="button"
											class="options-page__btn options-page__btn--add backup-list__dl"
											onclick={() => downloadBackup(item.name)}
										>
											Download
										</button>
									{/if}
									<button
										type="button"
										class="options-page__btn backup-list__restore"
										onclick={() => openRestoreForRow(item)}
										title={item.onServer
											? 'Restore from server copy'
											: 'Download from Google Drive and restore'}
									>
										{item.onServer ? 'Restore' : 'Restore from Drive'}
									</button>
								</div>
							</div>
						{/each}
					</div>
					<div class="backup-list__toolbar">
						<button
							type="button"
							class="options-page__btn options-page__btn--add"
							onclick={() => {
								void loadBackupList({ showLoading: true });
								void loadDriveBackupList();
							}}
							disabled={backupLoading || driveBackupLoading}
						>
							Refresh list
						</button>
					</div>
				{/if}
			</div>

			<details class="backup-details" bind:open={backupsAdvancedOpen}>
				<summary class="backup-details__summary">Advanced</summary>
				<div class="backup-details__body">
					{#if backupRetention}
						<p class="options-page__help">
							Long-term retention (Drive / server when Drive is off): would keep
							<strong>{backupRetention.wouldKeep}</strong> of
							<strong>{backupRetention.total}</strong> backup dates on the calendar policy.
						</p>
					{/if}
					<p class="options-page__help backup-restore-warning">
						<strong>Restore replaces all live CRM data</strong> with the chosen backup. The app will
						be unavailable for a few minutes and everyone will be signed out.
					</p>
					<div class="backup-upload">
						<label for="backup-upload-input" class="label">Upload a full backup (.zip)</label>
						<p class="options-page__help">
							Use a file whose name ends with <code>_full.zip</code> (from Download or Drive). It
							appears in the list as <strong>Server</strong>; then tap Restore.
						</p>
						<div class="backup-upload__row">
							<input
								id="backup-upload-input"
								type="file"
								accept=".zip,application/zip"
								bind:this={uploadFileInput}
								class="backup-upload__input"
							/>
							<button
								type="button"
								class="options-page__btn options-page__btn--add"
								onclick={uploadBackupZip}
								disabled={backupUploading}
							>
								{backupUploading ? 'Uploading…' : 'Upload to server'}
							</button>
						</div>
					</div>
				</div>
			</details>
		{:else if activeTab === 'import'}
			<BulkImportPanel />
		{/if}
	</div>

	{#if restoreTarget}
		<div
			class="backup-restore-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="restore-dialog-title"
		>
			<div class="backup-restore-dialog">
				<h3 id="restore-dialog-title">Confirm restore</h3>
				<p class="backup-restore-warning">
					This replaces <strong>all</strong> live CRM data with the backup below. The app will be down
					briefly and everyone will be signed out.
				</p>
				<p class="backup-restore-dialog__filename">{restoreTarget}</p>
				{#if restoreSource === 'drive'}
					<p class="options-page__help">
						Source: <strong>Google Drive</strong> — downloaded to the server first, then restored.
					</p>
				{/if}
				<p class="options-page__help">Type the exact filename to confirm.</p>
				<input
					class="input backup-restore-dialog__input"
					type="text"
					placeholder={restoreTarget}
					bind:value={restoreConfirmText}
					autocomplete="off"
				/>
				<div class="backup-restore-dialog__actions">
					<button
						type="button"
						class="options-page__btn options-page__btn--add"
						onclick={closeRestoreDialog}
						disabled={restoreRestoring}
					>
						Cancel
					</button>
					<button
						type="button"
						class="options-page__btn backup-list__restore"
						onclick={confirmRestore}
						disabled={restoreRestoring || restoreConfirmText.trim() !== restoreTarget}
					>
						{restoreRestoring
							? restoreSource === 'drive'
								? 'Downloading & restoring…'
								: 'Starting restore…'
							: restoreSource === 'drive'
								? 'Restore from Drive'
								: 'Restore now'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- )=- Sticky footer bar for the main Save action.
	     Matches the visual treatment and sticky behavior of .new-job-modal__footer (and the updated client modal).
	     Keeps the save button visible while scrolling through long areas/billables/reasons lists.
	     Hidden on Import (bulk upload does not use Save All Changes).
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
	{#if activeTab !== 'import'}
		<div class="options-page__footer">
			<button
				class="options-page__btn options-page__btn--save"
				onclick={saveOptions}
				disabled={isSaving}
			>
				{isSaving ? 'Saving & Syncing...' : '💾 Save All Changes'}
			</button>
		</div>
	{/if}
</div>

<style>
	.options-page {
		padding: var(--space-6) var(--space-4);
		max-width: 1100px;
		margin: 0 auto;
	}
	.options-page__header {
		margin-bottom: var(--space-8);
	}
	.options-page__title {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-text);
	}
	.options-page__subtitle {
		color: var(--color-text-muted);
	}
	.options-page__tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 2px solid var(--color-border);
		margin-bottom: var(--space-8);
		flex-wrap: wrap;
	}
	.options-page__tab {
		padding: var(--space-3) var(--space-6);
		background: none;
		border: none;
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
		cursor: pointer;
		border-bottom: 3px solid transparent;
		transition: all var(--transition-fast);
	}
	.options-page__tab:hover {
		color: var(--color-text);
	}
	.options-page__tab--active {
		color: var(--color-primary);
		border-bottom: 3px solid var(--color-primary);
		font-weight: var(--font-weight-semibold);
	}
	.options-page__content {
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		box-shadow: var(--shadow-sm);
		min-height: 520px;
	}
	.form-grid {
		display: grid;
		grid-template-columns: minmax(8rem, 12rem) 1fr;
		gap: var(--space-4);
		align-items: center;
		max-width: 600px;
	}
	.options-page__time-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.options-page__time-hour {
		width: 5rem;
		flex-shrink: 0;
	}
	.options-page__time-period {
		width: auto;
		min-width: 5.5rem;
	}
	.form-section {
		margin-bottom: var(--space-8);
	}
	.options-page__help {
		color: var(--color-text-muted);
		margin-bottom: var(--space-6);
	}

	.options-page__checkbox-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	.options-page__checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.areas-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}
	.area-item {
		display: grid;
		grid-template-columns: 3fr 5rem 8rem;
		gap: var(--space-4);
		align-items: center;
		background: var(--color-surface-alt);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		position: relative;
	}
	.area-item--default::before {
		content: '★ Default';
		position: absolute;
		top: var(--space-2);
		left: var(--space-3);
		background: var(--color-success);
		color: white;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		padding: 1px 7px 2px;
		border-radius: var(--radius-full);
		line-height: 1;
		z-index: 2;
		box-shadow: var(--shadow-sm);
	}

	.area-item__label-input {
		/* inherits global .input */
	}
	.area-item__color {
		width: 5rem;
		height: var(--space-8);
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
		background: var(--color-surface);
	}

	.area-item__controls {
		display: flex;
		gap: var(--space-1);
	}
	.area-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-alt);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-lg);
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.area-item__move-btn:hover:not(:disabled) {
		background: var(--color-border);
	}
	.area-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.area-item__remove {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: none;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.billable-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}
	.billable-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--color-surface-alt);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		position: relative;
	}
	.billable-item--default::before {
		content: '★ Default';
		position: absolute;
		top: var(--space-2);
		left: var(--space-3);
		background: var(--color-success);
		color: white;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		padding: 1px 7px 2px;
		border-radius: var(--radius-full);
		line-height: 1;
		z-index: 2;
		box-shadow: var(--shadow-sm);
	}

	.billable-item__input {
		/* inherits global .input */
		flex: 1;
		min-width: 140px; /* prevent title from collapsing too small */
	}
	.billable-item__input--price {
		width: 90px;
	}
	.billable-item__price {
		flex-shrink: 0;
	}
	.billable-item__type-toggle {
		display: flex;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		overflow: hidden;
		flex-shrink: 0;
		font-size: var(--font-size-xs);
	}
	.billable-item__type-btn {
		padding: var(--space-1) var(--space-2);
		border: none;
		background: var(--color-surface);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
		white-space: nowrap;
	}
	.billable-item__type-btn + .billable-item__type-btn {
		border-left: 1px solid var(--color-border-strong);
	}
	.billable-item__type-btn.active {
		background: var(--color-primary);
		color: white;
	}
	.billable-item__type-btn:hover:not(.active) {
		background: var(--color-surface-alt);
	}
	.billable-item__controls {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
	}
	.billable-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-alt);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-lg);
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.billable-item__move-btn:hover:not(:disabled) {
		background: var(--color-border);
	}
	.billable-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.billable-item__remove {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: none;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	/* Cancellation Reasons */
	.cancel-reasons-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}

	.cancel-reason-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--color-surface-alt);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		position: relative;
	}
	.cancel-reason-item--default::before {
		content: '★ Default';
		position: absolute;
		top: var(--space-2);
		left: var(--space-3);
		background: var(--color-success);
		color: white;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		padding: 1px 7px 2px;
		border-radius: var(--radius-full);
		line-height: 1;
		z-index: 2;
		box-shadow: var(--shadow-sm);
	}

	.cancel-reason-item__input {
		/* inherits global .input */
		flex: 1;
	}

	.cancel-reason-item__controls {
		display: flex;
		gap: var(--space-1);
	}

	.cancel-reason-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-alt);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-lg);
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.cancel-reason-item__move-btn:hover:not(:disabled) {
		background: var(--color-border);
	}

	.cancel-reason-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cancel-reason-item__remove {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: none;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.options-page__btn {
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-md);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}
	.options-page__btn--save {
		background: var(--color-primary);
		color: white;
		border: none;
	}
	.options-page__btn--add {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		border: none;
		padding: var(--space-3) var(--space-6);
		font-weight: var(--font-weight-medium);
	}

	.backup-status-hero {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		margin: 0 0 var(--space-5);
		padding: var(--space-4) var(--space-5);
		background: var(--color-surface-alt);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--color-text-muted);
	}
	.backup-status-hero--ok {
		border-left-color: var(--color-success, #16a34a);
	}
	.backup-status-hero--fail {
		border-left-color: var(--color-danger-emphasis, #b91c1c);
	}
	.backup-status-hero__title {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
	}
	.backup-status-hero--ok .backup-status-hero__title {
		color: var(--color-success, #16a34a);
	}
	.backup-status-hero--fail .backup-status-hero__title {
		color: var(--color-danger-emphasis, #b91c1c);
	}
	.backup-status-hero__when,
	.backup-status-hero__meta {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.backup-status-hero__error {
		margin: var(--space-2) 0;
		max-width: 40rem;
	}
	.backup-status-hero__main {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.backup-details {
		margin: 0 0 var(--space-5);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-alt);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}
	.backup-details__summary {
		cursor: pointer;
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-sm);
	}
	.backup-details__body {
		margin-top: var(--space-3);
	}
	.backup-details__list {
		margin: 0;
		padding-left: var(--space-5);
		line-height: 1.5;
	}
	.backup-dest-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) var(--space-3);
		margin-bottom: var(--space-3);
	}
	.backup-dest-row__label {
		font-weight: var(--font-weight-semibold);
		min-width: 7rem;
	}
	.backup-dest-row__value {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		flex: 1 1 12rem;
	}
	.options-page__help-inline {
		display: block;
		margin-top: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.backup-list__date {
		font-weight: var(--font-weight-medium);
	}
	.backup-list__filename {
		display: block;
		margin-top: 0.15rem;
		word-break: break-all;
	}
	.backup-gdrive {
		margin: var(--space-4) 0;
		padding: var(--space-4);
		background: var(--color-surface-alt);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}
	.backup-gdrive__title {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}
	.backup-gdrive__intro {
		margin-bottom: var(--space-3);
	}
	.backup-gdrive__status {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}
	.backup-gdrive__status--connected {
		border-left: 3px solid var(--color-success, #16a34a);
	}
	.backup-gdrive__status--warn {
		border-left: 3px solid var(--color-warning, #ca8a04);
	}
	.backup-gdrive__badge {
		display: inline-block;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-success, #16a34a);
		margin-bottom: var(--space-2);
	}
	.backup-gdrive__badge--warn {
		color: var(--color-warning, #ca8a04);
	}
	.backup-gdrive__line {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	.backup-gdrive__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.backup-gdrive__hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		margin-left: var(--space-1);
	}
	.backup-gdrive__setup-warn {
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		background: var(--color-warning-soft, rgba(234, 179, 8, 0.12));
		border-radius: var(--radius-sm);
	}
	.backup-gdrive__error {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-3);
		margin: 0 0 var(--space-3);
		padding: var(--space-3);
		background: var(--color-danger-soft, #fee2e2);
		border-radius: var(--radius-sm);
		border-left: 3px solid var(--color-danger-emphasis, #b91c1c);
	}
	.backup-gdrive__error-text {
		flex: 1 1 16rem;
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-danger-emphasis, #b91c1c);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.backup-settings__check--disabled {
		opacity: 0.75;
		cursor: not-allowed;
	}
	.options-page__btn--danger {
		background: var(--color-danger-soft, #fee2e2);
		color: var(--color-danger-emphasis, #b91c1c);
		border: 1px solid transparent;
	}
	.options-page__btn--danger:hover:not(:disabled) {
		filter: brightness(0.97);
	}
	.backup-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 520px;
	}
	.backup-settings__check {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		line-height: 1.4;
	}
	.backup-settings__textarea {
		min-height: 4.5rem;
		resize: vertical;
	}
	.backup-now-btn {
		width: fit-content;
	}
	.backup-status-list {
		margin: 0;
		padding-left: var(--space-5);
		line-height: 1.6;
	}
	.backup-error {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		overflow-x: auto;
	}
	.backup-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-height: 280px;
		overflow-y: auto;
	}
	.backup-list__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface-alt);
		border-radius: var(--radius-md);
	}
	.backup-list__meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.backup-list__name {
		font-weight: var(--font-weight-medium);
		word-break: break-all;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.backup-list__badge {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: var(--color-surface-muted, #e4e4e7);
		color: var(--color-text-muted, #52525b);
		flex-shrink: 0;
	}
	.backup-list__badge--full,
	.backup-list__badge--legacy {
		background: #dbeafe;
		color: #1e3a8a;
	}
	.backup-list__badge--records {
		background: #dcfce7;
		color: #166534;
	}
	.backup-list__badge--files {
		background: #fef9c3;
		color: #854d0e;
	}
	.backup-list__badge--sync_queue {
		background: #f3e8ff;
		color: #6b21a8;
	}
	.backup-list__detail {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.backup-list--unified {
		overflow-x: auto;
	}
	.backup-list__header {
		display: none;
		gap: var(--space-3);
		padding: 0 var(--space-3) var(--space-2);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted);
	}
	.backup-list__row--unified {
		align-items: flex-start;
	}
	.backup-list__col--location {
		flex: 0 0 auto;
		min-width: 7.5rem;
	}
	.backup-list__location {
		display: inline-block;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		white-space: nowrap;
	}
	.backup-list__location--server {
		background: var(--color-surface-alt, #f3f4f6);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	.backup-list__location--drive {
		background: #e0f2fe;
		color: #075985;
	}
	.backup-list__location--both {
		background: #dcfce7;
		color: #166534;
	}
	.backup-list__toolbar {
		margin-top: var(--space-3);
	}
	@media (min-width: 720px) {
		.backup-list__header {
			display: grid;
			grid-template-columns: minmax(0, 1.6fr) minmax(7rem, 0.7fr) minmax(8rem, 0.8fr) auto;
			align-items: end;
		}
		.backup-list__row--unified {
			display: grid;
			grid-template-columns: minmax(0, 1.6fr) minmax(7rem, 0.7fr) minmax(8rem, 0.8fr) auto;
			gap: var(--space-3);
			align-items: center;
		}
		.backup-list__col--file {
			min-width: 0;
		}
		.backup-list__col--meta {
			font-size: var(--font-size-sm);
		}
		.backup-list__col--actions {
			justify-content: flex-end;
		}
	}
	.backup-list__actions {
		display: flex;
		flex-shrink: 0;
		gap: var(--space-2);
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.backup-list__dl {
		padding: var(--space-2) var(--space-4);
	}
	.backup-list__restore {
		background: var(--color-danger-emphasis);
		color: white;
		border: none;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}
	.backup-list__restore:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.backup-restore-warning {
		background: var(--color-danger-soft);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border-left: 4px solid var(--color-danger-emphasis);
	}
	.backup-upload__row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}
	.backup-upload__input {
		flex: 1;
		min-width: 200px;
	}
	.backup-restore-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--space-4);
	}
	.backup-restore-dialog {
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		max-width: 480px;
		width: 100%;
		box-shadow: var(--shadow-lg);
	}
	.backup-restore-dialog__filename {
		font-family: monospace;
		font-size: var(--font-size-sm);
		word-break: break-all;
		background: var(--color-surface-alt);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
	}
	.backup-restore-dialog__input {
		width: 100%;
		margin: var(--space-3) 0;
	}
	.backup-restore-dialog__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	/* )=- Sticky bottom action bar modeled directly on the job/client modal footers.
	     position:sticky + bottom:0 + background/shadow/border so the Save button stays accessible
	     no matter how far down the user scrolls the options sections.
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	.options-page__footer {
		position: sticky;
		bottom: 0;
		background: var(--color-surface);
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--color-border);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
		z-index: 10;
		text-align: right;
		margin-top: var(--space-4);
	}

	/* ============================================
	   MOBILE RESPONSIVE (match crew/clients/jobs)
	   - Tighten padding
	   - Stack form grids (labels above fields)
	   - Collapse area / billable / cancel rows into mobile cards
	   - Full-width add + save actions where helpful
	   - BEM + tokens only. 768px matches layout bottom-nav breakpoint.
	   ============================================ */
	@media (max-width: 768px) {
		.options-page {
			padding: var(--space-3) var(--space-2);
		}

		.options-page__header {
			margin-bottom: var(--space-4);
		}

		.options-page__title {
			font-size: var(--font-size-2xl);
		}

		.options-page__tabs {
			margin-bottom: var(--space-4);
			gap: var(--space-1);
		}

		.options-page__tab {
			padding: var(--space-2) var(--space-4);
			font-size: var(--font-size-sm);
		}

		.options-page__content {
			padding: var(--space-4);
			min-height: auto;
		}

		.form-section {
			margin-bottom: var(--space-6);
		}

		.options-page__help {
			margin-bottom: var(--space-4);
			font-size: var(--font-size-sm);
		}

		/* Billing & tax: stack label + input vertically */
		.form-grid {
			grid-template-columns: 1fr;
			gap: var(--space-2);
			max-width: 100%;
		}

		/* Areas of Town - wrap to avoid squeezing color + controls */
		.areas-list {
			gap: var(--space-2);
			margin-bottom: var(--space-4);
		}
		.area-item {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-3);
		}
		.area-item__label-input {
			flex: 1 1 55%;
			min-width: 120px;
		}
		.area-item__color {
			width: 2.75rem;
			height: 2.25rem;
		}
		.area-item__controls {
			margin-left: auto;
			gap: var(--space-2);
		}
		.area-item__move-btn,
		.area-item__remove {
			width: 36px;
			height: 36px;
			font-size: var(--font-size-base);
		}

		/* Default Billable Items - title full width on own line, then type + price + controls share a row */
		.billable-list {
			gap: var(--space-2);
			margin-bottom: var(--space-4);
		}
		.billable-item {
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-3);
		}
		.billable-item__input {
			flex: 1 0 100%;
			width: 100%;
			min-width: 0;
			margin-bottom: var(--space-1);
		}
		.billable-item__type-toggle {
			flex-shrink: 0;
		}
		.billable-item__price {
			display: flex;
			align-items: center;
			gap: var(--space-1);
			flex-shrink: 0;
		}
		.billable-item__controls {
			display: flex;
			gap: var(--space-2);
			margin-left: auto;
			flex-shrink: 0;
		}
		.billable-item__move-btn,
		.billable-item__remove {
			width: 36px;
			height: 36px;
		}
		.billable-item__type-btn {
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-xs);
		}

		/* Cancellation Reasons - stack input, controls below */
		.cancel-reasons-list {
			gap: var(--space-2);
			margin-bottom: var(--space-4);
		}
		.cancel-reason-item {
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-3);
		}
		.cancel-reason-item__input {
			width: 100%;
			flex: 1 1 100%;
		}
		.cancel-reason-item__controls {
			width: 100%;
			justify-content: flex-end;
			gap: var(--space-2);
		}
		.cancel-reason-item__move-btn,
		.cancel-reason-item__remove {
			width: 36px;
			height: 36px;
		}

		/* Add buttons become prominent full-width taps on mobile */
		.options-page__btn--add {
			width: 100%;
			justify-content: center;
		}

		.options-page__footer {
			padding: var(--space-3) var(--space-4);
			text-align: center;
		}
		.options-page__btn--save {
			width: 100%;
		}
	}
</style>
