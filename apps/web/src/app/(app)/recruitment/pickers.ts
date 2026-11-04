import 'server-only';
import { loadPickers } from '../employees/data';
import { shiftLabel } from '../employees/ui';
import { loadJson } from '../payroll/load';
import type { Option } from './vacancy-form';

// What the vacancy form's pickers list (recruitment, 22 October 2026): the job titles with their department or team, the
// grades the caller may give (no C-level one for HR: pickableGrades), the shifts and the current employees as hiring
// managers; the recruiters (3 November 2026: "A Recruiter field"): the current employees with an HR or Super Admin account.

export async function vacancyOptions(): Promise<{ jobTitles: Option[]; grades: Option[]; shifts: Option[]; managers: Option[]; recruiters: Option[] }> {
  const [p, recruiters] = await Promise.all([loadPickers(), loadJson<{ id: string; name: string }[]>('/recruitment/vacancies/recruiters')]);
  const departments = new Map(p.departments.map((d) => [d.id, d]));
  const place = (departmentId: string) => {
    const d = departments.get(departmentId);
    if (!d) return '';
    const parent = d.parentId ? departments.get(d.parentId) : null;
    return parent ? `${parent.nameEn} · ${d.nameEn}` : d.nameEn;
  };
  return {
    jobTitles: [...p.jobTitles]
      .sort((a, b) => a.titleEn.localeCompare(b.titleEn))
      .map((j) => ({ id: j.id, label: [j.titleEn, place(j.departmentId)].filter(Boolean).join(' — ') })),
    grades: p.grades.map((g) => ({ id: g.id, label: `${g.code} · ${g.levelEn}` })),
    shifts: p.shifts.map((s) => ({ id: s.id, label: shiftLabel(s) })),
    managers: p.managers
      .filter((m) => m.standing !== 'former' && m.standing !== 'not_employed')
      .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn))
      .map((m) => ({ id: m.id, label: m.fullNameEn })),
    // none listed when they couldn't be read: the vacancy keeps its recruiter (the creator on a new one)
    recruiters: recruiters.kind === 'ok' ? recruiters.value.map((r) => ({ id: r.id, label: r.name })) : [],
  };
}
