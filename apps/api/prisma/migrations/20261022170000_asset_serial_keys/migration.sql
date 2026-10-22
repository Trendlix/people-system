-- One serial number, one item (owner, 22 October 2026: "same serial number shouldn't be added twice"). Each asset and
-- each accessory's line keeps its serial as serials are compared (packages/shared assetSerialKey: its compatibility
-- form, Arabic-Indic digits as 0-9, upper case, Latin letters and digits only), filled here for the serials kept
-- before. The API refuses a serial another asset, another asset's accessory or another open draft has, under a lock.
-- No unique index: serials kept twice before this rule (if any) would stop it being made; they stay until one changes.

ALTER TABLE "assets" ADD COLUMN "serial_key" TEXT;
ALTER TABLE "asset_accessories" ADD COLUMN "serial_key" TEXT;

UPDATE "assets"
SET "serial_key" = NULLIF(regexp_replace(upper(translate(normalize("serial", NFKC), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')), '[^A-Z0-9]', '', 'g'), '')
WHERE "serial" IS NOT NULL;

UPDATE "asset_accessories"
SET "serial_key" = NULLIF(regexp_replace(upper(translate(normalize("serial", NFKC), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')), '[^A-Z0-9]', '', 'g'), '')
WHERE "serial" IS NOT NULL;

CREATE INDEX "assets_serial_key_idx" ON "assets"("serial_key");
CREATE INDEX "asset_accessories_serial_key_idx" ON "asset_accessories"("serial_key");
