import { departmentOptions, teamGroups } from '@/lib/departments';
import type { Department } from '@/lib/types';

/** The `<option>`s of a department picker: each department, then its teams under it as "Marketing › Content Team". */
export function DepartmentOptions({ departments }: { departments: Department[] }) {
  return departmentOptions(departments).map((o) => (
    <option key={o.id} value={o.id}>
      {o.label}
    </option>
  ));
}

/**
 * The choices of a team picker: each department as an `<optgroup>` with its teams (job titles belong to teams only).
 * Options show the team's own name, so typing it on a closed picker finds it.
 */
export function TeamOptions({ departments }: { departments: Department[] }) {
  return teamGroups(departments).map(({ department, teams }) => (
    <optgroup key={department.id} label={department.nameEn}>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.nameEn}
        </option>
      ))}
    </optgroup>
  ));
}
