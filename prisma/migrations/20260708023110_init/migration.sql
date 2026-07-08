-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conditionId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "priceToBeat" REAL NOT NULL,
    "openTime" DATETIME NOT NULL,
    "closeTime" DATETIME NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "confidence" REAL,
    "entryPrice" REAL,
    "entryCostUsd" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "won" BOOLEAN,
    "closedAt" DATETIME,
    "exitPrice" REAL,
    "realizedPnlUsd" REAL,
    "exitReason" TEXT,
    "result" TEXT,
    CONSTRAINT "Signal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "price" REAL,
    "quantity" REAL,
    "realizedPnlUsd" REAL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalEvent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rangeStart" DATETIME NOT NULL,
    "rangeEnd" DATETIME NOT NULL,
    "results" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_conditionId_key" ON "Market"("conditionId");

-- CreateIndex
CREATE INDEX "Market_openTime_idx" ON "Market"("openTime");

-- CreateIndex
CREATE INDEX "Signal_strategyId_idx" ON "Signal"("strategyId");

-- CreateIndex
CREATE INDEX "Signal_marketId_idx" ON "Signal"("marketId");

-- CreateIndex
CREATE INDEX "SignalEvent_signalId_idx" ON "SignalEvent"("signalId");

-- CreateIndex
CREATE INDEX "SignalEvent_eventType_idx" ON "SignalEvent"("eventType");
