-- Staff scheduling: shifts (who works when, in which position) and who is on the roster.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "on_roster" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "position" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_org_id_starts_at_idx" ON "shifts"("org_id", "starts_at");

-- CreateIndex
CREATE INDEX "shifts_org_id_user_id_starts_at_idx" ON "shifts"("org_id", "user_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_id_org_id_key" ON "shifts"("id", "org_id");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_org_id_fkey" FOREIGN KEY ("user_id", "org_id") REFERENCES "users"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_id_org_id_fkey" FOREIGN KEY ("created_by_id", "org_id") REFERENCES "users"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written CHECK constraints (Prisma's schema language can't express these).
-- ─────────────────────────────────────────────────────────────────────────────

-- A shift lasts between 15 minutes and 16 hours (the API gives friendlier messages first)
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_times_check"
  CHECK ("ends_at" - "starts_at" BETWEEN INTERVAL '15 minutes' AND INTERVAL '16 hours');
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_position_not_blank_check" CHECK (btrim("position") <> '');
