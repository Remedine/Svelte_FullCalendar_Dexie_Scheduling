import { z } from 'zod';

const discountSchema = z.object({
	type: z.enum(['amount', 'percent']),
	value: z.coerce.number().min(0),
	description: z.string().optional()
});

const billableItemSchema = z.object({
	title: z.string().min(1, 'Line description is required'),
	price: z.coerce.number().min(0),
	quantity: z.coerce.number().positive('Quantity must be greater than 0'),
	unit: z.enum(['hour', 'qty']).optional(),
	lineDiscount: discountSchema.optional(),
	total: z.coerce.number()
});

const clientSnapshotSchema = z
	.object({
		name: z.string().min(1, 'Client name is required'),
		serviceAddressStreet: z.string().min(1, 'Service street is required'),
		serviceAddressCity: z.string().min(1, 'Service city is required'),
		serviceAddressState: z.string().min(1, 'Service state is required'),
		serviceAddressZip: z.string().min(1, 'Service ZIP is required'),
		useBillingAddress: z.boolean().optional(),
		billingAddressStreet: z.string().optional(),
		billingAddressCity: z.string().optional(),
		billingAddressState: z.string().optional(),
		billingAddressZip: z.string().optional(),
		phone: z.string().optional(),
		email: z.string().optional()
	})
	.superRefine((data, ctx) => {
		if (!data.useBillingAddress) return;
		const fields = [
			['billingAddressStreet', 'Billing street'],
			['billingAddressCity', 'Billing city'],
			['billingAddressState', 'Billing state'],
			['billingAddressZip', 'Billing ZIP']
		] as const;
		for (const [key, label] of fields) {
			if (!data[key]?.trim()) {
				ctx.addIssue({
					code: 'custom',
					message: `${label} is required when billing address is enabled`,
					path: [key]
				});
			}
		}
	});

export const invoiceSnapshotSchema = z.object({
	clientSnapshot: clientSnapshotSchema,
	billableItems: z.array(billableItemSchema).min(1, 'At least one billable line is required'),
	invoiceDiscount: discountSchema.optional(),
	notes: z.string().optional(),
	dueDate: z.coerce.date(),
	invoiceDate: z.coerce.date()
});

export type InvoiceSnapshotValidation = z.infer<typeof invoiceSnapshotSchema>;

export function validateInvoiceSnapshot(data: unknown) {
	return invoiceSnapshotSchema.safeParse(data);
}