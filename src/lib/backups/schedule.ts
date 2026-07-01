import { backupDateInAlaska } from './names';

const BACKUP_TZ = 'America/Anchorage';

/** Current hour (0–23) in America/Anchorage. */
export function alaskaHourNow(now = new Date()): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: BACKUP_TZ,
		hour: 'numeric',
		hour12: false
	}).formatToParts(now);
	const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
	return hour === 24 ? 0 : hour;
}

export type ScheduledBackupGate = {
	run: boolean;
	reason?: string;
};

/** Whether the hourly Railway cron should run tonight's scheduled backup (Alaska time). */
export function shouldRunScheduledBackup(
	options: {
		backupScheduledEnabled?: boolean;
		backupScheduledHour?: number;
		lastScheduledBackupDate?: string;
	},
	now = new Date()
): ScheduledBackupGate {
	if (!options.backupScheduledEnabled) {
		return { run: false, reason: 'Scheduled backup disabled' };
	}

	const targetHour = Number(options.backupScheduledHour ?? 23);
	if (Number.isNaN(targetHour) || targetHour < 0 || targetHour > 23) {
		return { run: false, reason: 'Invalid backup scheduled hour' };
	}

	const today = backupDateInAlaska(now);
	if (options.lastScheduledBackupDate === today) {
		return { run: false, reason: 'Already ran today' };
	}

	if (alaskaHourNow(now) !== targetHour) {
		return { run: false, reason: 'Not scheduled hour' };
	}

	return { run: true };
}