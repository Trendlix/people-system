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
  /** Digits only, in a narrow box. */
  numeric?: boolean;
  placeholder?: string;
};

const GROUPS: { title: string; fields: TextField[] }[] = [
  {
    title: 'Company',
    fields: [
      { name: 'nameEn', label: 'Company name (English)', max: 150 },
      { name: 'nameAr', label: 'Company name (Arabic)', ar: true, max: 150 },
      { name: 'activity', label: 'Business activity', ar: true, max: 1000, multiline: true },
    ],
  },
  {
    title: 'Registration',
    fields: [
      { name: 'commercialRegNo', label: 'Commercial registration (السجل التجاري)', max: 50 },
      { name: 'taxRegNo', label: 'Tax registration number', max: 30 },
      { name: 'insuranceEmployerNo', label: 'Social insurance employer number', max: 30 },
      // for social insurance Form 1 (owner, 15 October 2026)
      { name: 'insuranceOffice', label: 'Social insurance office', ar: true, max: 120 },
      { name: 'insuranceSectorCode', label: 'Sector code', max: 2, numeric: true },
    ],
  },
  {
    title: 'Address & Contact',
    fields: [
      { name: 'addressAr', label: 'Address (Arabic)', ar: true, max: 300, multiline: true },
      { name: 'addressEn', label: 'Address (English)', max: 300, multiline: true },
      { name: 'city', label: 'City', max: 100 },
      { name: 'phone', label: 'Phone', type: 'tel', max: 30 },
      { name: 'email', label: 'Email', type: 'email', max: 254 },
      { name: 'website', label: 'Website', max: 200, placeholder: 'trendlix.com' },
      { name: 'emailDomain', label: 'Work email domain', max: 253, placeholder: 'trendlix.com' },
    ],
  },
  {
    title: 'Company Representative',
    fields: [
      { name: 'repName', label: 'Name (Arabic)', ar: true, max: 150 },
      { name: 'repNameEn', label: 'Name (English)', max: 150 },
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
          {group.fields.map((f) => {
            const saved = company[f.name];
            const common = {
              id: fid(f.name),
              name: f.name,
              maxLength: f.max,
              required: f.name === 'nameEn',
              defaultValue: valueOf(state, f.name, typeof saved === 'string' ? saved : null),
              placeholder: f.placeholder,
              className: f.numeric ? 'input max-w-24 tabular-nums' : 'input',
              ...(f.numeric ? { inputMode: 'numeric' as const, autoComplete: 'off' } : {}),
              ...(f.ar ? { lang: 'ar', dir: 'rtl' as const } : {}),
            };
            return (
              <div key={f.name}>
                <label htmlFor={fid(f.name)} className="label">
                  {f.label}
                </label>
                {f.multiline ? <textarea rows={2} {...common} /> : <input type={f.type ?? 'text'} {...common} />}
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
