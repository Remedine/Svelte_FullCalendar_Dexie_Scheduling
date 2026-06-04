/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2442875294")

  // remove field
  collection.fields.removeById("select2480703543")

  // add field
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2480703543",
    "max": 0,
    "min": 0,
    "name": "areaOfTown",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2442875294")

  // add field
  collection.fields.addAt(6, new Field({
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
      "downtown",
      "thane",
      "south-douglas",
      "north-douglas",
      "twin-lakes-lemon-creek",
      "valley",
      "back-loop-fritz-cove",
      "deharts"
    ]
  }))

  // remove field
  collection.fields.removeById("text2480703543")

  return app.save(collection)
})
