-- Alert rules gain a stable per-organization code (plus an optional description),
-- so an industry pack can install its rules idempotently and find them again on a
-- later version. The table is empty in every environment: alerts are built in
-- Sprint 7, and nothing has written a rule yet.

-- AlterTable
ALTER TABLE "alert_rules" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "description" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_organizationId_code_key" ON "alert_rules"("organizationId", "code");
