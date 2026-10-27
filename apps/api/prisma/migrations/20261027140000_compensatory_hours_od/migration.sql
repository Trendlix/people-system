-- Compensatory days by the hour, the Compensatory Setup, and official duty on a rest day or an official holiday
-- (owner, 27 October 2026: "it should count in the compensatories", "Hours off for hours worked", "minimum working hours",
-- "up to 4 hours to be compensated by hours - minimum 6 hours can be compensated by a day").

-- part of a rest day worked: the hours worked and the hours off they earn (null: a whole day)
ALTER TABLE "compensatory_requests" ADD COLUMN "hours_worked" DECIMAL(4,2);
ALTER TABLE "compensatory_requests" ADD COLUMN "hours_off" DECIMAL(4,2);

-- the official duty it compensates, asked, decided and cancelled with it
ALTER TABLE "compensatory_requests" ADD COLUMN "od_request_id" UUID;
CREATE UNIQUE INDEX "compensatory_requests_od_request_id_key" ON "compensatory_requests"("od_request_id");
ALTER TABLE "compensatory_requests" ADD CONSTRAINT "compensatory_requests_od_request_id_fkey" FOREIGN KEY ("od_request_id") REFERENCES "od_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- the Compensatory Setup
ALTER TABLE "leave_settings" ADD COLUMN "compensatory_min_hours" DECIMAL(4,1) NOT NULL DEFAULT 2;
ALTER TABLE "leave_settings" ADD COLUMN "compensatory_hours_cap" DECIMAL(4,1) NOT NULL DEFAULT 4;
ALTER TABLE "leave_settings" ADD COLUMN "compensatory_full_day_hours" DECIMAL(4,1) NOT NULL DEFAULT 6;
ALTER TABLE "leave_settings" ADD COLUMN "compensatory_off_within_days" INTEGER;

-- a compensatory day's hours paid in cash: days to the hundredth
ALTER TABLE "payroll_adjustments" ALTER COLUMN "days" TYPE DECIMAL(5,2);
