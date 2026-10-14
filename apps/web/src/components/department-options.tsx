import { departmentOptions } from '@/lib/departments';
import type { Department } from '@/lib/types';

/** The `<option>`s of a department picker: each department, then its teams under it as "Marketing › Content Team". */
export function DepartmentOptions({ departments }: { departments: Department[] }) {
  return departmentOptions(departments).map((o) => (
    <option key={o.id} value={o.id}>
      {o.label}
    </option>
  ));
}
