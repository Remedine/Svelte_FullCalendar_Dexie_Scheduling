/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_711030668")

  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "jsonclientsnap1",
    "maxSize": 0,
    "name": "clientSnapshot",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "jsoninvdisc1",
    "maxSize": 0,
    "name": "invoiceDiscount",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  collection.fields.addAt(14, new Field({
    "hidden": false,
    "id": "dateinvdate1",
    "max": "",
    "min": "",
    "name": "invoiceDate",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  collection.fields.addAt(15, new Field({
    "hidden": false,
    "id": "numversion1",
    "max": null,
    "min": null,
    "name": "version",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  collection.fields.addAt(16, new Field({
    "hidden": false,
    "id": "datelastgen1",
    "max": "",
    "min": "",
    "name": "lastGeneratedAt",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  collection.fields.addAt(17, new Field({
    "hidden": false,
    "id": "numsubtotal1",
    "max": null,
    "min": null,
    "name": "subtotal",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  collection.fields.addAt(18, new Field({
    "hidden": false,
    "id": "numtaxamt1",
    "max": null,
    "min": null,
    "name": "taxAmount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_711030668")
  collection.fields.removeById("jsonclientsnap1")
  collection.fields.removeById("jsoninvdisc1")
  collection.fields.removeById("dateinvdate1")
  collection.fields.removeById("numversion1")
  collection.fields.removeById("datelastgen1")
  collection.fields.removeById("numsubtotal1")
  collection.fields.removeById("numtaxamt1")
  return app.save(collection)
})