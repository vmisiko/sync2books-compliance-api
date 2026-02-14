# Domain Model Specification

This file defines authoritative domain entities.

---

## ComplianceDocument

```ts
ComplianceDocument {
  id: UUID
  merchantId: UUID
  branchId: string  // bhfId
  documentType: enum
  documentNumber: string
  externalReferenceId: string
  customerPin: string | null
  currency: string
  exchangeRate: number
  subtotalAmount: decimal
  taxAmount: decimal
  totalAmount: decimal
  status: enum
  oscuReceiptNumber: string | null
  oscuResponsePayload: JSON | null
  submissionAttempts: number
  createdAt: timestamp
  submittedAt: timestamp | null
} 
```

## ComplianceDocumentLine

Snapshot entity. Never mutated after submission.

```
ComplianceDocumentLine {
  id
  documentId
  itemId
  itemVersion
  itemNameSnapshot
  classificationSnapshot
  taxCategorySnapshot
  unitSnapshot
  quantity
  unitPrice
  taxAmount
  totalAmount
}
```

## ComplianceItem
```
ComplianceItem {
  id
  merchantId
  externalId
  name
  sku
  itemType: GOODS | SERVICE
  taxCategory
  classificationCode
  unitCode
  registrationStatus
  version
  status
  lastSyncedAt
}
```

## InventoryStock
``` InventoryStock {
  itemId
  branchId
  quantityOnHand
  reservedQuantity
  lastMovementAt
}
```

## StockMovement
```
StockMovement {
  id
  itemId
  branchId
  movementType
  quantity
  referenceType
  referenceId
  createdAt
}
```

## ComplianceConnection

```
ComplianceConnection {
  merchantId
  branchId
  tin
  bhfId
  deviceSerial
  certificateKey
  status
}
```

