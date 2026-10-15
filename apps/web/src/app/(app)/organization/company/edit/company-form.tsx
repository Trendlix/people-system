'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { Company, FormState } from '@/lib/types';
import { updateCompany } from '../actions';

type TextField = {
  name: keyof Company;
  label: string;
  ar?: boolean;
  type?: 'text' | 'email' | 'tel';
  max: number;
  multiline?: boolean;
  hint?: string;
};

const GROUPS: { title: string; hint?: string; fields: TextField[] }[] = [
  {
    title: 'Company',
    fields: [
      { name: 'nameEn', label: 'Company name (English)', max: 150 },
      { name: 'nameAr', label: 'Company name (Arabic)', ar: true, max: 150, hint: 'As printed on contracts.' },
      { name: 'activity', label: 'Business activity', ar: true, max: 1000, multiline: true },
    ],
  },
  {
    title: 'Registration',
    fields: [
      { name: 'commercialRegNo', label: 'Commercial registration (السجل التجاري)', max: 50 },
      { name: 'taxRegNo', label: 'Tax registration number', max: 30 },
      { name: 'insuranceEmployerNo', label: 'Social insurance employer number', max: 30 },
    ],
  },
  {
    title: 'Address & Contact',
    fields: [
      { name: 'addressAr', label: 'Address (Arabic)', ar: true, max: 300, multiline: true, hint: 'As printed on contracts.' },
      { name: 'addressEn', label: 'Address (English)', max: 300, multiline: true },
      { name: 'city', label: 'City', max: 100 },
      { name: 'phone', label: 'Phone', type: 'tel', max: 30 },
      { name: 'email', label: 'Email', type: 'email', max: 254 },
      { name: 'website', label: 'Website', max: 200, hint: 'e.g. trendlix.com' },
      {
        name: 'emailDomain',
        label: 'Work email domain',
        max: 253,
        hint: 'e.g. trendlix.com. Every employee’s work email must then end in @trendlix.com. Leave empty to allow any work email.',
      },
    ],
  },
  {
    title: 'Company Representative',
    hint: 'Signs documents on the company’s behalf, such as the clearance form.',
    fields: [
      { name: 'repName', label: 'Name (Arabic)', ar: true, max: 150, hint: 'As printed on documents.' },
      { name: 'repNameEn', label: 'Name (English)', max: 150, hint: 'For the English side of bilingual documents.' },
      { name: 'repTitle', label: 'Job title (Arabic)', ar: true, max: 100 },
      { name: 'repTitleEn', label: 'Job title (English)', max: 100 },
    ],
  },
];

export function CompanyForm({ company }: { company: Company }) {
  const [state, formAction] = useActionState(updateCompany, {} as FormState);
  const fid = useFieldIds();

  return (
    <form action={formAction} className="card max-w-2xl space-y-8 p-6">
      <FormErrors errors={state.errors} />

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-5">
          <legend className="font-semibold">{group.title}</legend>
          {group.hint && <p className="-mt-3 text-sm text-muted">{group.hint}</p>}
          {group.fields.map((f) => {
            const saved = company[f.name];
            const common = {
              id: fid(f.name),
              name: f.name,
              maxLength: f.max,
              required: f.name === 'nameEn',
              defaultValue: valueOf(state, f.name, typeof saved === 'string' ? saved : null),
              className: 'input',
              ...(f.ar ? { lang: 'ar', dir: 'rtl' as const } : {}),
            };
            return (
              <div key={f.name}>
                <label htmlFor={fid(f.name)} className="label">
                  {f.label}
                </label>
                {f.multiline ? <textarea rows={2} {...common} /> : <input type={f.type ?? 'text'} {...common} />}
                {f.hint && <p className="hint">{f.hint}</p>}
              </div>
            );
          })}
          {group.title === 'Company Representative' && (
            <div>
              <label htmlFor={fid('repNationalId')} className="label">
                National ID
              </label>
              <input
                id={fid('repNationalId')}
                name="repNationalId"
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                placeholder={company.repNationalIdMasked ?? '14 digits'}
                defaultValue={valueOf(state, 'repNationalId')}
                className="input max-w-64"
              />
              <p className="hint">
                {company.repNationalIdMasked
                  ? 'Stored securely and never shown in full. Leave empty to keep the current number.'
                  : 'Stored securely and never shown in full.'}
              </p>
            </div>
          )}
        </fieldset>
      ))}

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton>Save company details</SubmitButton>
        <Link href="/organization/company" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
