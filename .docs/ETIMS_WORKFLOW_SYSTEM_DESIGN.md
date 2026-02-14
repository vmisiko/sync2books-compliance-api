# e-TIMS Workflow System Design

## Executive Summary

This document designs a **configurable workflow-based e-TIMS compliance system** that allows businesses to automatically sync transactions, customers, items, and credit notes to Kenya's e-TIMS (Electronic Tax Invoice Management System) and sync ETR receipts back to QuickBooks.

**Core Concept**: Event-driven workflows that businesses can enable/disable and configure based on their needs.

---

## Part 1: Workflow Architecture

### Workflow Engine Overview

```
Event Trigger → Workflow Engine → e-TIMS API → ETR Receipt → Sync back to QuickBooks
```

**Key Components:**
1. **Workflow Configuration** - Businesses configure which workflows to enable
2. **Event Listeners** - Listen to QuickBooks/webhook events
3. **Workflow Executor** - Execute configured workflows
4. **e-TIMS Integration** - Handle e-TIMS API calls
5. **ETR Receipt Handler** - Process and sync ETR receipts back

---

## Part 2: Supported Workflows

### Workflow 1: Invoice → e-TIMS → ETR Receipt Sync

**Trigger**: Invoice created/updated in QuickBooks

**Flow:**
```
1. Invoice created in QuickBooks
   ↓
2. Webhook/Event detected
   ↓
3. Transform QuickBooks invoice to e-TIMS format
   ↓
4. Submit to e-TIMS API
   ↓
5. Receive ETR invoice with QR code
   ↓
6. Store ETR receipt PDF
   ↓
7. Sync ETR receipt as attachment to QuickBooks invoice
   ↓
8. Update invoice metadata with ETR number
```

**Configuration Options:**
- Enable/disable workflow
- Auto-sync on creation vs manual trigger
- Retry on failure
- Notification preferences

---

### Workflow 2: Customer with KRA PIN → e-TIMS Sync

**Trigger**: Customer created/updated with KRA PIN in QuickBooks

**Flow:**
```
1. Customer created/updated in QuickBooks
   ↓
2. Check if customer has KRA PIN
   ↓
3. If PIN exists, validate PIN with KRA
   ↓
4. Create/update customer in e-TIMS
   ↓
5. Store e-TIMS customer ID
   ↓
6. Link e-TIMS customer ID to QuickBooks customer
```

**Configuration Options:**
- Auto-sync customers with PIN
- PIN validation (strict vs lenient)
- Sync on creation only vs also on updates
- Batch sync option

---

### Workflow 3: Item/Inventory → e-TIMS Sync

**Trigger**: Item created/updated in QuickBooks

**Flow:**
```
1. Item created/updated in QuickBooks
   ↓
2. Check if item needs e-TIMS sync (based on tax/service level)
   ↓
3. Transform item to e-TIMS format
   ↓
4. Submit to e-TIMS API
   ↓
5. Store e-TIMS item code
   ↓
6. Link e-TIMS item code to QuickBooks item
```

**Configuration Options:**
- Sync all items vs only taxable items
- Service level filtering
- Tax category filtering
- Auto-sync vs manual

---

### Workflow 4: Credit Note → e-TIMS Sync

**Trigger**: Credit note created in QuickBooks

**Flow:**
```
1. Credit note created in QuickBooks
   ↓
2. Link to original invoice (if exists)
   ↓
3. Transform credit note to e-TIMS format
   ↓
4. Submit to e-TIMS API
   ↓
5. Receive ETR credit note receipt
   ↓
6. Store ETR receipt PDF
   ↓
7. Sync ETR receipt as attachment to QuickBooks credit note
```

**Configuration Options:**
- Auto-sync credit notes
- Link to original invoice requirement
- Retry on failure

---

### Workflow 5: Sales Transaction → e-TIMS Sync

**Trigger**: Sales transaction created (based on service level and tax)

**Flow:**
```
1. Sales transaction created in QuickBooks
   ↓
2. Check service level and tax configuration
   ↓
3. Determine if e-TIMS sync required
   ↓
4. Transform sales to e-TIMS invoice format
   ↓
5. Submit to e-TIMS API
   ↓
6. Receive ETR receipt
   ↓
7. Sync ETR receipt back as attachment
```

**Configuration Options:**
- Service level rules (which service levels require e-TIMS)
- Tax threshold (sync only if tax > threshold)
- Transaction type filtering
- Customer type filtering (B2B vs B2C)

---

## Part 3: Database Schema

### Workflow Configuration Table

```sql
CREATE TABLE `etims_workflow_configs` (
  `id` VARCHAR(36) PRIMARY KEY,
  `applicationId` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `connectionId` VARCHAR(36) NOT NULL,
  
  -- Workflow Type
  `workflowType` ENUM(
    'invoice_sync',
    'customer_sync',
    'item_sync',
    'credit_note_sync',
    'sales_sync'
  ) NOT NULL,
  
  -- Configuration
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `autoSync` BOOLEAN NOT NULL DEFAULT true,
  `config` JSON NOT NULL, -- Workflow-specific configuration
  
  -- Metadata
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`connectionId`) REFERENCES `connections`(`id`) ON DELETE CASCADE,
  
  UNIQUE KEY `unique_workflow_per_connection` (`connectionId`, `workflowType`)
);
```

**Example Config JSON:**
```json
{
  "invoice_sync": {
    "autoSync": true,
    "retryOnFailure": true,
    "maxRetries": 3,
    "notifyOnFailure": true,
    "syncETRReceipt": true
  },
  "customer_sync": {
    "autoSync": true,
    "validatePIN": true,
    "syncOnUpdate": false,
    "batchSync": false
  },
  "item_sync": {
    "autoSync": true,
    "syncOnlyTaxable": true,
    "serviceLevels": ["standard", "premium"],
    "taxCategories": ["VAT", "GST"]
  },
  "credit_note_sync": {
    "autoSync": true,
    "requireOriginalInvoice": true,
    "retryOnFailure": true
  },
  "sales_sync": {
    "autoSync": true,
    "serviceLevels": ["premium", "enterprise"],
    "taxThreshold": 0,
    "transactionTypes": ["invoice", "sales_receipt"],
    "customerTypes": ["B2B", "B2C"]
  }
}
```

---

### e-TIMS Transaction Tracking Table

```sql
CREATE TABLE `etims_transactions` (
  `id` VARCHAR(36) PRIMARY KEY,
  `applicationId` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `connectionId` VARCHAR(36) NOT NULL,
  
  -- Entity Reference
  `entityType` ENUM('invoice', 'customer', 'item', 'credit_note', 'sales') NOT NULL,
  `entityId` VARCHAR(36) NOT NULL, -- QuickBooks entity ID
  `bookId` VARCHAR(255), -- QuickBooks bookId
  
  -- e-TIMS Data
  `etimsInvoiceNumber` VARCHAR(255),
  `etimsCustomerId` VARCHAR(255),
  `etimsItemCode` VARCHAR(255),
  `etrReceiptUrl` VARCHAR(500),
  `etrReceiptPdf` LONGBLOB,
  `qrCode` TEXT,
  
  -- Status
  `status` ENUM('pending', 'syncing', 'synced', 'failed') NOT NULL DEFAULT 'pending',
  `syncError` TEXT,
  `retryCount` INT NOT NULL DEFAULT 0,
  `maxRetries` INT NOT NULL DEFAULT 3,
  
  -- Timestamps
  `syncedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`connectionId`) REFERENCES `connections`(`id`) ON DELETE CASCADE,
  
  INDEX `idx_entity` (`entityType`, `entityId`),
  INDEX `idx_status` (`status`),
  INDEX `idx_connection` (`connectionId`)
);
```

---

### e-TIMS Workflow Execution Log

```sql
CREATE TABLE `etims_workflow_executions` (
  `id` VARCHAR(36) PRIMARY KEY,
  `applicationId` VARCHAR(36) NOT NULL,
  `companyId` VARCHAR(36) NOT NULL,
  `connectionId` VARCHAR(36) NOT NULL,
  
  -- Workflow Info
  `workflowType` VARCHAR(50) NOT NULL,
  `workflowConfigId` VARCHAR(36) NOT NULL,
  
  -- Entity Info
  `entityType` VARCHAR(50) NOT NULL,
  `entityId` VARCHAR(36) NOT NULL,
  
  -- Execution
  `status` ENUM('pending', 'running', 'completed', 'failed') NOT NULL,
  `startedAt` TIMESTAMP NULL,
  `completedAt` TIMESTAMP NULL,
  `duration` INT, -- milliseconds
  
  -- Results
  `etimsTransactionId` VARCHAR(36),
  `error` TEXT,
  `retryCount` INT NOT NULL DEFAULT 0,
  
  -- Metadata
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`workflowConfigId`) REFERENCES `etims_workflow_configs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`etimsTransactionId`) REFERENCES `etims_transactions`(`id`) ON DELETE SET NULL,
  
  INDEX `idx_workflow_type` (`workflowType`),
  INDEX `idx_status` (`status`),
  INDEX `idx_entity` (`entityType`, `entityId`)
);
```

---

## Part 4: Implementation Architecture

### Module Structure

```
api/src/etims/
├── domain/
│   ├── entities/
│   │   ├── etims-workflow-config.entity.ts
│   │   ├── etims-transaction.entity.ts
│   │   ├── etims-workflow-execution.entity.ts
│   │   └── etims-invoice.entity.ts
│   ├── repositories/
│   │   ├── etims-workflow-config.repository.interface.ts
│   │   ├── etims-transaction.repository.interface.ts
│   │   └── etims-workflow-execution.repository.interface.ts
│   └── use-cases/
│       ├── configure-workflow.use-case.ts
│       ├── execute-invoice-workflow.use-case.ts
│       ├── execute-customer-workflow.use-case.ts
│       ├── execute-item-workflow.use-case.ts
│       ├── execute-credit-note-workflow.use-case.ts
│       └── execute-sales-workflow.use-case.ts
├── application/
│   ├── services/
│   │   ├── etims-workflow.service.ts
│   │   ├── etims-api.service.ts
│   │   ├── etims-transformer.service.ts
│   │   └── etr-receipt-handler.service.ts
│   └── dtos/
│       ├── configure-workflow.dto.ts
│       ├── etims-invoice.dto.ts
│       └── workflow-execution-result.dto.ts
├── infrastructure/
│   ├── persistence/
│   │   ├── entities/
│   │   │   ├── etims-workflow-config.entity.ts
│   │   │   ├── etims-transaction.entity.ts
│   │   │   └── etims-workflow-execution.entity.ts
│   │   └── repositories/
│   │       ├── etims-workflow-config.repository.impl.ts
│   │       ├── etims-transaction.repository.impl.ts
│   │       └── etims-workflow-execution.repository.impl.ts
│   └── external/
│       ├── etims-api.client.ts
│       └── etims-auth.service.ts
└── controllers/
    ├── etims-workflow.controller.ts
    └── etims-transaction.controller.ts
```

---

## Part 5: Core Services

### 1. e-TIMS Workflow Service

```typescript
@Injectable()
export class EtimsWorkflowService {
  
  /**
   * Execute workflow based on event
   */
  async executeWorkflow(
    connectionId: string,
    workflowType: WorkflowType,
    entityType: string,
    entityId: string,
    entityData: any
  ): Promise<WorkflowExecutionResult> {
    // 1. Get workflow configuration
    const config = await this.getWorkflowConfig(connectionId, workflowType);
    
    if (!config || !config.enabled) {
      return { skipped: true, reason: 'Workflow not enabled' };
    }
    
    // 2. Create execution log
    const execution = await this.createExecution(config, entityType, entityId);
    
    try {
      // 3. Execute workflow based on type
      let result: any;
      switch (workflowType) {
        case 'invoice_sync':
          result = await this.executeInvoiceWorkflow(config, entityData);
          break;
        case 'customer_sync':
          result = await this.executeCustomerWorkflow(config, entityData);
          break;
        case 'item_sync':
          result = await this.executeItemWorkflow(config, entityData);
          break;
        case 'credit_note_sync':
          result = await this.executeCreditNoteWorkflow(config, entityData);
          break;
        case 'sales_sync':
          result = await this.executeSalesWorkflow(config, entityData);
          break;
      }
      
      // 4. Update execution log
      await this.updateExecution(execution.id, 'completed', result);
      
      return result;
    } catch (error) {
      // 5. Handle failure
      await this.handleWorkflowFailure(execution, error);
      throw error;
    }
  }
  
  /**
   * Execute invoice workflow
   */
  private async executeInvoiceWorkflow(
    config: EtimsWorkflowConfig,
    invoiceData: any
  ): Promise<WorkflowExecutionResult> {
    // 1. Transform QuickBooks invoice to e-TIMS format
    const etimsInvoice = await this.transformer.transformInvoiceToEtims(invoiceData);
    
    // 2. Submit to e-TIMS API
    const etimsResponse = await this.etimsApi.submitInvoice(etimsInvoice);
    
    // 3. Store e-TIMS transaction
    const etimsTransaction = await this.createEtimsTransaction({
      entityType: 'invoice',
      entityId: invoiceData.id,
      etimsInvoiceNumber: etimsResponse.invoiceNumber,
      qrCode: etimsResponse.qrCode,
      status: 'synced'
    });
    
    // 4. Download ETR receipt
    const etrReceipt = await this.etimsApi.getETRReceipt(etimsResponse.invoiceNumber);
    
    // 5. Sync ETR receipt back to QuickBooks as attachment
    if (config.config.syncETRReceipt) {
      await this.etrReceiptHandler.syncReceiptToQuickBooks(
        invoiceData.bookId,
        etrReceipt,
        etimsTransaction
      );
    }
    
    return {
      success: true,
      etimsTransactionId: etimsTransaction.id,
      etimsInvoiceNumber: etimsResponse.invoiceNumber
    };
  }
  
  /**
   * Execute customer workflow
   */
  private async executeCustomerWorkflow(
    config: EtimsWorkflowConfig,
    customerData: any
  ): Promise<WorkflowExecutionResult> {
    // 1. Check if customer has KRA PIN
    if (!customerData.taxId || !this.isKraPin(customerData.taxId)) {
      return { skipped: true, reason: 'Customer does not have KRA PIN' };
    }
    
    // 2. Validate PIN if configured
    if (config.config.validatePIN) {
      const isValid = await this.etimsApi.validatePIN(customerData.taxId);
      if (!isValid) {
        throw new Error('Invalid KRA PIN');
      }
    }
    
    // 3. Transform customer to e-TIMS format
    const etimsCustomer = await this.transformer.transformCustomerToEtims(customerData);
    
    // 4. Submit to e-TIMS API
    const etimsResponse = await this.etimsApi.createCustomer(etimsCustomer);
    
    // 5. Store e-TIMS transaction
    const etimsTransaction = await this.createEtimsTransaction({
      entityType: 'customer',
      entityId: customerData.id,
      etimsCustomerId: etimsResponse.customerId,
      status: 'synced'
    });
    
    return {
      success: true,
      etimsTransactionId: etimsTransaction.id,
      etimsCustomerId: etimsResponse.customerId
    };
  }
  
  // Similar methods for item, credit note, and sales workflows...
}
```

---

### 2. e-TIMS API Client

```typescript
@Injectable()
export class EtimsApiClient {
  
  /**
   * Authenticate with e-TIMS
   */
  async authenticate(credentials: EtimsCredentials): Promise<string> {
    // Implement OSCU authentication
    // Return access token
  }
  
  /**
   * Submit invoice to e-TIMS
   */
  async submitInvoice(invoice: EtimsInvoice): Promise<EtimsInvoiceResponse> {
    // Transform to OSCU format
    // Submit via OSCU API
    // Return response with invoice number and QR code
  }
  
  /**
   * Create customer in e-TIMS
   */
  async createCustomer(customer: EtimsCustomer): Promise<EtimsCustomerResponse> {
    // Submit customer data
    // Return customer ID
  }
  
  /**
   * Create item in e-TIMS
   */
  async createItem(item: EtimsItem): Promise<EtimsItemResponse> {
    // Submit item data
    // Return item code
  }
  
  /**
   * Submit credit note to e-TIMS
   */
  async submitCreditNote(creditNote: EtimsCreditNote): Promise<EtimsCreditNoteResponse> {
    // Submit credit note
    // Return receipt
  }
  
  /**
   * Get ETR receipt
   */
  async getETRReceipt(invoiceNumber: string): Promise<Buffer> {
    // Download ETR receipt PDF
    // Return PDF buffer
  }
  
  /**
   * Validate KRA PIN
   */
  async validatePIN(pin: string): Promise<boolean> {
    // Validate PIN with KRA
    // Return validation result
  }
}
```

---

### 3. ETR Receipt Handler

```typescript
@Injectable()
export class EtrReceiptHandlerService {
  
  /**
   * Sync ETR receipt to QuickBooks as attachment
   */
  async syncReceiptToQuickBooks(
    invoiceBookId: string,
    etrReceipt: Buffer,
    etimsTransaction: EtimsTransaction
  ): Promise<void> {
    // 1. Create attachment entity
    const attachment = new Attachment({
      filename: `ETR-${etimsTransaction.etimsInvoiceNumber}.pdf`,
      fileType: 'application/pdf',
      fileData: etrReceipt,
      entityId: invoiceBookId,
      entityType: AttachmentCategory.INVOICE,
      note: `ETR Receipt - Invoice ${etimsTransaction.etimsInvoiceNumber}`
    });
    
    // 2. Use existing attachment service to sync
    await this.attachmentService.createAndSyncAttachment(
      attachment,
      etimsTransaction.connectionId,
      invoiceBookId
    );
    
    // 3. Update e-TIMS transaction with attachment info
    await this.etimsTransactionRepository.update(etimsTransaction.id, {
      etrReceiptUrl: attachment.fileUrl,
      etrReceiptPdf: etrReceipt
    });
  }
}
```

---

## Part 6: Event Integration

### Webhook/Event Listeners

```typescript
@Injectable()
export class EtimsEventListenerService {
  
  /**
   * Listen to QuickBooks invoice webhooks
   */
  @OnEvent('quickbooks.invoice.created')
  async handleInvoiceCreated(event: InvoiceCreatedEvent) {
    const connection = await this.getConnection(event.connectionId);
    
    // Check if invoice workflow is enabled
    const config = await this.getWorkflowConfig(
      connection.id,
      'invoice_sync'
    );
    
    if (config && config.enabled && config.autoSync) {
      await this.workflowService.executeWorkflow(
        connection.id,
        'invoice_sync',
        'invoice',
        event.invoiceId,
        event.invoiceData
      );
    }
  }
  
  /**
   * Listen to customer created events
   */
  @OnEvent('customer.created')
  async handleCustomerCreated(event: CustomerCreatedEvent) {
    const connection = await this.getConnection(event.connectionId);
    
    const config = await this.getWorkflowConfig(
      connection.id,
      'customer_sync'
    );
    
    if (config && config.enabled && config.autoSync) {
      // Check if customer has KRA PIN
      if (event.customerData.taxId && this.isKraPin(event.customerData.taxId)) {
        await this.workflowService.executeWorkflow(
          connection.id,
          'customer_sync',
          'customer',
          event.customerId,
          event.customerData
        );
      }
    }
  }
  
  // Similar handlers for items, credit notes, and sales...
}
```

---

## Part 7: API Endpoints

### Workflow Configuration API

```typescript
@Controller('connections/:connectionId/etims/workflows')
export class EtimsWorkflowController {
  
  /**
   * Get all workflow configurations
   */
  @Get()
  async getWorkflows(@Param('connectionId') connectionId: string) {
    return this.workflowService.getWorkflowConfigs(connectionId);
  }
  
  /**
   * Configure a workflow
   */
  @Post(':workflowType')
  async configureWorkflow(
    @Param('connectionId') connectionId: string,
    @Param('workflowType') workflowType: WorkflowType,
    @Body() dto: ConfigureWorkflowDto
  ) {
    return this.workflowService.configureWorkflow(connectionId, workflowType, dto);
  }
  
  /**
   * Enable/disable workflow
   */
  @Patch(':workflowType/enable')
  async toggleWorkflow(
    @Param('connectionId') connectionId: string,
    @Param('workflowType') workflowType: WorkflowType,
    @Body() dto: { enabled: boolean }
  ) {
    return this.workflowService.toggleWorkflow(connectionId, workflowType, dto.enabled);
  }
  
  /**
   * Manually trigger workflow
   */
  @Post(':workflowType/execute')
  async executeWorkflow(
    @Param('connectionId') connectionId: string,
    @Param('workflowType') workflowType: WorkflowType,
    @Body() dto: { entityType: string; entityId: string }
  ) {
    return this.workflowService.executeWorkflow(
      connectionId,
      workflowType,
      dto.entityType,
      dto.entityId,
      null // Will fetch entity data
    );
  }
}
```

---

### e-TIMS Transaction API

```typescript
@Controller('connections/:connectionId/etims/transactions')
export class EtimsTransactionController {
  
  /**
   * Get e-TIMS transactions
   */
  @Get()
  async getTransactions(
    @Param('connectionId') connectionId: string,
    @Query() query: { entityType?: string; status?: string }
  ) {
    return this.etimsTransactionService.getTransactions(connectionId, query);
  }
  
  /**
   * Get ETR receipt
   */
  @Get(':transactionId/receipt')
  async getETRReceipt(
    @Param('connectionId') connectionId: string,
    @Param('transactionId') transactionId: string
  ) {
    const transaction = await this.etimsTransactionService.getTransaction(transactionId);
    return {
      pdf: transaction.etrReceiptPdf,
      url: transaction.etrReceiptUrl,
      qrCode: transaction.qrCode
    };
  }
  
  /**
   * Retry failed transaction
   */
  @Post(':transactionId/retry')
  async retryTransaction(
    @Param('connectionId') connectionId: string,
    @Param('transactionId') transactionId: string
  ) {
    return this.workflowService.retryTransaction(transactionId);
  }
}
```

---

## Part 8: Configuration Examples

### Example 1: Enable Invoice Workflow

```bash
POST /connections/{connectionId}/etims/workflows/invoice_sync
{
  "enabled": true,
  "autoSync": true,
  "config": {
    "retryOnFailure": true,
    "maxRetries": 3,
    "notifyOnFailure": true,
    "syncETRReceipt": true
  }
}
```

### Example 2: Enable Customer Sync (Only with KRA PIN)

```bash
POST /connections/{connectionId}/etims/workflows/customer_sync
{
  "enabled": true,
  "autoSync": true,
  "config": {
    "validatePIN": true,
    "syncOnUpdate": false,
    "batchSync": false
  }
}
```

### Example 3: Enable Sales Sync (Premium Service Level Only)

```bash
POST /connections/{connectionId}/etims/workflows/sales_sync
{
  "enabled": true,
  "autoSync": true,
  "config": {
    "serviceLevels": ["premium", "enterprise"],
    "taxThreshold": 0,
    "transactionTypes": ["invoice", "sales_receipt"],
    "customerTypes": ["B2B", "B2C"]
  }
}
```

---

## Part 9: Error Handling & Retry Logic

### Retry Strategy

```typescript
async executeWorkflowWithRetry(
  workflowType: WorkflowType,
  entityData: any,
  maxRetries: number = 3
): Promise<WorkflowExecutionResult> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.executeWorkflow(workflowType, entityData);
    } catch (error) {
      lastError = error;
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      await this.sleep(delay);
      
      // Log retry attempt
      this.logger.warn(`Workflow retry attempt ${attempt}/${maxRetries}`, {
        workflowType,
        error: error.message
      });
    }
  }
  
  throw new Error(`Workflow failed after ${maxRetries} attempts: ${lastError.message}`);
}
```

---

## Part 10: Integration with Existing System

### Leveraging Existing Infrastructure

1. **Webhook System**: Use existing webhook infrastructure to listen to QuickBooks events
2. **Sync System**: Extend sync handlers to include e-TIMS workflows
3. **Attachment System**: Use existing attachment service to sync ETR receipts
4. **Connection System**: Use existing connection management for e-TIMS credentials

### New Components Needed

1. **e-TIMS API Client**: New service for e-TIMS API integration
2. **Workflow Engine**: New service for workflow execution
3. **Workflow Configuration**: New tables and services for configuration
4. **e-TIMS Transformers**: Services to transform QuickBooks data to e-TIMS format

---

## Part 11: Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- e-TIMS API client
- Authentication service
- Basic workflow engine
- Database schema

### Phase 2: Core Workflows (Weeks 3-4)
- Invoice workflow
- Customer workflow
- ETR receipt handler
- Attachment sync

### Phase 3: Advanced Workflows (Weeks 5-6)
- Item workflow
- Credit note workflow
- Sales workflow
- Configuration API

### Phase 4: Enhancement (Weeks 7-8)
- Error handling & retry
- Monitoring & logging
- Dashboard & reporting
- Testing & documentation

---

## Conclusion

This workflow-based system provides:
- ✅ **Flexibility**: Businesses configure which workflows to enable
- ✅ **Automation**: Auto-sync based on events
- ✅ **Reliability**: Retry logic and error handling
- ✅ **Integration**: Seamless sync with QuickBooks
- ✅ **Compliance**: Full e-TIMS compliance

The system leverages existing infrastructure (webhooks, sync, attachments) while adding new e-TIMS-specific capabilities.
