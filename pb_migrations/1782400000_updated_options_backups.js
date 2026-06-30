/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  const addBool = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        "hidden": false,
        "id": id,
        "name": name,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      }))
    }
  }

  const addText = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        "autogeneratePattern": "",
        "hidden": false,
        "id": id,
        "max": 0,
        "min": 0,
        "name": name,
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      }))
    }
  }

  const addNumber = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        "hidden": false,
        "id": id,
        "max": null,
        "min": null,
        "name": name,
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      }))
    }
  }

  const addDate = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        "hidden": false,
        "id": id,
        "max": "",
        "min": "",
        "name": name,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      }))
    }
  }

  const addJson = (name, id) => {
    if (!existing.has(name)) {
      collection.fields.add(new Field({
        "hidden": false,
        "id": id,
        "maxSize": 2000000,
        "name": name,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      }))
    }
  }

  addBool("backupScheduledEnabled", "boolbksched1")
  addBool("backupDestEmail", "boolbkemail1")
  addText("backupAlertEmails", "txtbkalerts1")
  addText("lastBackupFilename", "txtbkfile1")
  addText("lastBackupStatus", "txtbkstat1")
  addText("lastBackupError", "txtbkerr1")
  addNumber("lastBackupSizeBytes", "numbksize1")
  addDate("lastBackupAt", "datebklast1")
  addDate("syncQueueSnapshotAt", "datesyncsnap1")
  addJson("syncQueueSnapshot", "jsonsyncsnap1")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const remove = [
    "backupScheduledEnabled",
    "backupDestEmail",
    "backupAlertEmails",
    "lastBackupFilename",
    "lastBackupStatus",
    "lastBackupError",
    "lastBackupSizeBytes",
    "lastBackupAt",
    "syncQueueSnapshotAt",
    "syncQueueSnapshot"
  ]
  for (const name of remove) {
    const field = collection.fields.find((f) => f.name === name)
    if (field) {
      collection.fields.removeById(field.id)
    }
  }
  return app.save(collection)
})