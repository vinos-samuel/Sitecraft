-- Persist the scan-form / Places category on Lead so generate can pick the
-- dental Broadsheet shell after refresh, even when the clinic name has no
-- "dental" in it. Nullable; existing rows stay unset and fall back to heuristics.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "businessType" TEXT;
