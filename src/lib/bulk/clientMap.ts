import type { BulkClient } from './schema';

/** Map a validated bulk client row → PocketBase clients payload. */
export function bulkClientToPbPayload(client: BulkClient): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		name: client.name,
		serviceAddressStreet: client.serviceAddressStreet,
		serviceAddressCity: client.serviceAddressCity,
		serviceAddressState: client.serviceAddressState,
		serviceAddressZip: client.serviceAddressZip,
		areaOfTown: client.areaOfTown || '',
		preferredBillingMethod: client.preferredBillingMethod || 'email',
		phone: client.phone ?? '',
		email: client.email ?? '',
		importSource: client.importSource || 'bulk-upload'
	};

	if (client.externalId) payload.importKey = client.externalId;
	if (client.notes) payload.notes = client.notes;
	if (client.useBillingAddress) {
		payload.useBillingAddress = true;
		if (client.billingAddressStreet) payload.billingAddressStreet = client.billingAddressStreet;
		if (client.billingAddressCity) payload.billingAddressCity = client.billingAddressCity;
		if (client.billingAddressState) payload.billingAddressState = client.billingAddressState;
		if (client.billingAddressZip) payload.billingAddressZip = client.billingAddressZip;
	} else if (client.useBillingAddress === false) {
		payload.useBillingAddress = false;
	}

	return payload;
}

export function normalizeEmail(email: string | undefined | null): string {
	return (email || '').trim().toLowerCase();
}
