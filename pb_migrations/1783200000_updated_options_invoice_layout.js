/// <reference path="../pb_data/types.d.ts" />
/**
 * Invoice Word layout style: quiet | pay_first | job_packet
 * Selected in Admin → Options → Invoice.
 */
migrate((app) => {
	const collection = app.findCollectionByNameOrId('pbc_1097237869');
	const existing = new Set(collection.fields.map((f) => f.name));
	if (existing.has('invoiceLayout')) return;

	collection.fields.add(
		new Field({
			autogeneratePattern: '',
			hidden: false,
			id: 'txtinvlayout01',
			max: 0,
			min: 0,
			name: 'invoiceLayout',
			pattern: '',
			presentable: false,
			primaryKey: false,
			required: false,
			system: false,
			type: 'text'
		})
	);

	return app.save(collection);
}, (app) => {
	const collection = app.findCollectionByNameOrId('pbc_1097237869');
	try {
		collection.fields.removeById('txtinvlayout01');
	} catch (_) {
		// field may not exist
	}
	return app.save(collection);
});
