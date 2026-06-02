/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // remove field
  collection.fields.removeById("date77292808")

  // add field
  collection.fields.addAt(17, new Field({
    "cascadeDelete": false,
    "collectionId": "_pb_users_auth_",
    "help": "",
    "hidden": false,
    "id": "relation77292808",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "cancelledBy",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // add field
  collection.fields.addAt(17, new Field({
    "help": "",
    "hidden": false,
    "id": "date77292808",
    "max": "",
    "min": "",
    "name": "cancelledBy",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // remove field
  collection.fields.removeById("relation77292808")

  return app.save(collection)
})
