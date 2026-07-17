/// <reference path="../pb_data/types.d.ts" />
/**
 * Bulk import: importKey + importSource on jobs; importKey on invoices.
 * (invoices already have importSource)
 */
migrate((app) => {
	const jobs = app.findCollectionByNameOrId('pbc_2409499253');

	jobs.fields.addAt(
		jobs.fields.length,
		new Field({
			autogeneratePattern: '',
			hidden: false,
			id: 'txtjobimpsrc01',
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

	jobs.fields.addAt(
		jobs.fields.length,
		new Field({
			autogeneratePattern: '',
			hidden: false,
			id: 'txtjobimpkey01',
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

	app.save(jobs);

	const invoices = app.findCollectionByNameOrId('pbc_711030668');

	invoices.fields.addAt(
		invoices.fields.length,
		new Field({
			autogeneratePattern: '',
			hidden: false,
			id: 'txtinvimpkey01',
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

	return app.save(invoices);
}, (app) => {
	const jobs = app.findCollectionByNameOrId('pbc_2409499253');
	jobs.fields.removeById('txtjobimpsrc01');
	jobs.fields.removeById('txtjobimpkey01');
	app.save(jobs);

	const invoices = app.findCollectionByNameOrId('pbc_711030668');
	invoices.fields.removeById('txtinvimpkey01');
	return app.save(invoices);
});
