// =============================================
// CapitalCity Windows - Business Configuration
// =============================================

export const BUSINESS_CONFIG = {
	// === Company Information ===
	companyName: 'Capital City Windows LLC',
	companyTagline: "Juneau's Premiere Window & Building Cleaning Company",
	mission: 'JUNEAU BEAUTIFICATION',
	ownerName: 'Brick Engstrom',
	ownerPhone: '907-723-4617',
	ownerEmail: 'brick@gotdirtywindows.com',
	mailingAddress: 'PO Box 20312, Juneau, AK 99802',

	// === Tax Settings (Juneau) ===
	defaultTaxRate: 0.05, // 5% - Update here if it changes

	crewMembers: ['Mike', 'Emily', 'James'] as const,

	// === Juneau Service Areas ===
	areasOfTown: {
		thane: {
			label: 'Thane',
			color: '#22c55e',
			sortOrder: 1
		},
		'south-douglas': {
			label: 'South Douglas',
			color: '#eab308',
			sortOrder: 2
		},
		'north-douglas': {
			label: 'North Douglas',
			color: '#f97316',
			sortOrder: 3
		},
		downtown: {
			label: 'Downtown Juneau',
			color: '#60a5fa',
			sortOrder: 4
		},
		'twin-lakes-lemon-creek': {
			label: 'Twin Lakes / Lemon Crk',
			color: '#2563eb',
			sortOrder: 5
		},
		valley: {
			label: 'Valley',
			color: '#1d4ed8',
			sortOrder: 6
		},
		'back-loop-fritz-cove': {
			label: 'Back Loop / Fritz Cove',
			color: '#1e40af',
			sortOrder: 7
		},
		'deharts': {
			label: "DeHart's",
			color: '#1e3a8a',
			sortOrder: 8
		}
	} as const,

	// === Service Types ===
	commonServices: [
		'Window Cleaning (Residential & Commercial)',
		'High-Rise Window Cleaning',
		'Roof Cleaning (Moss, Algae, Mold)',
		'Moss Prevention Treatment',
		'Siding & Gutter Cleaning',
		'Glass Restoration (Hard Water Spots)',
		'Spider Eradication / Prevention'
	],

	// === Default Billable Item Templates ===
	commonBillableItems: [
		{ title: 'Full Exterior Window Cleaning', price: null, quantity: 1, description: 'Standard residential or small commercial'},
		{ title: 'Interior Window Cleaning', price: null, quantity: 1, description: '' },
		{ title: 'High Windows / Skylights', price: null, quantity: 1, description: '' },
		{ title: 'Roof Moss Cleaning', price: null, quantity: 1, description: '' },
		{ title: 'Siding / Gutter Cleaning', price: null, quantity: 1, description: '' },
		{ title: 'Glass Restoration', price: null, quantity: 1, description: '' },
		{ title: 'Spider Treatment', price: null, quantity: 1, description: '' }
	],

	//  NEW: Cancellation reasons (centralized)
	cancelReasons: [
		'Customer cancelled',
		'Scheduling conflict',
		'Weather / No access',
		'Crew unavailable',
		'Other'
	] as const,

	// === Job Settings ===
	defaultJobDurationHours: 4,
	defaultStartTime: '09:00',

	// === Invoice & Business Settings ===
	invoiceDueDays: 15,
	currency: 'USD'
} as const;



// ========================
// DERIVED TYPES
// ========================

export type AreaOfTown = keyof typeof BUSINESS_CONFIG.areasOfTown;
export type CrewMember = (typeof BUSINESS_CONFIG.crewMembers)[number];
export type BillableItemTemplate = (typeof BUSINESS_CONFIG.commonBillableItems)[number];

export default BUSINESS_CONFIG;
