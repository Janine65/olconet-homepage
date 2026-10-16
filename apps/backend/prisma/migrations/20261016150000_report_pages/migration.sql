CREATE TABLE "ReportPage" (
  "id" UUID NOT NULL,
  "reportId" UUID NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "contentHtml" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL,
  "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ReportPage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportPage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TravelReport"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportPage_id_reportId_key" ON "ReportPage"("id", "reportId");
CREATE INDEX "ReportPage_reportId_sortOrder_idx" ON "ReportPage"("reportId", "sortOrder");
INSERT INTO "ReportPage" ("id", "reportId", "contentHtml", "sortOrder", "status", "publishedAt")
  SELECT "id", "id", "contentHtml", 0, "status", "publishedAt" FROM "TravelReport";
ALTER TABLE "ReportImage" ADD COLUMN "pageId" UUID;
UPDATE "ReportImage" SET "pageId" = "reportId";
ALTER TABLE "ReportImage" ALTER COLUMN "pageId" SET NOT NULL;
ALTER TABLE "ReportImage" DROP CONSTRAINT "ReportImage_pkey";
ALTER TABLE "ReportImage" ADD CONSTRAINT "ReportImage_pkey" PRIMARY KEY ("pageId", "assetId");
CREATE INDEX "ReportImage_reportId_idx" ON "ReportImage"("reportId");
ALTER TABLE "ReportImage" ADD CONSTRAINT "ReportImage_pageId_reportId_fkey"
  FOREIGN KEY ("pageId", "reportId") REFERENCES "ReportPage"("id", "reportId") ON DELETE CASCADE ON UPDATE CASCADE;
