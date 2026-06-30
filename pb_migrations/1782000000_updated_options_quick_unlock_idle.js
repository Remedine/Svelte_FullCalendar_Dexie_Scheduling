/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  if (!existing.has("quickUnlockIdleMinutes")) {
    collection.fields.add(new Field({
      "hidden": false,
      "id": "numqkidle01",
      "max": 1440,
      "min": 1,
      "name": "quickUnlockIdleMinutes",
      "onlyInt": true,
      "presentable": false,
      "required": false,
      "system": false,
      "type": "number"
    }))
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const field = collection.fields.find((f) => f.name === "quickUnlockIdleMinutes")
  if (field) {
    collection.fields.removeById(field.id)
  }
  return app.save(collection)
})