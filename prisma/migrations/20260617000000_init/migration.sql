-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
CREATE TYPE "OrderSyncStatus" AS ENUM ('PENDING', 'POSTED', 'ERROR');

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "scope" TEXT,
  "expires" TIMESTAMP(3),
  "accessToken" TEXT NOT NULL,
  "userId" BIGINT,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "accountOwner" BOOLEAN NOT NULL DEFAULT false,
  "locale" TEXT,
  "collaborator" BOOLEAN DEFAULT false,
  "emailVerified" BOOLEAN DEFAULT false,
  "refreshToken" TEXT,
  "refreshTokenExpires" TIMESTAMP(3),
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shop" (
  "id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "countryCode" TEXT NOT NULL DEFAULT 'NL',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "uninstalledAt" TIMESTAMP(3),
  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingSettings" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "bookkeepingStart" TIMESTAMP(3) NOT NULL,
  "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
  "lockedThrough" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerAccount" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "AccountType" NOT NULL,
  "systemKey" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxCode" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rate" DECIMAL(5,2) NOT NULL,
  "reportingBox" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderSnapshot" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopifyOrderId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL,
  "subtotalCents" BIGINT NOT NULL,
  "taxCents" BIGINT NOT NULL,
  "shippingCents" BIGINT NOT NULL,
  "discountCents" BIGINT NOT NULL,
  "grossCents" BIGINT NOT NULL,
  "refundCents" BIGINT NOT NULL DEFAULT 0,
  "refundTaxCents" BIGINT NOT NULL DEFAULT 0,
  "sourceHash" TEXT NOT NULL,
  "sourceJson" JSONB NOT NULL,
  "syncStatus" "OrderSyncStatus" NOT NULL DEFAULT 'PENDING',
  "syncError" TEXT,
  "activeJournalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payout" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopifyPayoutId" TEXT NOT NULL,
  "legacyResourceId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "transactionType" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "netCents" BIGINT NOT NULL,
  "feeCents" BIGINT NOT NULL,
  "clearingCents" BIGINT NOT NULL,
  "transactionAmountCents" BIGINT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "sourceJson" JSONB NOT NULL,
  "journalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "supplier" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "invoiceNumber" TEXT,
  "netCents" BIGINT NOT NULL,
  "vatCents" BIGINT NOT NULL,
  "totalCents" BIGINT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "entryNumber" INTEGER NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
  "warning" TEXT,
  "postedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  "reversalOfId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "debitCents" BIGINT NOT NULL DEFAULT 0,
  "creditCents" BIGINT NOT NULL DEFAULT 0,
  "memo" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "shopDomain" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportRun" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncError" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SyncError_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");
CREATE UNIQUE INDEX "AccountingSettings_shopId_key" ON "AccountingSettings"("shopId");
CREATE UNIQUE INDEX "LedgerAccount_shopId_code_key" ON "LedgerAccount"("shopId", "code");
CREATE UNIQUE INDEX "LedgerAccount_shopId_systemKey_key" ON "LedgerAccount"("shopId", "systemKey");
CREATE INDEX "LedgerAccount_shopId_type_idx" ON "LedgerAccount"("shopId", "type");
CREATE UNIQUE INDEX "TaxCode_shopId_code_key" ON "TaxCode"("shopId", "code");
CREATE UNIQUE INDEX "OrderSnapshot_activeJournalEntryId_key" ON "OrderSnapshot"("activeJournalEntryId");
CREATE UNIQUE INDEX "OrderSnapshot_shopId_shopifyOrderId_key" ON "OrderSnapshot"("shopId", "shopifyOrderId");
CREATE INDEX "OrderSnapshot_shopId_processedAt_idx" ON "OrderSnapshot"("shopId", "processedAt");
CREATE UNIQUE INDEX "Payout_journalEntryId_key" ON "Payout"("journalEntryId");
CREATE UNIQUE INDEX "Payout_shopId_shopifyPayoutId_key" ON "Payout"("shopId", "shopifyPayoutId");
CREATE INDEX "Payout_shopId_issuedAt_idx" ON "Payout"("shopId", "issuedAt");
CREATE UNIQUE INDEX "Expense_journalEntryId_key" ON "Expense"("journalEntryId");
CREATE INDEX "Expense_shopId_date_idx" ON "Expense"("shopId", "date");
CREATE UNIQUE INDEX "JournalEntry_shopId_entryNumber_key" ON "JournalEntry"("shopId", "entryNumber");
CREATE INDEX "JournalEntry_shopId_date_idx" ON "JournalEntry"("shopId", "date");
CREATE INDEX "JournalEntry_shopId_sourceType_sourceId_idx" ON "JournalEntry"("shopId", "sourceType", "sourceId");
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");
CREATE INDEX "WebhookDelivery_shopDomain_receivedAt_idx" ON "WebhookDelivery"("shopDomain", "receivedAt");
CREATE INDEX "ImportRun_shopId_startedAt_idx" ON "ImportRun"("shopId", "startedAt");
CREATE INDEX "SyncError_shopId_resolvedAt_idx" ON "SyncError"("shopId", "resolvedAt");

ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "OrderSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "OrderSnapshot_activeJournalEntryId_fkey" FOREIGN KEY ("activeJournalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncError" ADD CONSTRAINT "SyncError_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
