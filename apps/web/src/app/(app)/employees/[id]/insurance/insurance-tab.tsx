import Link from 'next/link';
import { Suspense } from 'react';
import { LABELS } from '@trendlix/shared';
import { ApiError, apiGet } from '@/lib/api';
import { formatDate, titleCase } from '@/lib/format';
import { PROTECTED_PDF_HINT } from '@/lib/protected-pdf';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { DocumentItem, EmployeeProfile, PaperworkItem } from '@/lib/types';
import { saveInsuranceDetail } from '../../insurance-actions';
import { canSeeEmployeeFiles, FieldGrid, Loading, ProfileSection, profileHref, todayInCairo, type GridField } from '../../ui';
import { formatEgp } from '../contracts/salary';
import { loadDocuments } from '../documents/data';
import { checkDocument } from '../documents/document-actions';
import { MissingList } from '../documents/document-forms';
import { DocumentItems, type DocumentAccess } from '../documents/document-rows';
import { itemTemplateHref, NOT_AVAILABLE, type CheckResult } from '../documents/wording';
import {
  basicPrinted,
  comprehensivePrinted,
  formsGap,
  formsToCheck,
  hasInsuranceCopy,
  insuranceCopyHref,
  insuranceForms,
  insuredEmployment,
  insuredNote,
  insuredPrinted,
  printHref,
  printRequired,
  printStatus,
  readiness,
  showsWages,
  startPrinted,
  type Printed,
  type Readiness,
} from './insurance';
import { OccupationDetail, StartDateDetail, WageDetail } from './insurance-fields';

// The profile's Social Insurance tab: all the social insurance work in one place (owner's request, 16 October 2026:
// "creating a tab here for all social insurance work"), moved out of the Contracts tab. The insurance details (the
// occupation, the subscription start, the basic, insured and comprehensive wages, the contract's filing dates); for HR,
// whether Forms 1 and 6 can be generated or what they still need, each with its link; the forms themselves, generated
// and taken through printing, the signed copy and verifying as on the Contracts tab; and the social insurance print
// from the employee file. The insurance number (Basic Data) and the company's insurance office and employer number (the
// company profile) are not repeated here (owner, 16 October 2026): a form missing one lists it under Readiness, with
// where to fill it in.
//
// The occupation, the subscription start and the basic and comprehensive wages are the employee's own, changed here in
// place by HR (owner's decisions, 16 October 2026: the occupation no longer the job title's); while one isn't set, Form
// 1 prints what stands in for it, which the item says (the join date, the default, the contract's). The insured wage
// isn't edited: it is the comprehensive wage within this year's insurable limits, as the API works it out (owner's
// decision, 16 October 2026: "Apply the insurance wage cap rule from the comprehensive wage, and the insured wage field
// to be uneditable in the Social Insurance tab"), and the item says how.
//
// Whoever sees the Contracts tab sees this one, and the wages only with the right to see salaries, as before.
// The forms are HR's and the CEO's (HR generates and moves them along, the CEO views and downloads); the print is the
// employee file's, for those who see the national ID (HR and the CEO). The API checks all of it again.

const notYet = <span className="text-muted">Not yet</span>;
/** A link inside a note or a sentence, told apart from the text around it. */
const LINK = 'font-medium text-accent hover:underline';

function SectionLoading({ title }: { title: string }) {
  return (
    <ProfileSection title={title}>
      <Loading />
    </ProfileSection>
  );
}

function Dashed({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{children}</p>;
}

/** An occupation as written: "194200 · اخصائي موارد بشريه", the code first and the name right to left. */
function OccupationText({ code, name }: { code: string; name?: string | null }) {
  return (
    <span dir="ltr">
      <span className="tabular-nums">{code}</span>
      {name && (
        <>
          {' · '}
          <span lang="ar" dir="rtl">
            {name}
          </span>
        </>
      )}
    </span>
  );
}

/** What Form 1 prints for an item: the employee's own, or what stands in for it ("EGP 410.00 · default"), or Not set. */
function PrintedText({ printed, none = 'Not set' }: { printed: Printed; none?: string }) {
  if (!printed) return <span className="text-muted">{none}</span>;
  return (
    <span>
      <span className="tabular-nums">{printed.text}</span>
      {printed.from && <span className="text-muted"> · {printed.from}</span>}
    </span>
  );
}

/** An amount as the wage forms take it, with two decimals (owner, 16 October 2026): "2500.50", "410.00", or "" for none. */
const typedAmount = (n: number | null | undefined) => (typeof n === 'number' ? n.toFixed(2) : '');

/**
 * What Form 1 prints that is the employee's own: the occupation, the subscription start and the basic and
 * comprehensive wages (set here, else what stands in for them), the insured wage worked out from the comprehensive
 * wage (the wages for those who may see salaries), and the contract's filing dates. HR changes the employee's own in
 * place.
 */
function InsuranceDetails({ profile: p }: { profile: EmployeeProfile }) {
  const e = insuredEmployment(p);
  const c = e?.contract ?? null;
  // HR changes the employee's own; the wages only come with the right to see salaries (HR has it)
  const edit = (field: Parameters<typeof saveInsuranceDetail>[1]) => (p.access.edit ? saveInsuranceDetail.bind(null, p.id, field) : null);
  // an ended employment's contract is no longer the signed one the profile sends
  const noContract = <span className="text-muted">{e?.endDate ? 'Contract ended' : 'No signed contract yet'}</span>;

  const fields: GridField[] = [
    {
      key: 'occupationCode',
      label: 'Occupation',
      value: (
        <OccupationDetail action={edit('occupationCode')} code={p.occupationCode ?? null}>
          {p.occupationCode ? <OccupationText code={p.occupationCode} name={p.occupationName} /> : <span className="text-muted">Not set</span>}
        </OccupationDetail>
      ),
    },
    {
      key: 'insuranceStartDate',
      label: 'Subscription start',
      value: (
        <StartDateDetail action={edit('insuranceStartDate')} value={formatDate(p.insuranceStartDate)}>
          <PrintedText printed={startPrinted(p, e)} none="Not yet" />
        </StartDateDetail>
      ),
    },
  ];
  // salary data: for those who see salaries only, as the contract's salary (the API leaves them out for anyone else)
  if (showsWages(p)) {
    fields.push(
      {
        key: 'insuranceBasicWage',
        label: 'Basic wage (social insurance)',
        protected: true,
        value: (
          <WageDetail
            action={edit('insuranceBasicWage')}
            field="insuranceBasicWage"
            name="basic wage"
            label="Basic wage (EGP)"
            value={typedAmount(p.insuranceBasicWage)}
            hint={
              <>
                Printed in Form 1&apos;s <bdi lang="ar">أجر أساسي</bdi> boxes. Leave empty to use the default ({formatEgp(p.insuranceBasicDefault ?? 0)}).
              </>
            }
          >
            <PrintedText printed={basicPrinted(p)} />
          </WageDetail>
        ),
      },
      {
        // read only: the comprehensive wage within this year's limits, as the API works it out
        key: 'insuranceInsuredWage',
        label: 'Insured wage (social insurance)',
        protected: true,
        value: <PrintedText printed={insuredPrinted(p)} />,
        note: p.insurableLimits ? insuredNote(p.insurableLimits) : undefined,
      },
      {
        key: 'insuranceComprehensiveWage',
        label: 'Comprehensive wage (social insurance)',
        protected: true,
        value: (
          <WageDetail
            action={edit('insuranceComprehensiveWage')}
            field="insuranceComprehensiveWage"
            name="comprehensive wage"
            label="Comprehensive wage (EGP)"
            value={typedAmount(p.insuranceComprehensiveWage)}
            hint={
              <>
                Printed in Form 1&apos;s <bdi lang="ar">الأجر الشامل</bdi> boxes, and sets the insured wage. Leave empty to use the contract&apos;s gross and
                allowances.
              </>
            }
          >
            <PrintedText printed={comprehensivePrinted(p, c)} />
          </WageDetail>
        ),
      },
    );
  }
  fields.push(
    { key: 'insurance-filed', label: 'Contract filed with social insurance', value: c ? (c.insuranceFiledOn ? formatDate(c.insuranceFiledOn) : notYet) : noContract },
    {
      key: 'insurance-labour-office',
      label: 'Contract filed with the labour office',
      value: c ? (c.labourOfficeFiledOn ? formatDate(c.labourOfficeFiledOn) : notYet) : noContract,
    },
  );

  return (
    <ProfileSection title="Insurance Details" note={!p.employment && e?.endDate ? `Their last employment, ended ${formatDate(e.endDate)}` : undefined}>
      <FieldGrid fields={fields} />
      {c && p.access.edit && (
        <p className="text-xs text-muted">
          The filing dates are set on the contract, on the{' '}
          <Link href={`${profileHref(p.id, 'contracts')}#contract`} className={LINK}>
            Contracts tab
          </Link>
          , with Edit filing dates and note.
        </p>
      )}
    </ProfileSection>
  );
}

const READY_BADGE: Record<Readiness['state'], string> = {
  ready: 'bg-ok-soft text-ok',
  missing: 'bg-warn-soft text-warn',
  template: 'bg-warn-soft text-warn',
  unchecked: 'bg-line-soft text-muted',
};

function readyText(r: Readiness): string {
  if (r.state === 'ready') return 'Ready to generate';
  if (r.state === 'missing') return `${r.missing.length} missing`;
  if (r.state === 'template') return r.text;
  return 'Not checked';
}

/** For HR: whether each form offered can be generated now, or the details it still needs, each linked to where it is filled in. */
function FormsReadiness({ forms, checks }: { forms: DocumentItem[]; checks: (CheckResult | null)[] }) {
  return (
    <ProfileSection title="Readiness" note="Checked against what each form's template prints">
      <ul className="card">
        {forms.map((form, i) => {
          const r = readiness(form, checks[i] ?? null);
          return (
            <li key={form.slotKey} className="space-y-3 border-b border-line-soft p-5 last:border-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-semibold">{titleCase(form.name)}</h3>
                <span className={`badge ${READY_BADGE[r.state]}`}>{readyText(r)}</span>
                {r.state === 'template' && (
                  <Link href={itemTemplateHref(form)} className={`text-sm ${LINK}`}>
                    {form.templateStatus === 'missing' ? 'Upload it in Templates' : 'Open the template'}
                    <span className="sr-only"> for {form.name}</span>
                  </Link>
                )}
              </div>
              {r.state === 'missing' && <MissingList missing={r.missing} title="Fill these in before generating it." alert={false} />}
              {r.state === 'unchecked' && <p className="text-sm text-muted">{r.errors.join(' ')}</p>}
            </li>
          );
        })}
      </ul>
    </ProfileSection>
  );
}

/**
 * The readiness (HR) and the forms themselves: the documents the API offers in its insurance section, each as on the
 * Contracts tab, with a pointer to the contract's social insurance copy, which stays with the contract.
 */
async function InsuranceForms({ profile: p, can }: { profile: EmployeeProfile; can: DocumentAccess }) {
  const load = await loadDocuments(p.id);
  if (load.kind === 'forbidden') return null;
  if (load.kind !== 'ok') {
    return (
      <ProfileSection title="Forms">
        <Dashed>
          {load.kind === 'unavailable'
            ? `${NOT_AVAILABLE} Social insurance Forms 1 and 6 will be listed here.`
            : 'The forms could not be loaded. Please try again in a moment.'}
        </Dashed>
      </ProfileSection>
    );
  }

  const forms = insuranceForms(load.tab);
  const e = insuredEmployment(p);
  const gap = formsGap(e, forms);
  // checked the way Generate checks them, for HR only (who generates); a form without a published template has nothing to check
  const checked = can.act ? formsToCheck(forms) : [];
  const answers = await Promise.all(checked.map((f) => checkDocument(p.id, f.slotKey, f.contractId ?? null)));
  const checks = forms.map((f) => answers[checked.indexOf(f)] ?? null);
  const today = formatDate(todayInCairo());
  const anyDocument = forms.some((f) => (f.documents ?? []).length > 0);
  const gapText = gap && (
    <>
      {gap.text}
      {gap.kind === 'no_ending' && p.access.edit && (
        <>
          {' '}
          <Link href={profileHref(p.id, 'employment')} className={LINK}>
            Open the Employment tab
          </Link>
        </>
      )}
    </>
  );

  return (
    <>
      {can.act && forms.length > 0 && <FormsReadiness forms={forms} checks={checks} />}
      <ProfileSection title="Forms" note={forms.length > 0 ? 'Generated from the templates, to print and sign' : undefined}>
        {forms.length > 0 ? <DocumentItems items={forms} employee={p} can={can} today={today} /> : <Dashed>{gapText ?? 'No social insurance forms apply yet.'}</Dashed>}
        {forms.length > 0 && gapText && <p className="text-sm text-muted">{gapText}</p>}
        {anyDocument && <p className="text-xs text-muted">{PROTECTED_PDF_HINT}</p>}
        {hasInsuranceCopy(load.tab) && (
          <p className="text-sm text-muted">
            The contract&apos;s social insurance copy is with the contract, on the{' '}
            <Link href={insuranceCopyHref(p.id)} className={LINK}>
              Contracts tab
            </Link>
            .
          </p>
        )}
      </ProfileSection>
    </>
  );
}

/** The social insurance print (برنت التأمينات) in the employee file: uploaded or missing, and where it is viewed or uploaded. */
async function InsurancePrint({ profile: p }: { profile: EmployeeProfile }) {
  const title = 'Social Insurance Print';
  let items: PaperworkItem[];
  try {
    items = await apiGet<PaperworkItem[]>(`/employees/${p.id}/paperwork`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return (
      <ProfileSection title={title} restricted>
        <Dashed>The employee file could not be loaded. Please try again in a moment.</Dashed>
      </ProfileSection>
    );
  }
  const required = printRequired(p);
  const status = printStatus(items, required);
  const type = insuredEmployment(p)?.employmentType;
  const action = status.state === 'uploaded' ? 'View it on the Documents tab' : p.access.edit ? 'Upload it on the Documents tab' : 'Open the Documents tab';

  return (
    <ProfileSection
      title={title}
      restricted
      note={
        <span lang="ar" dir="rtl">
          برنت التأمينات
        </span>
      }
    >
      <div className="card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {status.state === 'uploaded' ? (
            <>
              <span className="font-semibold text-ok">
                <span aria-hidden="true">✓ </span>Uploaded
              </span>
              <span className="text-muted tabular-nums">{formatDate(status.uploadedAt)}</span>
              {status.files > 1 && <span className="text-muted">· {status.files} files</span>}
              {status.documentNo && (
                <span className="text-muted">
                  · No. <span className="tabular-nums">{status.documentNo}</span>
                </span>
              )}
            </>
          ) : status.required ? (
            <>
              <span className="badge bg-warn-soft text-warn">Missing</span>
              <span className="text-muted">The employee file needs it.</span>
            </>
          ) : (
            <span className="text-muted">
              Not uploaded. {type ? `A ${LABELS.employmentType[type].toLowerCase()} employee's file doesn't need it.` : 'The employee file doesn’t need it.'}
            </span>
          )}
        </p>
        <Link href={printHref(p.id, required)} className={`text-sm ${LINK}`}>
          {action}
        </Link>
      </div>
    </ProfileSection>
  );
}

export async function InsuranceTab({ profile: p }: { profile: EmployeeProfile }) {
  const user = await getCurrentUser();
  return (
    <div className="space-y-8">
      {/* from the profile itself; each part below loads on its own, so a slow one doesn't hold up the others */}
      <InsuranceDetails profile={p} />
      {canSeeEmployeeFiles(user) && (
        <Suspense fallback={<SectionLoading title="Forms" />}>
          <InsuranceForms profile={p} can={{ act: p.access.edit, delete: canDelete(user) }} />
        </Suspense>
      )}
      {/* the employee file's, for those who see the Documents tab */}
      {p.access.identity && (
        <Suspense fallback={<SectionLoading title="Social Insurance Print" />}>
          <InsurancePrint profile={p} />
        </Suspense>
      )}
    </div>
  );
}
