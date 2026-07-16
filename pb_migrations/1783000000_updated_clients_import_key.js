/// <reference path="../pb_data/types.d.ts" />
/**
 * Bulk import: stable external id (importKey) + origin label (importSource) on clients.
 */
migrate((app) => {
	const collection = app.findCollectionByNameOrId('pbc_2442875294');

	collection.fields.addAt(
		collection.fields.length,
		new Field({
			autogeneratePattern: '',
			hidden: false,
			id: 'txtclientimpkey01',
			max: 0,
			min: 0,
			name: 'importKey',
			pattern: '',
			presentable: false,
			primaryKey: false,
			required: false,
			system: false,
			type: 'text'
		})
	);

	collection.fields.addAt(
		collection.fields.length,
		new Field({
			autogeneratePattern: '',
			hidden: false,
			id: 'txtclientimpsrc01',
			max: 0,
			min: 0,
			name: 'importSource',
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
	const collection = app.findCollectionByNameOrId('pbc_2442875294');
	collection.fields.removeById('txtclientimpkey01');
	collection.fields.removeById('txtclientimpsrc01');
	return app.save(collection);
});
