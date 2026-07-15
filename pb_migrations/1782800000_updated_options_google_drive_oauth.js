/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  const addText = (name, id, hidden = false) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        autogeneratePattern: "",
        hidden,
        id,
        max: 0,
        min: 0,
        name,
        pattern: "",
        presentable: false,
        primaryKey: false,
        required: false,
        system: false,
        type: "text"
      }))
    }
  }

  // Refresh token must NOT be PocketBase-hidden: the internal options API strips hidden fields,
  // which broke Drive uploads. Value is AES-GCM sealed by the Svelte server before save.
  addText("backupGoogleDriveRefreshToken", "txtbkgdrvtoken1", false)
  addText("backupGoogleDriveEmail", "txtbkgdrvemail1", false)
  addText("backupGoogleDriveFolderName", "txtbkgdrvfname1", false)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const remove = [
    "backupGoogleDriveRefreshToken",
    "backupGoogleDriveEmail",
    "backupGoogleDriveFolderName"
  ]
  for (const name of remove) {
    const field = collection.fields.find((f) => f.name === name)
    if (field) {
      collection.fields.removeById(field.id)
    }
  }
  return app.save(collection)
})
