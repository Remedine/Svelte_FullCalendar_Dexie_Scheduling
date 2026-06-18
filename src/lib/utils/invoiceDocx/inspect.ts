import { inflateRawSync } from 'node:zlib';
import {
	ENVELOPE_MAIL_TO_TOP,
	ENVELOPE_RETURN_OFFSET,
	ENVELOPE_WINDOW_WIDTH
} from './layout';

export interface InvoiceDocxStructure {
	documentXml: string;
	plainText: string;
}

const DOCUMENT_ENTRY = 'word/document.xml';

/** Minimal zip entry reader for .docx test inspection (no extra dependencies). */
async function readZipEntry(blob: Blob, entryName: string): Promise<string> {
	const data = new Uint8Array(await blob.arrayBuffer());
	let offset = 0;

	while (offset + 30 < data.length) {
		if (
			data[offset] !== 0x50 ||
			data[offset + 1] !== 0x4b ||
			data[offset + 2] !== 0x03 ||
			data[offset + 3] !== 0x04
		) {
			offset++;
			continue;
		}

		const compression = data[offset + 8] | (data[offset + 9] << 8);
		const compressedSize =
			data[offset + 18] |
			(data[offset + 19] << 8) |
			(data[offset + 20] << 16) |
			(data[offset + 21] << 24);
		const fileNameLen = data[offset + 26] | (data[offset + 27] << 8);
		const extraLen = data[offset + 28] | (data[offset + 29] << 8);
		const nameStart = offset + 30;
		const name = new TextDecoder().decode(data.slice(nameStart, nameStart + fileNameLen));
		const dataStart = nameStart + fileNameLen + extraLen;

		if (name === entryName) {
			const payload = data.slice(dataStart, dataStart + compressedSize);
			if (compression === 0) {
				return new TextDecoder().decode(payload);
			}
			if (compression === 8) {
				return new TextDecoder().decode(inflateRawSync(payload));
			}
			throw new Error(`Unsupported zip compression method ${compression} for ${entryName}`);
		}

		offset = dataStart + compressedSize;
	}

	throw new Error(`${entryName} missing from docx zip`);
}

export async function readInvoiceDocxStructure(blob: Blob): Promise<InvoiceDocxStructure> {
	const documentXml = await readZipEntry(blob, DOCUMENT_ENTRY);
	const plainText = documentXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	return { documentXml, plainText };
}

export function hasEnvelopeRecipientRowHeight(documentXml: string): boolean {
	return documentXml.includes(`w:val="${ENVELOPE_MAIL_TO_TOP}"`);
}

export function hasEnvelopeReturnOffset(documentXml: string): boolean {
	return (
		documentXml.includes(`w:before="${ENVELOPE_RETURN_OFFSET}"`) ||
		documentXml.includes(`w:before w:val="${ENVELOPE_RETURN_OFFSET}"`)
	);
}

export function hasEnvelopeWindowColumnWidth(documentXml: string): boolean {
	return documentXml.includes(`w:w="${ENVELOPE_WINDOW_WIDTH}"`);
}

export function hasEnvelopeMailToLabel(plainText: string): boolean {
	return /\bMail to:/i.test(plainText);
}

export function hasTotalsRightAlignment(documentXml: string, total: number): boolean {
	const amount = `$${total.toFixed(2)}`;
	const totalIdx = documentXml.indexOf('Total');
	if (totalIdx < 0) return false;
	const slice = documentXml.slice(totalIdx, totalIdx + 800);
	return slice.includes('w:val="right"') && documentXml.includes(amount);
}

export function hasEnvelopePreviewMarkers(plainText: string): boolean {
	return (
		plainText.includes('RETURN WINDOW (dev preview)') &&
		plainText.includes('RECIPIENT WINDOW (dev preview)')
	);
}