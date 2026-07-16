/**
 * Canonical bulk-upload schemas (JSON primary; CSV maps into the same shapes).
 * Slice 1: validate + dry-run only — no PocketBase writes.
 */
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => {
	if (v === '' || v === null || v === undefined) return undefined;
	return v;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const requiredString = z.string().trim().min(1);

const billingMethodSchema = z.enum(['email', 'check', 'invoice']);
const jobStatusSchema = z.enum(['scheduled', 'confirmed', 'completed', 'cancelled']);
const invoiceStatusSchema = z.enum(['draft', 'generated', 'sent', 'paid']);

const billableItemSchema = z.object({
	title: requiredString,
	price: z.coerce.number(),
	quantity: z.coerce.number().positive().optional().default(1),
	total: z.coerce.number().optional(),
	/** Legacy OCR-style alias accepted on import */
	hours: z.coerce.number().positive().optional()
});

/** ISO date/datetime string or Date — coerced to Date for validation. */
const dateLike = z.preprocess((v) => {
	if (v instanceof Date) return v;
	if (typeof v === 'string' && v.trim()) return new Date(v);
	return v;
}, z.date({ error: 'Invalid date' }));

export const bulkClientSchema = z.object({
	externalId: optionalString,
	importSource: optionalString,
	name: requiredString,
	serviceAddressStreet: requiredString,
	serviceAddressCity: requiredString,
	serviceAddressState: requiredString,
	serviceAddressZip: requiredString,
	areaOfTown: requiredString,
	preferredBillingMethod: billingMethodSchema.default('email'),
	phone: z.preprocess(emptyToUndefined, z.string().trim().default('')),
	email: z.preprocess(emptyToUndefined, z.string().trim().default('')),
	notes: optionalString,
	useBillingAddress: z.preprocess((v) => {
		if (v === true || v === 'true' || v === '1' || v === 1) return true;
		if (v === false || v === 'false' || v === '0' || v === 0 || v === '' || v == null) return false;
		return v;
	}, z.boolean().optional()),
	billingAddressStreet: optionalString,
	billingAddressCity: optionalString,
	billingAddressState: optionalString,
	billingAddressZip: optionalString
});

export const bulkJobSchema = z
	.object({
		externalId: optionalString,
		importSource: optionalString,
		title: requiredString,
		start: dateLike,
		end: dateLike,
		status: jobStatusSchema.optional().default('scheduled'),
		areaOfTown: optionalString,
		notes: optionalString,
		assignedCrew: z.array(z.string()).optional().default([]),
		billableItems: z.array(billableItemSchema).optional(),
		subtotal: z.coerce.number().optional(),
		taxRate: z.coerce.number().optional(),
		taxAmount: z.coerce.number().optional(),
		totalAmount: z.coerce.number().optional(),
		/** Resolve client by externalId from this payload or prior import */
		clientExternalId: optionalString,
		clientEmail: optionalString,
		clientPbId: optionalString
	})
	.superRefine((data, ctx) => {
		const hasRef = Boolean(data.clientExternalId || data.clientEmail || data.clientPbId);
		if (!hasRef) {
			ctx.addIssue({
				code: 'custom',
				message: 'Job needs clientExternalId, clientEmail, or clientPbId',
				path: ['clientExternalId']
			});
		}
		if (data.end.getTime() < data.start.getTime()) {
			ctx.addIssue({
				code: 'custom',
				message: 'end must be on or after start',
				path: ['end']
			});
		}
	});

export const bulkInvoiceSchema = z
	.object({
		externalId: optionalString,
		importSource: optionalString,
		status: invoiceStatusSchema.optional().default('sent'),
		invoiceNumber: optionalString,
		dueDate: dateLike.optional(),
		paidAt: dateLike.optional(),
		amount: z.coerce.number().optional().default(0),
		subtotal: z.coerce.number().optional(),
		taxAmount: z.coerce.number().optional(),
		notes: optionalString,
		billableItems: z.array(billableItemSchema).optional(),
		jobExternalId: optionalString,
		jobPbId: optionalString,
		clientExternalId: optionalString,
		clientEmail: optionalString,
		clientPbId: optionalString
	})
	.superRefine((data, ctx) => {
		if (!data.jobExternalId && !data.jobPbId) {
			ctx.addIssue({
				code: 'custom',
				message: 'Invoice needs jobExternalId or jobPbId',
				path: ['jobExternalId']
			});
		}
	});

export const bulkPayloadSchema = z
	.object({
		clients: z.array(z.unknown()).optional(),
		jobs: z.array(z.unknown()).optional(),
		invoices: z.array(z.unknown()).optional()
	})
	.refine((p) => (p.clients?.length || 0) + (p.jobs?.length || 0) + (p.invoices?.length || 0) > 0, {
		message: 'Payload must include at least one of clients, jobs, or invoices'
	});

export const bulkRequestSchema = z.object({
	dryRun: z.boolean().optional().default(true),
	clients: z.array(z.unknown()).optional(),
	jobs: z.array(z.unknown()).optional(),
	invoices: z.array(z.unknown()).optional()
});

export type BulkClient = z.infer<typeof bulkClientSchema>;
export type BulkJob = z.infer<typeof bulkJobSchema>;
export type BulkInvoice = z.infer<typeof bulkInvoiceSchema>;
export type BulkPayload = {
	clients?: unknown[];
	jobs?: unknown[];
	invoices?: unknown[];
};

export type BulkEntity = 'clients' | 'jobs' | 'invoices';

export const MAX_BULK_ROWS = 5000;
export const MAX_BULK_JSON_BYTES = 2 * 1024 * 1024;
