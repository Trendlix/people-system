-- A contract's or an offer's own amount per client account (owner, 27 October 2026: "why cant i add rate per account?";
-- he chose "On the contract"): on its per-account allowance row, paid for every account held in place of each
-- assignment's amount; null keeps each assignment's.
ALTER TABLE "contract_allowances" ADD COLUMN "per_account_amount" DECIMAL(12,2);
ALTER TABLE "offer_allowances" ADD COLUMN "per_account_amount" DECIMAL(12,2);
