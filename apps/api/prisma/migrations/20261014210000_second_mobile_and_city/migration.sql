-- A second mobile number, and the city or district (read from the ID card's address).
ALTER TABLE "employees" ADD COLUMN     "city" TEXT,
ADD COLUMN     "mobile2" TEXT;
