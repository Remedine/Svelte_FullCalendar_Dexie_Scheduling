/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("options");

  // Update rules so:
  // - Any authenticated user can list/view options (needed for the whole app: areas, tax, durations etc.)
  // - Only admins can create/update/delete
  collection.listRule = "@request.auth.id != \"\"";
  collection.viewRule = "@request.auth.id != \"\"";
  collection.createRule = "@request.auth.role = \"admin\"";
  collection.updateRule = "@request.auth.role = \"admin\"";
  collection.deleteRule = "@request.auth.role = \"admin\"";

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("options");

  // revert to previous (null = admin only)
  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;

  return app.save(collection);
})
