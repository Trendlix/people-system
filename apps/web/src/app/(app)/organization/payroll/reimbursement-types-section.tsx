import Link from 'next/link';
import { reimbursementRulesText } from '@trendlix/shared';
import { DeleteForm } from '@/components/form';
import { titleCase } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import type { Department, Grade, ReimbursementTypeView, SessionUser } from '@/lib/types';
import { getOrNull } from '../../approvals/data';
import { loadJson } from '../../payroll/load';
import { deleteReimbursementType } from './reimbursement-types-actions';
import { NotLoaded, SetupSection } from './section';
import {
  CAP_FIELDS,
  capText,
  claimsCountText,
  editsReimbursementTypes,
  NEW_REIMBURSEMENT_TYPE_HREF,
  REIMBURSEMENT_TYPES_ID,
  reimbursementTypeHref,
  seesReimbursementTypes,
  whoCanClaim,
} from './reimbursement-types';

// Payroll Setup, 5 Reimbursement Types (owner, 18 October 2026: "allow the employee to add reimbursement request … for
// specific preset up conditions", "in the setup i need to enter for it a cap"): the kinds of expense employees may claim
// back from My Requests, each with its caps first and large (a claim, a month, a year), then its other conditions as the
// employee reads them (reimbursementRulesText), who may claim it, whether it is on and how many claims use it. HR adds
// and changes them on a page of their own (./reimbursement-types); Finance, the CEO and Admin read them here; a Super
// Admin deletes one no claim uses (one with claims is turned off instead). An approved claim is paid with the next
// payroll, untaxed, as a Reimbursement addition.

const INTRO =
  'The kinds of expense employees can claim back from My Requests, each with its caps and conditions. A claim goes to the direct manager, then HR, then Finance; once approved, it is paid with the next payroll as an untaxed Reimbursement addition. A change applies to the claims sent afterwards.';

function TypeCard({
  type: t,
  departments,
  grades,
  edits,
  deletes,
}: {
  type: ReimbursementTypeView;
  departments: Department[];
  grades: Grade[];
  edits: boolean;
  deletes: boolean;
}) {
  return (
    <li className={`space-y-3 rounded-lg border border-line p-4 ${t.active ? 'bg-white' : 'bg-canvas'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            {titleCase(t.nameEn)}{' '}
            <span lang="ar" dir="rtl" className="inline-block font-normal text-muted">
              {t.nameAr}
            </span>
          </h3>
          {t.description && <p className="mt-0.5 text-sm whitespace-pre-line text-muted">{t.description}</p>}
        </div>
        <div className="flex items-center gap-3">
          {t.active ? <span className="badge bg-ok-soft text-ok">On</span> : <span className="badge bg-line-soft text-muted">Off</span>}
          {edits && (
            <Link href={reimbursementTypeHref(t.id)} className="text-sm font-semibold">
              Edit<span className="sr-only"> {t.nameEn}</span>
            </Link>
          )}
        </div>
      </div>
      {/* the caps first, as the owner asked for them */}
      <dl className="grid gap-3 sm:grid-cols-3" aria-label={`Caps of ${t.nameEn}`}>
        {CAP_FIELDS.map((f) => (
          <div key={f.key} className="rounded-lg bg-canvas px-3 py-2">
            <dt className="text-xs text-muted">Cap {f.what}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${t[f.key] === null ? 'text-muted' : ''}`}>{capText(t[f.key])}</dd>
          </div>
        ))}
      </dl>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted">Conditions</dt>
        <dd>{reimbursementRulesText(t)}</dd>
        <dt className="text-muted">Who can claim it</dt>
        <dd>
          {whoCanClaim(t, departments, grades).map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </dd>
        <dt className="text-muted">Claims</dt>
        <dd className="tabular-nums">{claimsCountText(t.claims)}</dd>
      </dl>
      {/* only a Super Admin deletes (owner's decision, 15 October 2026), and only a type no claim uses */}
      {deletes && t.claims === 0 && (
        <DeleteForm
          action={deleteReimbursementType.bind(null, t.id)}
          confirmText={`Delete the reimbursement type ${t.nameEn}? No claim uses it. This cannot be undone.`}
          label="Delete type"
        />
      )}
    </li>
  );
}

export async function ReimbursementTypesSection({ user }: { user: SessionUser }) {
  if (!seesReimbursementTypes(user)) return null;
  const [loaded, departments, grades] = await Promise.all([
    loadJson<ReimbursementTypeView[]>('/reimbursement-types'),
    getOrNull<Department[]>('/departments'),
    getOrNull<Grade[]>('/grades'),
  ]);
  const edits = editsReimbursementTypes(user);

  let body: React.ReactNode;
  if (loaded.kind === 'unavailable' || loaded.kind === 'failed') {
    body = <NotLoaded what="the reimbursement types" loaded={loaded.kind === 'failed' ? { kind: 'failed', message: loaded.messages.join(' ') } : loaded} />;
  } else if (loaded.kind === 'forbidden') {
    body = <NotLoaded what="the reimbursement types" loaded={{ kind: 'failed', message: 'Only HR, Finance, the CEO and Admin can see them.' }} />;
  } else if (loaded.value.length === 0) {
    body = <p className="text-sm text-muted">No reimbursement types yet.{edits && ' Add the first one, e.g. Mobile bill or Transport, with its caps.'}</p>;
  } else {
    body = (
      <ul className="space-y-3">
        {loaded.value.map((t) => (
          <TypeCard key={t.id} type={t} departments={departments ?? []} grades={grades ?? []} edits={edits} deletes={canDelete(user)} />
        ))}
      </ul>
    );
  }

  return (
    <SetupSection id={REIMBURSEMENT_TYPES_ID} title="Reimbursement Types" intro={INTRO}>
      {edits && loaded.kind !== 'unavailable' && (
        <div className="mb-4">
          <Link href={NEW_REIMBURSEMENT_TYPE_HREF} className="btn btn-primary">
            Add a reimbursement type
          </Link>
        </div>
      )}
      {body}
    </SetupSection>
  );
}
