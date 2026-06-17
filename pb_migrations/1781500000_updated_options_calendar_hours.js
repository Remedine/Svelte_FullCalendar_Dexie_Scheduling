/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")

  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "numcalstart01",
    "max": 23,
    "min": 0,
    "name": "calendarDayStartHour",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "numcalend01",
    "max": 24,
    "min": 1,
    "name": "calendarDayEndHour",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")

  collection.fields.removeById("numcalstart01")
  collection.fields.removeById("numcalend01")

  return app.save(collection)
})