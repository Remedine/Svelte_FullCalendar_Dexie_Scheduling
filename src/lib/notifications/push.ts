/** Browser push/toast notifications for crew assignment (requires permission). */

export async function ensureNotificationPermission(): Promise<boolean> {
	if (!('Notification' in window)) return false;
	if (Notification.permission === 'granted') return true;
	if (Notification.permission === 'denied') return false;
	const result = await Notification.requestPermission();
	return result === 'granted';
}

export function showCrewAssignmentNotification(title: string, body: string, tag?: string): void {
	if (!('Notification' in window) || Notification.permission !== 'granted') return;
	try {
		new Notification(title, { body, tag, icon: '/favicon.svg' });
	} catch {
		// ignore — some browsers block notifications outside user gesture
	}
}