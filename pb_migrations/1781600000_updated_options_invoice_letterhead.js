/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")

  const fields = [
    { id: "txtbizname01", name: "businessName", type: "text" },
    { id: "txtbizstrt01", name: "businessStreet", type: "text" },
    { id: "txtbizcity01", name: "businessCity", type: "text" },
    { id: "txtbizst01", name: "businessState", type: "text" },
    { id: "txtbizzip01", name: "businessZip", type: "text" },
    { id: "txtbizph01", name: "businessPhone", type: "text" },
    { id: "txtbizem01", name: "businessEmail", type: "text" },
    { id: "txtbizweb01", name: "businessWebsite", type: "text" },
    { id: "txtmailstr01", name: "businessMailingStreet", type: "text" },
    { id: "txtmailcty01", name: "businessMailingCity", type: "text" },
    { id: "txtmailst01", name: "businessMailingState", type: "text" },
    { id: "txtmailzip01", name: "businessMailingZip", type: "text" },
    { id: "txtbiztax01", name: "businessSalesTaxAccount", type: "text" },
    { id: "txttaxjur01", name: "salesTaxJurisdiction", type: "text" },
    { id: "txtinvpfx01", name: "invoiceNumberPrefix", type: "text" },
    { id: "numinvnext01", name: "nextInvoiceNumber", type: "number" },
    { id: "numinvyr01", name: "invoiceNumberYear", type: "number" }
  ]

  let at = 12
  for (const f of fields) {
    if (f.type === "number") {
      collection.fields.addAt(at++, new Field({
        "hidden": false,
        "id": f.id,
        "max": null,
        "min": null,
        "name": f.name,
        "onlyInt": true,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      }))
    } else {
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
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const ids = [
    "txtbizname01", "txtbizstrt01", "txtbizcity01", "txtbizst01", "txtbizzip01",
    "txtbizph01", "txtbizem01", "txtbizweb01", "txtmailstr01", "txtmailcty01",
    "txtmailst01", "txtmailzip01", "txtbiztax01", "txttaxjur01", "txtinvpfx01",
    "numinvnext01", "numinvyr01"
  ]
  for (const id of ids) {
    collection.fields.removeById(id)
  }
  return app.save(collection)
})