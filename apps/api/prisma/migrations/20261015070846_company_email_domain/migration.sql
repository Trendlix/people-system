-- The domain every work email must use (e.g. trendlix.com), set on the company profile.
ALTER TABLE "company" ADD COLUMN "email_domain" TEXT;

-- Filled in from what the profile already says: the domain of the company email, or else the website's host
-- (without its scheme, "www." and path), in lower case. Neither set: no domain, so no check until HR sets one.
UPDATE "company"
SET "email_domain" = lower(coalesce(
  nullif(trim(split_part(trim("email"), '@', 2)), ''),
  nullif(regexp_replace(regexp_replace(trim("website"), '^[A-Za-z][A-Za-z0-9+.-]*://', ''), '^www\.|[/?#:].*$', '', 'gi'), '')
))
WHERE "id" = 1;
