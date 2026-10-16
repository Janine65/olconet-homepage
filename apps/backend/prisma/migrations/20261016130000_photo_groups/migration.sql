ALTER TABLE "MediaAsset" ADD COLUMN "parentId" UUID;
CREATE INDEX "MediaAsset_parentId_idx" ON "MediaAsset"("parentId");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_group_category_check"
  CHECK ("parentId" IS NULL OR ("category" <> 'TRAVEL' AND "parentId" <> "id"));
