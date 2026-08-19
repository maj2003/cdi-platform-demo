-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubAssembly" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    CONSTRAINT "SubAssembly_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Part" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "subAssemblyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "material" TEXT,
    "finish" TEXT,
    "weightG" REAL,
    "lengthMm" REAL,
    "widthMm" REAL,
    "heightMm" REAL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Part_subAssemblyId_fkey" FOREIGN KEY ("subAssemblyId") REFERENCES "SubAssembly" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedBy" TEXT NOT NULL,
    "imageUrl" TEXT,
    CONSTRAINT "Measurement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partId" INTEGER NOT NULL,
    "materialCost" REAL NOT NULL DEFAULT 0,
    "processCost" REAL NOT NULL DEFAULT 0,
    "labourCost" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    CONSTRAINT "Cost_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "persona" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL,
    CONSTRAINT "Report_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_brand_name_key" ON "Product"("brand", "name");

-- CreateIndex
CREATE INDEX "SubAssembly_productId_idx" ON "SubAssembly"("productId");

-- CreateIndex
CREATE INDEX "Part_subAssemblyId_idx" ON "Part"("subAssemblyId");

-- CreateIndex
CREATE INDEX "Measurement_partId_idx" ON "Measurement"("partId");

-- CreateIndex
CREATE INDEX "Measurement_partId_type_idx" ON "Measurement"("partId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Cost_partId_key" ON "Cost"("partId");

-- CreateIndex
CREATE INDEX "Report_productId_persona_idx" ON "Report"("productId", "persona");
