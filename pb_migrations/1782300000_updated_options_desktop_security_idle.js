/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  if (!existing.has("desktopSecurityIdleMinutes")) {
    collection.fields.add(new Field({
      "hidden": false,
      "id": "numdesksec01",
      "max": 1440,
      "min": 1,
      "name": "desktopSecurityIdleMinutes",
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
  const field = collection.fields.find((f) => f.name === "desktopSecurityIdleMinutes")
  if (field) {
    collection.fields.removeById(field.id)
  }
  return app.save(collection)
})