import Dexie, { type EntityTable } from 'dexie';
import { BUSINESS_CONFIG, type AreaOfTown } from '$lib/config';

// =======================
// TYPES
// =======================

export interface Client {
	id?: number;
	name: string;
	serviceAddressStreet: string;
	serviceAddressCity: string;
	serviceAddressState: string;
	serviceAddressZip: string;
	areaOfTown: AreaOfTown;
	billingAddressStreet?: string;
	billingAddressCity?: string;
	billingAddressState?: string;
	billingAddressZip?: string;
	preferredBillingMethod: 'check' | 'credit-debit' | 'cash' | 'btc';
	phone: string;
	email: string;
	notes?: string;
	createdAt: Date;
	updatedAt: Date;
}

// ========================
// BILLABLE ITEM
// ========================

export interface BillableItem {
	id?: string;
	title: string;
	price: number;
	quantity: number;
	total: number;
	description?: string;
}

// ========================
// JOB
// ========================

export interface Job {
	id?: number;
	clientId: number;
	title: string;
	start: Date;
	end: Date;
	assignedCrew: string[];
	status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
	billableItems: BillableItem[];
	subtotal: number;
	taxRate?: number;
	taxAmount?: number;
	totalAmount: number;
	notes?: string;
	areaOfTown: AreaOfTown;
	invoiceSentAt?: Date;
	invoicePaidAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

// ========================
// SERVICE HISTORY
// ========================

export interface ServiceHistory {
	id?: number;
	clientId: number;
	jobId: number;
	serviceDate: Date;
	serviceType: string;
	price: number;
	notes?: string;
	createdAt: Date;
	updatedAt: Date;
}

// ========================
// DATABASE
// ========================

export const db = new Dexie('CapitalCityWindows') as Dexie & {
	clients: EntityTable<Client, 'id'>;
	jobs: EntityTable<Job, 'id'>;
	serviceHistory: EntityTable<ServiceHistory, 'id'>;
};

db.version(1).stores({
	clients: '++id, name, areaOfTown, email, phone, createdAt',
	jobs: '++id, clientId, start, end, status, areaOfTown, *assignedCrew, createdAt',
	serviceHistory: '++id, clientId, jobId, serviceDate'
});

// ========================
// HELPER FUNCTIONS
// ========================

/** Calculate totals for a job */
export function calculateJobTotals(billableItems: BillableItem[], customTaxRate?: number) {
	const subtotal = billableItems.reduce((sum, item) => {
		return sum + (item.total || item.price * item.quantity);
	}, 0);

	const taxRate = customTaxRate ?? BUSINESS_CONFIG.defaultTaxRate;
	const taxAmount = subtotal * taxRate;
	const totalAmount = subtotal + taxAmount;

	return { subtotal, taxRate, taxAmount, totalAmount };
}

/** Get jobs for FullCalendar in a date range */
export async function getJobsForRange(start: Date, end: Date) {
	return await db.jobs
		.where('start')
		.between(start, end, true, true) // inclusive on both ends
		.sortBy('start');
}

/** Get client + all their jobs */
export async function getClientWithJobs(clientId: number) {
	const client = await db.clients.get(clientId);
	const jobs = await db.jobs.where('clientId').equals(clientId).sortBy('start');

	return { client, jobs };
}

export default db;
