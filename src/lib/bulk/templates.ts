/** Downloadable bulk-upload templates (no real client data required). */

export const CLIENTS_JSON_TEMPLATE = `{
  "clients": [
    {
      "externalId": "demo-client-1",
      "importSource": "csv-upload",
      "name": "Jane Example",
      "serviceAddressStreet": "123 Main St",
      "serviceAddressCity": "Anchorage",
      "serviceAddressState": "AK",
      "serviceAddressZip": "99501",
      "areaOfTown": "Downtown",
      "preferredBillingMethod": "email",
      "phone": "907-555-0100",
      "email": "jane@example.com",
      "notes": "Sample row — replace with real data"
    }
  ]
}
`;

export const JOBS_JSON_TEMPLATE = `{
  "jobs": [
    {
      "externalId": "demo-job-1",
      "importSource": "csv-upload",
      "title": "Window cleaning — sample",
      "start": "2026-06-01T09:00:00.000Z",
      "end": "2026-06-01T11:00:00.000Z",
      "status": "completed",
      "areaOfTown": "Downtown",
      "clientExternalId": "demo-client-1",
      "billableItems": [
        { "title": "Standard clean", "price": 450, "quantity": 1, "total": 450 }
      ]
    }
  ]
}
`;

export const INVOICES_JSON_TEMPLATE = `{
  "invoices": [
    {
      "externalId": "demo-inv-1",
      "importSource": "csv-upload",
      "jobExternalId": "demo-job-1",
      "clientExternalId": "demo-client-1",
      "status": "paid",
      "invoiceNumber": "LEG-0001",
      "amount": 450,
      "dueDate": "2026-06-15",
      "paidAt": "2026-06-10"
    }
  ]
}
`;

export const FULL_PACKAGE_JSON_TEMPLATE = `{
  "clients": [
    {
      "externalId": "demo-client-1",
      "name": "Jane Example",
      "serviceAddressStreet": "123 Main St",
      "serviceAddressCity": "Anchorage",
      "serviceAddressState": "AK",
      "serviceAddressZip": "99501",
      "areaOfTown": "Downtown",
      "preferredBillingMethod": "email",
      "phone": "907-555-0100",
      "email": "jane@example.com"
    }
  ],
  "jobs": [
    {
      "externalId": "demo-job-1",
      "title": "Window cleaning — sample",
      "start": "2026-06-01T09:00:00.000Z",
      "end": "2026-06-01T11:00:00.000Z",
      "status": "completed",
      "clientExternalId": "demo-client-1",
      "billableItems": [
        { "title": "Standard clean", "price": 450, "quantity": 1, "total": 450 }
      ]
    }
  ],
  "invoices": [
    {
      "externalId": "demo-inv-1",
      "jobExternalId": "demo-job-1",
      "status": "paid",
      "invoiceNumber": "LEG-0001",
      "amount": 450
    }
  ]
}
`;

export const CLIENTS_CSV_TEMPLATE = `externalId,name,serviceAddressStreet,serviceAddressCity,serviceAddressState,serviceAddressZip,areaOfTown,preferredBillingMethod,phone,email,notes
demo-client-1,Jane Example,123 Main St,Anchorage,AK,99501,Downtown,email,907-555-0100,jane@example.com,Sample row
`;

export const JOBS_CSV_TEMPLATE = `externalId,title,start,end,status,areaOfTown,clientExternalId,billableItems
demo-job-1,Window cleaning — sample,2026-06-01T09:00:00.000Z,2026-06-01T11:00:00.000Z,completed,Downtown,demo-client-1,"[{""title"":""Standard clean"",""price"":450,""quantity"":1,""total"":450}]"
`;

export const INVOICES_CSV_TEMPLATE = `externalId,jobExternalId,clientExternalId,status,invoiceNumber,amount,dueDate,paidAt
demo-inv-1,demo-job-1,demo-client-1,paid,LEG-0001,450,2026-06-15,2026-06-10
`;

export type BulkTemplateId =
	| 'full-package.json'
	| 'clients.json'
	| 'jobs.json'
	| 'invoices.json'
	| 'clients.csv'
	| 'jobs.csv'
	| 'invoices.csv';

export const BULK_TEMPLATES: Record<
	BulkTemplateId,
	{ filename: string; mime: string; content: string; label: string }
> = {
	'full-package.json': {
		filename: 'bulk-full-package.template.json',
		mime: 'application/json',
		content: FULL_PACKAGE_JSON_TEMPLATE,
		label: 'Full package (JSON)'
	},
	'clients.json': {
		filename: 'bulk-clients.template.json',
		mime: 'application/json',
		content: CLIENTS_JSON_TEMPLATE,
		label: 'Clients (JSON)'
	},
	'jobs.json': {
		filename: 'bulk-jobs.template.json',
		mime: 'application/json',
		content: JOBS_JSON_TEMPLATE,
		label: 'Jobs (JSON)'
	},
	'invoices.json': {
		filename: 'bulk-invoices.template.json',
		mime: 'application/json',
		content: INVOICES_JSON_TEMPLATE,
		label: 'Invoices (JSON)'
	},
	'clients.csv': {
		filename: 'bulk-clients.template.csv',
		mime: 'text/csv',
		content: CLIENTS_CSV_TEMPLATE,
		label: 'Clients (CSV)'
	},
	'jobs.csv': {
		filename: 'bulk-jobs.template.csv',
		mime: 'text/csv',
		content: JOBS_CSV_TEMPLATE,
		label: 'Jobs (CSV)'
	},
	'invoices.csv': {
		filename: 'bulk-invoices.template.csv',
		mime: 'text/csv',
		content: INVOICES_CSV_TEMPLATE,
		label: 'Invoices (CSV)'
	}
};
