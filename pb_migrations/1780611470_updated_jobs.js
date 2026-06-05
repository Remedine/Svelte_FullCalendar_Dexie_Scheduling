/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // remove field
  collection.fields.removeById("select2480703543")

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "json2480703543",
    "maxSize": 0,
    "name": "areaOfTown",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "select2480703543",
    "maxSelect": 0,
    "name": "areaOfTown",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "thane",
      "south-douglas",
      "north-douglas",
      "downtown",
      "twin-lakes-lemon-creek",
      "valley",
      "back-loop-fritz-cove",
      "deharts"
    ]
  }))

  // remove field
  collection.fields.removeById("json2480703543")

  return app.save(collection)
})
