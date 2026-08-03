/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // Admin-managed crew photos: when true, non-admins must not change their own photo.
  // Default false so existing self-serve avatar flow is unchanged.
  collection.fields.addAt(collection.fields.length, new Field({
    "hidden": false,
    "id": "bool_photo_locked_001",
    "name": "photoLocked",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // Admins can always update any user.
  // Crew may update their own record except:
  // - cannot set photoLocked (admin-only)
  // - cannot change photo when photoLocked is already true on the record
  collection.updateRule =
    '@request.auth.role = "admin" || (' +
    'id = @request.auth.id && ' +
    '(@request.data.photoLocked:isset = false) && ' +
    '(photoLocked != true || @request.data.photo:isset = false)' +
    ')'

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  collection.fields.removeById("bool_photo_locked_001")
  collection.updateRule = '@request.auth.role = "admin" || @request.auth.id = id'

  return app.save(collection)
})
