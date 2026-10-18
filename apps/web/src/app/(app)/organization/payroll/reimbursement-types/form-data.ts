import 'server-only';
import type { Department, Grade } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { gradeLabel } from '../../../employees/ui';
import type { DepartmentChoice } from '../reimbursement-type-form';
import { departmentChoices } from '../reimbursement-types';

/**
 * What the type form offers for who may claim it: the departments with their teams, and the grades (lowest first, "G4 ·
 * Senior"); each null when it couldn't be read, which the form says in its place.
 */
export async function whoChoices(): Promise<{ departments: DepartmentChoice[] | null; grades: { id: string; label: string }[] | null }> {
  const [departments, grades] = await Promise.all([getOrNull<Department[]>('/departments'), getOrNull<Grade[]>('/grades')]);
  return {
    departments: departments && departmentChoices(departments),
    grades: grades && [...grades].sort((a, b) => a.rank - b.rank).map((g) => ({ id: g.id, label: gradeLabel(g) })),
  };
}
