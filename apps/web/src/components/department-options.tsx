import { departmentOptions, placeGroups } from '@/lib/departments';
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
 * The choices of a department-or-team picker, for where a job title or an employment is (a department itself, e.g. Head
 * of Marketing, or one of its teams): each department as an `<optgroup>`, with "Marketing (department)" first and then
 * its teams. Options show the team's own name, so typing it on a closed picker finds it.
 */
export function DepartmentOrTeamOptions({ departments }: { departments: Department[] }) {
  return placeGroups(departments).map((g) => (
    <optgroup key={g.id} label={g.label}>
      {g.options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </optgroup>
  ));
}
