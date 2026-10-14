'use client';

import { useState } from 'react';
import { DEGREES, EDUCATION_GRADES, GENDERS, GOVERNORATES, LABELS, MARITAL_STATUSES, MILITARY_STATUSES } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, FormState } from '@/lib/types';
import { cardMarks, type CardSuggestions } from './id-card';

// The profile fields (personal, contact and address, emergency contact, education), used by the Add employee page
// (the profile, then education, as two steps) and the Personal Details and Education edit pages.

type Option = { value: string; label: string };

/** Personal, contact and emergency contact (`profile`), or `education`. */
export type Part = 'profile' | 'education';

type Field = {
  name: keyof EmployeeProfile & string;
  label: string;
  kind?: 'text' | 'email' | 'tel' | 'date' | 'year' | 'select';
  max?: number;
  ar?: boolean;
  multiline?: boolean;
  required?: boolean;
  hint?: React.ReactNode;
  placeholder?: string;
  options?: readonly Option[];
  /** Takes the whole row on wide screens. */
  wide?: boolean;
};

const options = <T extends string>(values: readonly T[], labels: Record<T, string>): Option[] => values.map((v) => ({ value: v, label: labels[v] }));

const GROUPS: { title: string; part: Part; fields: Field[] }[] = [
  {
    title: 'Personal',
    part: 'profile',
    fields: [
      { name: 'fullNameEn', label: 'Full name (English)', max: 150, required: true },
      { name: 'fullNameAr', label: 'Full name (Arabic)', ar: true, max: 150, required: true, hint: 'As printed on contracts.' },
      { name: 'employeeCode', label: 'Employee code', max: 20, required: true, placeholder: 'EMP-0000' },
      { name: 'dateOfBirth', label: 'Date of birth', kind: 'date' },
      { name: 'gender', label: 'Gender', kind: 'select', options: options(GENDERS, LABELS.gender) },
      { name: 'nationality', label: 'Nationality', max: 60, placeholder: 'e.g. Egyptian' },
      { name: 'maritalStatus', label: 'Marital status', kind: 'select', options: options(MARITAL_STATUSES, LABELS.maritalStatus) },
      { name: 'militaryStatus', label: 'Military status', kind: 'select', options: options(MILITARY_STATUSES, LABELS.militaryStatus) },
    ],
  },
  {
    title: 'Contact & Address',
    part: 'profile',
    fields: [
      {
        name: 'workEmail',
        label: 'Work email',
        kind: 'email',
        max: 254,
        hint: 'A sign-in account with this email is linked to this employee.',
      },
      { name: 'personalEmail', label: 'Personal email', kind: 'email', max: 254 },
      { name: 'mobile', label: 'Mobile', kind: 'tel', max: 30 },
      { name: 'mobile2', label: 'Second mobile', kind: 'tel', max: 30 },
      { name: 'governorate', label: 'Governorate', kind: 'select', options: GOVERNORATES.map((g) => ({ value: g, label: g })) },
      {
        name: 'city',
        label: 'City',
        ar: true,
        max: 100,
        hint: (
          <>
            As on the ID card, e.g. <span lang="ar">مدينة نصر</span>.
          </>
        ),
      },
      { name: 'addressAr', label: 'Address (Arabic)', ar: true, multiline: true, max: 300, wide: true, hint: 'As printed on contracts.' },
    ],
  },
  {
    title: 'Emergency Contact',
    part: 'profile',
    fields: [
      { name: 'emergencyName', label: 'Name', max: 150 },
      { name: 'emergencyRelation', label: 'Relation', max: 50, placeholder: 'e.g. Sister' },
      { name: 'emergencyMobile', label: 'Mobile', kind: 'tel', max: 30 },
    ],
  },
  {
    title: 'Education',
    part: 'education',
    fields: [
      { name: 'university', label: 'University', max: 150 },
      { name: 'faculty', label: 'Faculty', max: 150 },
      { name: 'degree', label: 'Degree', kind: 'select', options: options(DEGREES, LABELS.degree) },
      { name: 'major', label: 'Major', max: 150 },
      { name: 'graduationYear', label: 'Graduation year', kind: 'year' },
      { name: 'educationGrade', label: 'Grade', kind: 'select', options: options(EDUCATION_GRADES, LABELS.educationGrade) },
      { name: 'qualificationAr', label: 'Qualification (Arabic)', ar: true, max: 200, wide: true, hint: 'As printed on contracts.' },
    ],
  },
];

/** A new employee's code may be left empty: the API gives the next number. */
const NEW_CODE: Partial<Field> = { required: false, hint: 'Leave empty to give the next number automatically.' };

/** The value a field starts with, as the field shows it (dates as DD/MM/YYYY, numbers as text): saved, or read from the card. */
function startText(f: Field, employee?: EmployeeProfile, card?: CardSuggestions): string {
  const v = employee ? employee[f.name] : card?.[f.name as keyof CardSuggestions];
  if (f.kind === 'date') return formatDate(typeof v === 'string' ? v : null);
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' ? v : '';
}

/**
 * The profile fields, in their groups. They start with the saved `employee`, or, for a new employee, with what the ID
 * card says (`suggestions`, marked for checking; `corrected`: those a fix learned from HR's earlier corrections changed).
 */
export function PersonalFields({
  state,
  fid,
  employee,
  suggestions,
  corrected,
  part,
}: {
  state: FormState;
  fid: (name: string) => string;
  employee?: EmployeeProfile;
  suggestions?: CardSuggestions;
  corrected?: readonly string[];
  /** Only these groups; all of them when left out. */
  part?: Part;
}) {
  const card = cardMarks(fid, suggestions, corrected);
  const [gender, setGender] = useState(() => valueOf(state, 'gender', employee?.gender ?? suggestions?.gender));
  // a woman's military status is always Not applicable: no military papers are needed (owner's rule)
  const noMilitary = (f: Field) => f.name === 'militaryStatus' && gender === 'female';
  const hintOf = (f: Field) => (noMilitary(f) ? 'Women need no military papers.' : f.hint);

  function control(f: Field) {
    const saved = startText(f, employee, suggestions);
    const id = fid(f.name);
    const describedBy = card.describedBy(f.name, hintOf(f) ? fid(`${f.name}-hint`) : undefined);
    const value = valueOf(state, f.name, saved);

    if (noMilitary(f)) {
      return (
        <>
          <input type="hidden" name={f.name} value="not_applicable" />
          <input id={id} value={LABELS.militaryStatus.not_applicable} readOnly aria-describedby={describedBy} className="input bg-canvas text-muted" />
        </>
      );
    }
    if (f.kind === 'date') return <DateInput id={id} name={f.name} aria-describedby={describedBy} defaultValue={value} />;
    if (f.kind === 'select') {
      // A stored value that is no longer in the list (e.g. imported) stays selectable, so saving doesn't clear it.
      const list = saved && !f.options?.some((o) => o.value === saved) ? [...(f.options ?? []), { value: saved, label: saved }] : (f.options ?? []);
      return (
        <select
          id={id}
          name={f.name}
          aria-describedby={describedBy}
          defaultValue={value}
          onChange={f.name === 'gender' ? (e) => setGender(e.target.value) : undefined}
          className="input"
        >
          <option value="">Not set</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    const common = {
      id,
      name: f.name,
      required: f.required,
      maxLength: f.kind === 'year' ? 4 : f.max,
      placeholder: f.kind === 'year' ? 'e.g. 2016' : f.placeholder,
      'aria-describedby': describedBy,
      defaultValue: value,
      className: f.name === 'employeeCode' ? 'input uppercase' : 'input',
      ...(f.ar ? { lang: 'ar', dir: 'rtl' as const } : {}),
    };
    if (f.multiline) return <textarea rows={2} {...common} />;
    if (f.kind === 'year') return <input type="text" inputMode="numeric" autoComplete="off" {...common} />;
    return <input type={f.kind ?? 'text'} {...common} />;
  }

  return GROUPS.filter((group) => !part || group.part === part).map((group) => (
    <fieldset key={group.title} className="space-y-5">
      <legend className="font-semibold">{group.title}</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        {group.fields
          .map((f) => (!employee && f.name === 'employeeCode' ? { ...f, ...NEW_CODE } : f))
          .map((f) => (
            <div key={f.name} className={f.wide ? 'sm:col-span-2' : undefined}>
              <label htmlFor={fid(f.name)} className="label">
                {f.label}
              </label>
              {control(f)}
              {hintOf(f) && (
                <p id={fid(`${f.name}-hint`)} className="hint">
                  {hintOf(f)}
                </p>
              )}
              {card.note(f.name)}
            </div>
          ))}
      </div>
    </fieldset>
  ));
}
