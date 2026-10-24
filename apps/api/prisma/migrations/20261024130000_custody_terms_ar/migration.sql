-- The custody form in Arabic and English side by side (owner, 24 October 2026: "i want to generate custodty form to be
-- sign by the employee and the HR with the recived goods"; asked, "Arabic and English" and "Employee and HR only";
-- packages/shared custody.ts). Written by hand.

-- 1. The Arabic terms printed beside the English ones, as an Assets manager writes them in Assets → Setup → Settings;
--    none: the standard Arabic wording (CUSTODY_TERMS_STANDARD_AR) while the English terms are the standard ones, else
--    the forms print the English terms alone.
ALTER TABLE "asset_settings" ADD COLUMN "custody_terms_ar" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 2. Each record keeps the Arabic terms it was printed with, as it keeps the English. The records made before this have
--    none: their form prints the standard Arabic wording when their English terms are the standard ones, said so on the
--    form, else the English terms alone.
ALTER TABLE "custody_records" ADD COLUMN "terms_ar" TEXT[] DEFAULT ARRAY[]::TEXT[];
