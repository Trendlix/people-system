-- The short name the employee goes by (e.g. Hazem Magdy), for the email signature; the full names stay as on the ID card.
ALTER TABLE "employees" ADD COLUMN "display_name" TEXT;
