ALTER TABLE "VisitorSession"
  ADD COLUMN "browser" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "country" CHAR(2),
  ADD COLUMN "device" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX "VisitorSession_createdAt_idx" ON "VisitorSession"("createdAt");

CREATE TABLE "VisitorPageView" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "path" VARCHAR(256) NOT NULL,
  "enteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "durationSeconds" INTEGER,
  CONSTRAINT "VisitorPageView_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VisitorPageView"
  ADD CONSTRAINT "VisitorPageView_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "VisitorPageView_sessionId_enteredAt_idx"
  ON "VisitorPageView"("sessionId", "enteredAt");
CREATE INDEX "VisitorPageView_enteredAt_idx" ON "VisitorPageView"("enteredAt");
