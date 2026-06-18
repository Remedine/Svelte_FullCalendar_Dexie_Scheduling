/** Business + invoice settings pulled from AppOptions for docx generation. */
export interface InvoiceDocxBusinessInfo {
	businessName?: string;
	businessStreet?: string;
	businessCity?: string;
	businessState?: string;
	businessZip?: string;
	businessPhone?: string;
	businessEmail?: string;
	businessWebsite?: string;
	businessMailingStreet?: string;
	businessMailingCity?: string;
	businessMailingState?: string;
	businessMailingZip?: string;
	businessSalesTaxAccount?: string;
	salesTaxJurisdiction?: string;
	taxRate?: number;
	invoiceDueDays?: number;
	/** Closing signature on payment block (defaults when omitted). */
	invoiceSignatoryName?: string;
	invoiceSignatoryPhone?: string;
}

export interface InvoiceDocxContext extends InvoiceDocxBusinessInfo {
	invoiceNumber: string;
	invoiceDate?: Date;
	/** Invoice-specific notes (not job or client notes). */
	invoiceNotes?: string;
}

/** Dev-only: overlay #10 window guides on the top tri-fold panel. */
export interface InvoiceDocxGenerateOptions {
	envelopePreview?: boolean;
}