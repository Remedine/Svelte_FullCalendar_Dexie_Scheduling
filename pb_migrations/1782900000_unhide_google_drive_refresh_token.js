/// <reference path="../pb_data/types.d.ts" />
/**
 * Production internal options JSON omits PocketBase "hidden" fields.
 * Unhide the OAuth refresh token field so backup uploads can read it.
 * The app encrypts the token before storing.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const field = collection.fields.find((f) => f.name === "backupGoogleDriveRefreshToken")
  if (field && field.hidden) {
    field.hidden = false
    return app.save(collection)
  }
  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const field = collection.fields.find((f) => f.name === "backupGoogleDriveRefreshToken")
  if (field) {
    field.hidden = true
    return app.save(collection)
  }
  return null
})
