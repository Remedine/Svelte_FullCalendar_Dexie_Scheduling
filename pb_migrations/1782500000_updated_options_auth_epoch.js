/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  if (!existing.has("authEpoch")) {
    collection.fields.add(new Field({
      "hidden": false,
      "id": "numauthepoch1",
      "max": null,
      "min": 0,
      "name": "authEpoch",
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
  const field = collection.fields.find((f) => f.name === "authEpoch")
  if (field) {
    collection.fields.removeById(field.id)
  }
  return app.save(collection)
})