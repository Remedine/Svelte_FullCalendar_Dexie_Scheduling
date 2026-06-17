/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2442875294")

  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "boolbilladdr01",
    "name": "useBillingAddress",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  const textFields = [
    { id: "txtbillstrt01", name: "billingAddressStreet" },
    { id: "txtbillcity01", name: "billingAddressCity" },
    { id: "txtbillst01", name: "billingAddressState" },
    { id: "txtbillzip01", name: "billingAddressZip" }
  ]

  let at = 9
  for (const f of textFields) {
    collection.fields.addAt(at++, new Field({
      "autogeneratePattern": "",
      "hidden": false,
      "id": f.id,
      "max": 0,
      "min": 0,
      "name": f.name,
      "pattern": "",
      "presentable": false,
      "primaryKey": false,
      "required": false,
      "system": false,
      "type": "text"
    }))
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2442875294")
  collection.fields.removeById("boolbilladdr01")
  collection.fields.removeById("txtbillstrt01")
  collection.fields.removeById("txtbillcity01")
  collection.fields.removeById("txtbillst01")
  collection.fields.removeById("txtbillzip01")
  return app.save(collection)
})