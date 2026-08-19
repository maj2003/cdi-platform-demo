-- AlterTable
ALTER TABLE "Part" ADD COLUMN "assemblyLevel" TEXT;

-- CreateTable
CREATE TABLE "PhotoLabel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "view" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhotoLabel_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PhotoLabel_partId_idx" ON "PhotoLabel"("partId");

-- CreateIndex
CREATE INDEX "PhotoLabel_label_idx" ON "PhotoLabel"("label");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoLabel_partId_label_key" ON "PhotoLabel"("partId", "label");
