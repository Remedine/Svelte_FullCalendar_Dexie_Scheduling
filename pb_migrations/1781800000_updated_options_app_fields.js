/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const existing = new Set(collection.fields.map((f) => f.name))

  const textFields = [
    { id: "txtbizname01", name: "businessName" },
    { id: "txtbizstrt01", name: "businessStreet" },
    { id: "txtbizcity01", name: "businessCity" },
    { id: "txtbizst01", name: "businessState" },
    { id: "txtbizzip01", name: "businessZip" },
    { id: "txtbizph01", name: "businessPhone" },
    { id: "txtbizem01", name: "businessEmail" },
    { id: "txtbizweb01", name: "businessWebsite" },
    { id: "txtmailstr01", name: "businessMailingStreet" },
    { id: "txtmailcty01", name: "businessMailingCity" },
    { id: "txtmailst01", name: "businessMailingState" },
    { id: "txtmailzip01", name: "businessMailingZip" },
    { id: "txtbiztax01", name: "businessSalesTaxAccount" },
    { id: "txttaxjur01", name: "salesTaxJurisdiction" },
    { id: "txtinvpfx01", name: "invoiceNumberPrefix" }
  ]

  const numberFields = [
    { id: "numcalstart01", name: "calendarDayStartHour", min: 0, max: 23, onlyInt: true },
    { id: "numcalend01", name: "calendarDayEndHour", min: 1, max: 24, onlyInt: true },
    { id: "numcrewdays01", name: "crewAssignmentDaysBefore", min: 0, max: 30, onlyInt: true },
    { id: "numcrewhour01", name: "crewAssignmentHour", min: 0, max: 23, onlyInt: true },
    { id: "numinvnext01", name: "nextInvoiceNumber", min: null, max: null, onlyInt: true },
    { id: "numinvyr01", name: "invoiceNumberYear", min: null, max: null, onlyInt: true }
  ]

  for (const f of textFields) {
    if (existing.has(f.name)) continue
    collection.fields.add(new Field({
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

  for (const f of numberFields) {
    if (existing.has(f.name)) continue
    collection.fields.add(new Field({
      "hidden": false,
      "id": f.id,
      "max": f.max,
      "min": f.min,
      "name": f.name,
      "onlyInt": f.onlyInt,
      "presentable": false,
      "required": false,
      "system": false,
      "type": "number"
    }))
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1097237869")
  const ids = [
    "txtbizname01", "txtbizstrt01", "txtbizcity01", "txtbizst01", "txtbizzip01",
    "txtbizph01", "txtbizem01", "txtbizweb01", "txtmailstr01", "txtmailcty01",
    "txtmailst01", "txtmailzip01", "txtbiztax01", "txttaxjur01", "txtinvpfx01",
    "numcalstart01", "numcalend01", "numcrewdays01", "numcrewhour01",
    "numinvnext01", "numinvyr01"
  ]
  for (const id of ids) {
    try {
      collection.fields.removeById(id)
    } catch (_) {
      // field may not exist if forward migration skipped it
    }
  }
  return app.save(collection)
})