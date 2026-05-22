/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update field
  collection.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "number3097235076",
    "max": null,
    "min": null,
    "name": "subtotal",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "number3520795564",
    "max": null,
    "min": null,
    "name": "taxRate",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "number2957995209",
    "max": null,
    "min": null,
    "name": "taxAmount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(11, new Field({
    "help": "",
    "hidden": false,
    "id": "number3225882586",
    "max": null,
    "min": null,
    "name": "totalAmount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update field
  collection.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "number3097235076",
    "max": null,
    "min": null,
    "name": "subtotal",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "number3520795564",
    "max": null,
    "min": null,
    "name": "taxRate",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "number2957995209",
    "max": null,
    "min": null,
    "name": "taxAmount",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(11, new Field({
    "help": "",
    "hidden": false,
    "id": "number3225882586",
    "max": null,
    "min": null,
    "name": "totalAmount",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
