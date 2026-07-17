export {
	bulkClientSchema,
	bulkInvoiceSchema,
	bulkJobSchema,
	bulkPayloadSchema,
	bulkRequestSchema,
	MAX_BULK_JSON_BYTES,
	MAX_BULK_ROWS,
	type BulkClient,
	type BulkEntity,
	type BulkInvoice,
	type BulkJob,
	type BulkPayload
} from './schema';

export { parseCsvText, csvToBulkPayload, normalizeHeader } from './parseCsv';
export { parseJsonToBulkPayload } from './parseJson';
export {
	runBulkDryRun,
	type BulkDryRunResult,
	type BulkRowResult,
	type BulkRowAction,
	type BulkEntitySummary,
	type BulkDryRunOptions,
	type BulkCommitSupport
} from './dryRun';
export { BULK_TEMPLATES, type BulkTemplateId } from './templates';
export { bulkClientToPbPayload, normalizeEmail } from './clientMap';
export { bulkJobToPbPayload } from './jobMap';
export { bulkInvoiceToPbPayload } from './invoiceMap';
export {
	loadClientLookupIndex,
	matchExistingClient,
	createPbClient,
	updatePbClient,
	type ClientLookupIndex,
	type ExistingClient,
	type ClientMatch
} from './pbClients';
export {
	loadJobLookupIndex,
	matchExistingJob,
	resolveJobClientPbId,
	createPbJob,
	updatePbJob,
	type JobLookupIndex,
	type ExistingJob,
	type JobMatch
} from './pbJobs';
export {
	loadInvoiceLookupIndex,
	matchExistingInvoice,
	resolveInvoiceJobPbId,
	resolveInvoiceClientPbId,
	createPbInvoice,
	updatePbInvoice,
	type InvoiceLookupIndex,
	type ExistingInvoice,
	type InvoiceMatch
} from './pbInvoices';
export { commitBulk, commitBulkClients, type BulkCommitResult } from './commit';
