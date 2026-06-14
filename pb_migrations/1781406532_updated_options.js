/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")

  // update field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2324736937",
    "max": 0,
    "min": 0,
    "name": "key",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")

  // update field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2324736937",
    "max": 0,
    "min": 0,
    "name": "key",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
