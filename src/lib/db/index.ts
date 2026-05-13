import Dexie, { type EntityTable } from "dexie";
import { subDays, addDays } from "date-fns";

// =======================
// TYPES
// =======================

export interface Client {
	id?: number;
	name: string;

	// Service Address
	serviceAddressStreet: string;
	serviceAddressCity: string;
	serviceAddressState: string;
	serviceAddressZip: string;

	areaOfTown:
		| 'thane'
		| 'south-douglas'
		| 'north-douglas'
		| 'downtown'
		| 'twin-lakes-lemon-creek'
		| 'valley'
		| 'back-loop-fritz-cove'
		| 'deharts-and-beyond';

	// Billing Address
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
	title: string; // e.g. "Exterior Windows - Main House"
	price: number;
	quantity: number;
	total: number; // price * quantity
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

	// Billing
	billableItems: BillableItem[];
	subtotal: number;
	taxRate?: number; // e.g. 0.06
	taxAmount?: number;
	totalAmount: number;

	notes?: string;
	areaOfTown: Client['areaOfTown'];

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

export const db = new Dexie('CaitalCityWindows') as Dexie & {
    clients: EntityTable<Client, 'id'>;
    jobs: EntityTable<Job, 'id'>;
    serviceHistory: EntityTable<ServiceHistory, 'id'>;
}

db.version(1).stores({
	clients: '++id, name, areaOfTown, email, phone, createdAt',
	jobs: '++id, clientId, start, end, status, areaOfTown, *assignedCrew, createdAt',
	serviceHistory: '++id, clientId, jobId, serviceDate'
});

// ========================
// HELPER FUNCTIONS
// ========================

// Auto-calculate totals for a job
//double check tax rate 
export function calculateJobTotals(billableItems: BillableItem[], taxtRate = 5%)