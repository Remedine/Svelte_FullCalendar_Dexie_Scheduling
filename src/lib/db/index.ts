import Dexie, { type EntityTable } from 'dexie';

export interface Client {
	id?: number;
	name: string;
	serviceAddressStreet: string;
	serviceAddressCity: string;
	serviceAddressState: string;
	serviceAddressZip: string;
	areaOfTown: 'thane' | 'downtown' | 'douglas';
	preferredBillingMethod: 'email' | 'check' | 'invoice';
	phone: string;
	email: string;
	notes?: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}

export interface Job {
	id?: number;
	clientId: number;
	title: string;
	start: Date;
	end: Date;
	assignedCrew: string[];
	status: 'scheduled' | 'confirmed' | 'completed';
	billableItems: Array<{
		title: string;
		price: number;
		quantity: number;
		total: number;
	}>;
	subtotal: number;
	taxRate: number;
	taxAmount: number;
	totalAmount: number;
	areaOfTown: 'thane' | 'downtown' | 'douglas';
	notes?: string;
	createdAt: Date;
	updatedAt: Date;
}

const db = new Dexie('CapitalCityWindows') as Dexie & {
	clients: EntityTable<Client, 'id'>;
	jobs: EntityTable<Job, 'id'>;
};

db.version(1).stores({
	clients: '++id, name, areaOfTown, email',
	jobs: '++id, clientId, start, end, status, areaOfTown'
});

export async function getJobsForRange(start: Date, end: Date): Promise<Job[]> {
	return await db.jobs.where('start').between(start, end, true, true).toArray();
}

export async function getUpcomingJobs(limit = 10): Promise<Job[]> {
	const now = new Date();
	return await db.jobs.where('start').aboveOrEqual(now).limit(limit).toArray();
}

export { db };
export type { Client, Job };
