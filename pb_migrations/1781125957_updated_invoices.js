/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_711030668")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.role = \"admin\" || id = @request.auth.id",
    "deleteRule": "@request.auth.role = \"admin\" || id = @request.auth.id",
    "updateRule": "@request.auth.role = \"admin\" || id = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_711030668")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "updateRule": null
  }, collection)

  return app.save(collection)
})
