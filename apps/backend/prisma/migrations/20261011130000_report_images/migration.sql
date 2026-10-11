ALTER TABLE "MediaAsset" ADD COLUMN "uploadFingerprint" TEXT, ADD COLUMN "uploadKey" UUID;
CREATE UNIQUE INDEX "MediaAsset_uploadKey_key" ON "MediaAsset"("uploadKey");
ALTER TABLE "ReportImage" ADD COLUMN "caption" TEXT, ADD COLUMN "inGallery" BOOLEAN NOT NULL DEFAULT true;
