import type { Client } from '$lib/db';
import type { InvoiceDocxBusinessInfo } from './types';

function formatCityStateZip(city?: string, state?: string, zip?: string): string {
	return [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
}

function formatMailingLines(info: InvoiceDocxBusinessInfo): string[] {
	const street = info.businessMailingStreet?.trim() || info.businessStreet?.trim();
	const city = info.businessMailingCity?.trim() || info.businessCity?.trim();
	const state = info.businessMailingState?.trim() || info.businessState?.trim();
	const zip = info.businessMailingZip?.trim() || info.businessZip?.trim();
	const lines: string[] = [];
	if (street) lines.push(street);
	const csz = formatCityStateZip(city, state, zip);
	if (csz.trim()) lines.push(csz);
	return lines;
}

/** Bill To address: billing fields when useBillingAddress, else service address. */
export function getClientBillToAddress(client: Client | null | undefined): {
	street: string;
	csz: string;
} {
	if (!client) return { street: '', csz: '' };
	if (client.useBillingAddress) {
		return {
			street: client.billingAddressStreet?.trim() || '',
			csz: formatCityStateZip(
				client.billingAddressCity,
				client.billingAddressState,
				client.billingAddressZip
			)
		};
	}
	return {
		street: client.serviceAddressStreet?.trim() || '',
		csz: formatCityStateZip(
			client.serviceAddressCity,
			client.serviceAddressState,
			client.serviceAddressZip
		)
	};
}

/** Service location always uses the service address (tax situs). */
export function getClientServiceAddress(client: Client | null | undefined): {
	street: string;
	csz: string;
} {
	if (!client) return { street: '', csz: '' };
	return {
		street: client.serviceAddressStreet?.trim() || '',
		csz: formatCityStateZip(
			client.serviceAddressCity,
			client.serviceAddressState,
			client.serviceAddressZip
		)
	};
}

/** Return address for envelope window (mailing / remit address from options). */
export function getBusinessReturnAddressLines(info: InvoiceDocxBusinessInfo): string[] {
	const name = info.businessName || 'Capital City Windows';
	const mail = formatMailingLines(info);
	return [name, ...mail].filter((l) => l.trim().length > 0);
}

/** Recipient block for envelope window (billing or service address per client setting). */
export function getRecipientMailingLines(
	client: Client | null | undefined,
	clientName: string
): string[] {
	const billTo = getClientBillToAddress(client);
	const lines = [clientName];
	if (billTo.street) lines.push(billTo.street);
	if (billTo.csz.trim()) lines.push(billTo.csz.trim());
	return lines;
}

/** Payment instructions tailored to client preferred billing method. */
export function buildPaymentInstructions(
	client: Client | null | undefined,
	business: InvoiceDocxBusinessInfo
): string[] {
	const name = business.businessName || 'Capital City Windows';
	const email = business.businessEmail?.trim();
	const phone = business.businessPhone?.trim();
	const mail = formatMailingLines(business);
	const method = client?.preferredBillingMethod;

	const lines: string[] = [];

	if (method === 'check') {
		lines.push(`Make check payable to ${name}.`);
		if (mail.length) lines.push(`Mail payment to: ${mail.join(', ')}`);
	} else if (method === 'email') {
		lines.push('Please remit payment by the due date (check or as agreed).');
		if (email) lines.push(`Payment confirmation or questions: ${email}`);
	} else {
		lines.push(`Please remit payment by the due date. Make payable to ${name}.`);
		if (mail.length) lines.push(`Mail payment to: ${mail.join(', ')}`);
	}

	if (phone) lines.push(`Billing inquiries: ${phone}`);
	return lines;
}