-- Work arrangements for field work (owner, 15 October 2026): outdoor (shoots, sales visits …) and indoor and outdoor
-- (part at the office, part in the field), beside the office, working from home and hybrid.
ALTER TYPE "work_arrangement" ADD VALUE IF NOT EXISTS 'outdoor';
ALTER TYPE "work_arrangement" ADD VALUE IF NOT EXISTS 'indoor_outdoor';
