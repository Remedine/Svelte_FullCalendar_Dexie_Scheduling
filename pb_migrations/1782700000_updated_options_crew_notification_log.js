/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  if (!existing.has("crewNotificationLog")) {
    collection.fields.add(new Field({
      hidden: false,
      id: "jsoncrewlog01",
      maxSize: 2000000,
      name: "crewNotificationLog",
      presentable: false,
      required: false,
      system: false,
      type: "json"
    }))
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const field = collection.fields.find((f) => f.name === "crewNotificationLog")
  if (field) {
    collection.fields.removeById(field.id)
  }
  return app.save(collection)
})