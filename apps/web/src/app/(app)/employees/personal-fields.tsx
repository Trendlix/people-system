'use client';

import { useState } from 'react';
import {
  DEGREES,
  EDUCATION_GRADES,
  FACULTIES,
  GENDERS,
  GOVERNORATES,
  LABELS,
  MARITAL_STATUSES,
  MILITARY_STATUSES,
  STUDY_YEAR_LABELS,
  STUDY_YEARS,
  studentQualificationAr,
  UNIVERSITIES,
  UNIVERSITY_KIND_LABELS,
  UNIVERSITY_KINDS,
} from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { ListOrOther, type ListGroup } from '@/components/list-or-other';
import { valueOf } from '@/components/form';
import { PhoneInput } from '@/components/phone-input';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, FormState } from '@/lib/types';
import { cardMarks, type CardSuggestions } from './id-card';
import { proposeQualification, type Education } from './qualification';
import { monthValue } from './student';

// The profile fields (personal, contact and address, emergency contact, education), used by the Add employee page
// (the profile, then education, as two steps) and the Personal Details and Education edit pages.

type Option = { value: string; label: string };

/** Personal, contact and emergency contact (`profile`), or `education`. */
export type Part = 'profile' | 'education';

type Field = {
  name: keyof EmployeeProfile & string;
  label: string;
  /**
   * `tel`: a country code and a number (PhoneInput). `list`: a standard list with Other (ListOrOther). `switch`: on or
   * off, sent as true or false. `month`: a month (YYYY-MM).
   */
  kind?: 'text' | 'email' | 'tel' | 'date' | 'year' | 'select' | 'list' | 'switch' | 'month';
  max?: number;
  ar?: boolean;
  multiline?: boolean;
  required?: boolean;
  hint?: React.ReactNode;
  placeholder?: string;
  options?: readonly Option[];
  /** For `list`: the choices, and the other ways a value on file may be written. */
  list?: { groups: readonly ListGroup[]; aliases: ReadonlyMap<string, string> };
  /** Takes the whole row on wide screens. */
  wide?: boolean;
  /** Only while Still studying is on (a student: owner, 25 October 2026). */
  student?: boolean;
};

const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

const options = <T extends string>(values: readonly T[], labels: Record<T, string>): Option[] => values.map((v) => ({ value: v, label: labels[v] }));

// The universities, by kind, and the faculties (packages/shared education.ts), so that the same one is always written
// the same way. Kept in English; the Arabic name is shown beside it, and a value saved in Arabic is recognised.
const bilingual = (x: { en: string; ar: string }) => ({ value: x.en, label: `${x.en} · ${x.ar}` });
const UNIVERSITY_LIST = {
  groups: UNIVERSITY_KINDS.map((k) => ({ label: UNIVERSITY_KIND_LABELS[k], choices: UNIVERSITIES.filter((u) => u.kind === k).map(bilingual) })),
  aliases: new Map(UNIVERSITIES.flatMap((u) => [[u.ar, u.en], [u.en.toLowerCase(), u.en]] as const)),
};
const FACULTY_LIST = {
  groups: [{ choices: FACULTIES.map(bilingual) }],
  aliases: new Map(
    FACULTIES.flatMap(
      (f) => [[f.ar, f.en], [`كلية ${f.ar}`, f.en], [f.en.toLowerCase(), f.en], [`faculty of ${f.en.toLowerCase()}`, f.en]] as const,
    ),
  ),
};

const GROUPS: { title: string; part: Part; fields: Field[] }[] = [
  {
    title: 'Personal',
    part: 'profile',
    fields: [
      { name: 'fullNameEn', label: 'Full name (English)', max: 150, required: true },
      { name: 'fullNameAr', label: 'Full name (Arabic)', ar: true, max: 150, required: true, hint: 'As printed on contracts.' },
      { name: 'displayName', label: 'Display name', max: 80, placeholder: 'e.g. Hazem Magdy', hint: 'The short name they go by, as shown in the email signature.' },
      { name: 'employeeCode', label: 'Employee code', max: 20, required: true, placeholder: 'EMP-0000' },
      {
        name: 'insuranceNo',
        label: 'Social insurance number',
        max: 20,
        hint: (
          <>
            The <span lang="ar">الرقم التأميني</span>, digits only, as on the social insurance print.
          </>
        ),
      },
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
      { name: 'mobile', label: 'Mobile', kind: 'tel', hint: 'The number without the 0 in front.' },
      { name: 'mobile2', label: 'Second mobile', kind: 'tel', hint: 'The number without the 0 in front.' },
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
      // asked for apart from the address on social insurance Form 1 (owner, 15 October 2026)
      {
        name: 'buildingNo',
        label: 'Building number',
        max: 10,
        placeholder: 'e.g. 12',
        hint: (
          <>
            Printed as <span lang="ar">عقار رقم</span> on social insurance Form 1.
          </>
        ),
      },
    ],
  },
  {
    title: 'Emergency Contact',
    part: 'profile',
    fields: [
      { name: 'emergencyName', label: 'Name', max: 150 },
      { name: 'emergencyRelation', label: 'Relation', max: 50, placeholder: 'e.g. Sister' },
      { name: 'emergencyMobile', label: 'Mobile', kind: 'tel', hint: 'The number without the 0 in front.' },
    ],
  },
  {
    title: 'Education',
    part: 'education',
    fields: [
      // a student (owner, 25 October 2026: "Add a Student option"): the year and the expected graduation instead of a
      // degree, a major, a graduation year and a grade; contracts print the student's wording while Qualification
      // (Arabic) is empty
      {
        name: 'stillStudying',
        label: 'Still studying',
        kind: 'switch',
        wide: true,
        hint: 'A student is asked the year and the expected graduation, not a degree, major, graduation year or grade.',
      },
      {
        name: 'studyYear',
        label: 'Study year',
        kind: 'select',
        options: options(STUDY_YEARS, STUDY_YEAR_LABELS),
        student: true,
        hint: (
          <>
            The <span lang="ar">الفرقة</span>, or the postgraduate study.
          </>
        ),
      },
      {
        name: 'expectedGraduation',
        label: 'Expected graduation',
        kind: 'month',
        student: true,
        hint: 'The month, e.g. 06/2027. Once it has passed, Missing Details asks HR to update the qualification.',
      },
      { name: 'university', label: 'University', kind: 'list', list: UNIVERSITY_LIST, max: 150, hint: 'Not on the list? Choose Other and type it.' },
      { name: 'faculty', label: 'Faculty', kind: 'list', list: FACULTY_LIST, max: 150, hint: 'The subject, without "Faculty of". Not on the list? Choose Other.' },
      { name: 'degree', label: 'Degree', kind: 'select', options: options(DEGREES, LABELS.degree) },
      { name: 'major', label: 'Major', max: 150 },
      { name: 'graduationYear', label: 'Graduation year', kind: 'year' },
      { name: 'educationGrade', label: 'Grade', kind: 'select', options: options(EDUCATION_GRADES, LABELS.educationGrade) },
      { name: 'qualificationAr', label: 'Qualification (Arabic)', ar: true, max: 200, wide: true, hint: 'As printed on contracts.' },
    ],
  },
];

/** The education fields the Arabic qualification is proposed from. */
const EDUCATION_KEYS: readonly string[] = ['degree', 'faculty', 'major', 'university'] satisfies (keyof Education)[];

/** "the major", "the major and the university" … */
const named = (things: readonly string[]) =>
  things.map((t) => `the ${t}`).reduce((all, t, i, list) => (i === 0 ? t : `${all}${i === list.length - 1 ? ' and ' : ', '}${t}`), '');

/** A new employee's code may be left empty: the API gives the next number. */
const NEW_CODE: Partial<Field> = { required: false, hint: 'Leave empty to give the next number automatically.' };

/** With the company's work email domain set (e.g. trendlix.com), every work email must end in it; the API checks this. */
const inDomain = (domain: string): Partial<Field> => ({
  placeholder: `name@${domain}`,
  hint: `Must end in @${domain}. A sign-in account with this email is linked to this employee.`,
});

/** The value a field starts with, as the field shows it (dates as DD/MM/YYYY, numbers as text): saved, or read from the card. */
function startText(f: Field, employee?: EmployeeProfile, card?: CardSuggestions): string {
  const v = employee ? employee[f.name] : card?.[f.name as keyof CardSuggestions];
  if (f.kind === 'date') return formatDate(typeof v === 'string' ? v : null);
  if (f.kind === 'month') return monthValue(typeof v === 'string' ? v : null);
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
  emailDomain,
}: {
  state: FormState;
  fid: (name: string) => string;
  employee?: EmployeeProfile;
  suggestions?: CardSuggestions;
  corrected?: readonly string[];
  /** Only these groups; all of them when left out. */
  part?: Part;
  /** The company's work email domain (e.g. trendlix.com), which the work email must end in; null or left out when there is none. */
  emailDomain?: string | null;
}) {
  const card = cardMarks(fid, suggestions, corrected);
  const [gender, setGender] = useState(() => valueOf(state, 'gender', employee?.gender ?? suggestions?.gender));
  // a woman's military status is always Not applicable: no military papers are needed (owner's rule)
  const noMilitary = (f: Field) => f.name === 'militaryStatus' && gender === 'female';

  // The Arabic qualification is proposed from the degree, faculty, major and university as they are chosen. While the
  // field is empty it shows the proposal (and sends it); once typed in, or saved, it is kept, with the proposal beside it.
  const [edu, setEdu] = useState<Education>(() => ({
    degree: valueOf(state, 'degree', employee?.degree),
    faculty: valueOf(state, 'faculty', employee?.faculty),
    major: valueOf(state, 'major', employee?.major),
    university: valueOf(state, 'university', employee?.university),
  }));
  // a student (owner, 25 October 2026: "Add a Student option"): the switch and the year, for the student's wording
  const [studying, setStudying] = useState(() => valueOf(state, 'stillStudying', employee?.stillStudying ? 'true' : 'false') === 'true');
  const [studyYear, setStudyYear] = useState(() => valueOf(state, 'studyYear', employee?.studyYear));
  const noteEducation = (name: string, value: string) => {
    if (EDUCATION_KEYS.includes(name)) setEdu((e) => ({ ...e, [name]: value }));
    if (name === 'studyYear') setStudyYear(value);
  };
  // a student's qualification is never proposed from a degree: while it is empty, contracts print the student's wording
  const proposal = studying ? { text: '', left: [] } : proposeQualification(edu);
  const wording = studying ? studentQualificationAr({ studyYear, gender, faculty: edu.faculty, university: edu.university }) : '';
  const [qual, setQual] = useState(() => valueOf(state, 'qualificationAr', employee?.qualificationAr));
  const [ownQual, setOwnQual] = useState(() => qual !== '');
  const qualHint = (
    <>
      As printed on contracts.
      {!ownQual && proposal.text && ' Proposed from the details above: check it, and edit it as needed.'}
      {ownQual && proposal.text && proposal.text !== qual && (
        <>
          {' '}
          Proposed:{' '}
          <span lang="ar" dir="rtl">
            {proposal.text}
          </span>{' '}
          <button type="button" onClick={() => setQual(proposal.text)} className="font-semibold text-accent hover:underline">
            Use it
          </button>
        </>
      )}
      {proposal.text &&
        proposal.left.length > 0 &&
        ` ${named(proposal.left).replace(/^t/, 'T')} ${proposal.left.length > 1 ? 'are' : 'is'} in English, so left out: add ${proposal.left.length > 1 ? 'them' : 'it'} in Arabic.`}
    </>
  );

  const typedQual = ownQual ? qual.trim() : '';
  const useWording = (
    <button
      type="button"
      onClick={() => {
        setQual(wording);
        setOwnQual(true);
      }}
      className="font-semibold text-accent hover:underline"
    >
      Use this wording
    </button>
  );
  const studentHint = !wording ? (
    'As printed on contracts. For a student, choose the study year to word it, or type it.'
  ) : !typedQual ? (
    <>
      Prints as:{' '}
      <span lang="ar" dir="rtl">
        {wording}
      </span>{' '}
      {useWording}
    </>
  ) : (
    <>
      As printed on contracts.
      {typedQual !== wording && (
        <>
          {' '}
          The student wording:{' '}
          <span lang="ar" dir="rtl">
            {wording}
          </span>{' '}
          {useWording}
        </>
      )}
    </>
  );

  const hintOf = (f: Field) =>
    noMilitary(f) ? 'Women need no military papers.' : f.name === 'qualificationAr' ? (studying ? studentHint : qualHint) : f.hint;

  function control(f: Field) {
    const saved = startText(f, employee, suggestions);
    const id = fid(f.name);
    const describedBy = card.describedBy(f.name, hintOf(f) ? fid(`${f.name}-hint`) : undefined);
    // the year as last chosen, so it is still what the wording says when the switch is turned off and on again
    const value = f.name === 'studyYear' ? studyYear : valueOf(state, f.name, saved);

    if (noMilitary(f)) {
      return (
        <>
          <input type="hidden" name={f.name} value="not_applicable" />
          <input id={id} value={LABELS.militaryStatus.not_applicable} readOnly aria-describedby={describedBy} className="input bg-canvas text-muted" />
        </>
      );
    }
    if (f.kind === 'date') return <DateInput id={id} name={f.name} aria-describedby={describedBy} defaultValue={value} />;
    if (f.kind === 'switch') {
      return (
        <>
          <input type="hidden" name={f.name} value={studying ? 'true' : 'false'} />
          <label className={`${chip} w-fit`}>
            <input id={id} type="checkbox" checked={studying} onChange={(e) => setStudying(e.target.checked)} aria-describedby={describedBy} className="size-4 accent-accent" />
            {f.label}
          </label>
        </>
      );
    }
    if (f.kind === 'month') {
      return <input id={id} name={f.name} type="month" placeholder="e.g. 06/2027" aria-describedby={describedBy} defaultValue={value} className="input" />;
    }
    if (f.kind === 'list' && f.list) {
      return (
        <ListOrOther
          id={id}
          name={f.name}
          label={f.label}
          groups={f.list.groups}
          aliases={f.list.aliases}
          defaultValue={value}
          max={f.max}
          onValue={(v) => noteEducation(f.name, v)}
          aria-describedby={describedBy}
        />
      );
    }
    if (f.kind === 'tel') {
      const label = f.name === 'emergencyMobile' ? 'Emergency contact’s mobile' : f.label;
      return <PhoneInput id={id} name={f.name} label={label} aria-describedby={describedBy} defaultValue={value} />;
    }
    if (f.kind === 'select') {
      // A stored value that is no longer in the list (e.g. imported) stays selectable, so saving doesn't clear it.
      const list = saved && !f.options?.some((o) => o.value === saved) ? [...(f.options ?? []), { value: saved, label: saved }] : (f.options ?? []);
      return (
        <Select
          id={id}
          name={f.name}
          aria-describedby={describedBy}
          defaultValue={value}
          onChange={(e) => {
            if (f.name === 'gender') setGender(e.target.value);
            noteEducation(f.name, e.target.value);
          }}
          className="input"
        >
          <option value="">Not set</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
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
      ...(f.name === 'insuranceNo' ? { inputMode: 'numeric' as const, autoComplete: 'off' } : {}),
      ...(f.ar ? { lang: 'ar', dir: 'rtl' as const } : {}),
    };
    if (f.name === 'qualificationAr') {
      return (
        <input
          type="text"
          {...common}
          defaultValue={undefined}
          value={ownQual ? qual : proposal.text}
          onChange={(e) => {
            setQual(e.target.value);
            setOwnQual(e.target.value !== ''); // emptied: the proposal fills it in again
          }}
        />
      );
    }
    if (f.name === 'major') return <input type="text" {...common} onChange={(e) => noteEducation('major', e.target.value)} />;
    if (f.multiline) return <textarea rows={2} {...common} />;
    if (f.kind === 'year') return <input type="text" inputMode="numeric" autoComplete="off" {...common} />;
    return <input type={f.kind ?? 'text'} {...common} />;
  }

  return GROUPS.filter((group) => !part || group.part === part).map((group) => (
    <fieldset key={group.title} className="space-y-5">
      <legend className="font-semibold">{group.title}</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        {group.fields
          .filter((f) => !f.student || studying)
          .map((f) => (!employee && f.name === 'employeeCode' ? { ...f, ...NEW_CODE } : f))
          .map((f) => (emailDomain && f.name === 'workEmail' ? { ...f, ...inDomain(emailDomain) } : f))
          .map((f) => (
            <div key={f.name} className={f.wide ? 'sm:col-span-2' : undefined}>
              {/* a switch is its own label */}
              {f.kind !== 'switch' && (
                <label htmlFor={fid(f.name)} className="label">
                  {f.label}
                </label>
              )}
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
