import 'server-only';
import type { StaffingUnitView } from '@trendlix/shared';
import { loadJson, type Loaded } from '../../payroll/load';

// Organization → Leave → Staffing (owner, 25 October 2026: "Warn and need HR"): every department and its teams, with
// their people now and their limits. An API from before it answers 404: "not available yet".

/** GET /leave/staffing: for HR, the CEO, Finance and Admins (a Super Admin too). */
export function loadStaffing(): Promise<Loaded<StaffingUnitView[]>> {
  return loadJson<StaffingUnitView[]>('/leave/staffing');
}
