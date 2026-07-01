/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  const addBool = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        hidden: false,
        id,
        name,
        presentable: false,
        required: false,
        system: false,
        type: "bool"
      }))
    }
  }

  const addText = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        autogeneratePattern: "",
        hidden: false,
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

  const addNumber = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        hidden: false,
        id,
        max: null,
        min: null,
        name,
        onlyInt: false,
        presentable: false,
        required: false,
        system: false,
        type: "number"
      }))
    }
  }

  addBool("backupDestGoogleDrive", "boolbkgdrive1")
  addText("backupGoogleDriveFolderId", "txtbkgfolder1")
  addNumber("backupScheduledHour", "numbkshour1")
  addText("lastScheduledBackupDate", "txtbklastdate1")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const remove = [
    "backupDestGoogleDrive",
    "backupGoogleDriveFolderId",
    "backupScheduledHour",
    "lastScheduledBackupDate"
  ]
  for (const name of remove) {
    const field = collection.fields.find((f) => f.name === name)
    if (field) {
      collection.fields.removeById(field.id)
    }
  }
  return app.save(collection)
})