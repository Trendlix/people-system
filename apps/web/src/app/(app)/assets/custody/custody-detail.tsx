import { ASSET_CONDITION_LABELS, CUSTODY_KIND_LABELS, isAssetCode, NOT_SIGNED_TEXT, type CustodyItemView, type CustodyRecordView } from '@trendlix/shared';
import Link from 'next/link';
import { APP_ASSET_PATHS, ASSET_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { formatDateTime } from '@/lib/format';
import { receiveBack } from '../custody-actions';
import { deductionText, returnLabel, returnText, returnTone, sizeText, valueText, whoText } from '../custody';
import { checklistText, incidentDeductionHref, missingAccessoriesText } from '../upkeep';
import { CustodyStatusBadge, DueText, NotSignedBadge } from '../custody-ui';
import { DetailRow } from '../ui';
import { ReceiveForm } from './receive-form';
import { SignedCopyAttach } from './signed-copy';
import { joinShown, shownCode } from '@/lib/hidden';

// A custody record's page (Assets step 3; the spec's custody record: "Items, return status, print form, attach signed
// copy (camera or PDF), receive back"), on the site and in the phone layout (`surface`): who has it and for what, its
// items with how each came back, its signed copies ("Signed copy not attached" until one is), Print form (the site's),
// and for a custodian or a manager Attach and Receive back. The value of each item when it went out only when the API
// sent it (the CEO, Finance and a Super Admin). A damaged or missing item stays on the person's record; for HR, "Create a
// deduction" opens Additions / Deductions with it filled in, never made by itself (owner, 21 October 2026: "Record it;
// HR decides a deduction"), and the deductions made from it are listed for HR, Finance and the CEO. Step 4 (22 October
// 2026: accessories): each item's checklist that went out with it, those that didn't come back, a deduction for them too.

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** What the page says once something was done (?done=, ?skipped=). */
export function custodyDoneText(done: string | null, skipped: string[]): string | null {
  const left = skipped.length ? ` Not handed over from the kit: ${skipped.join(', ')}.` : '';
  if (done === 'handed') return `Handed over. Print the form, have it signed, then attach the signed copy.${left}`;
  return left ? left.trim() : null;
}

/** The asset codes of ?skipped=, as kept. */
export function skippedOf(raw: string | string[] | undefined): string[] {
  const text = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  return text
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => isAssetCode(c))
    .slice(0, 50);
}

function ItemReturn({ item, record, today }: { item: CustodyItemView; record: CustodyRecordView; today: string }) {
  // damaged or missing, or (step 4) back without some of its accessories: on the person's record, a deduction for HR
  const deductionLink = incidentDeductionHref(
    { employeeId: record.employee.id, itemId: item.id, condition: item.returnCondition, missing: item.accessoriesMissing, assetCode: item.asset.code, custodyCode: record.code },
    today,
  );
  const bad = deductionLink !== null;
  const notBack = item.returnedAt ? missingAccessoriesText(item.accessoriesMissing) : null;
  return (
    <div className="space-y-1">
      <span className={`badge ${returnTone(item.returnCondition)}`}>{returnLabel(item.returnCondition)}</span>
      {item.returnedAt && (
        <p className="text-xs text-muted">
          {returnText(item)}
          {item.receivedBy ? `, received by ${whoText(item.receivedBy)}` : ''}
        </p>
      )}
      {notBack && <p className="text-xs text-warn">{notBack}</p>}
      {item.returnNotes && <p className="text-xs">{item.returnNotes}</p>}
      {bad && item.deductions && item.deductions.length > 0 && (
        <ul className="text-xs text-muted">
          {item.deductions.map((d) => (
            <li key={d.id}>Deduction: {deductionText(d)}</li>
          ))}
        </ul>
      )}
      {deductionLink && record.can.deduction && (
        <Link href={deductionLink} className="inline-flex min-h-9 items-center text-xs font-semibold">
          Create a deduction
        </Link>
      )}
    </div>
  );
}

export function CustodyDetail({ record: r, surface, today, done }: { record: CustodyRecordView; surface: 'site' | 'app'; today: string; done: string | null }) {
  const site = surface === 'site';
  const assetHref = site ? ASSET_PATHS.asset : APP_ASSET_PATHS.asset;
  const values = r.items.some((i) => 'valueAtOut' in i);
  const out = r.items.filter((i) => !i.returnedAt);
  return (
    <div className="space-y-4">
      {done && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {done}
        </p>
      )}
      {!r.signed && (
        <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {NOT_SIGNED_TEXT}. Print the form, have {r.employee.fullNameEn} sign it, then attach a photo or a scan of the signed page.
        </p>
      )}

      {site && (
        <div className="flex flex-wrap gap-2">
          <Link href={CUSTODY_PATHS.form(r.code)} className="btn btn-primary">
            Print form
          </Link>
          <Link href={CUSTODY_PATHS.person(r.employee.id)} className="btn btn-secondary">
            What {r.employee.fullNameEn} holds
          </Link>
        </div>
      )}

      <Card title="Details">
        <dl>
          <DetailRow label="Employee">
            {r.employee.fullNameEn} {shownCode(r.employee.employeeCode) && <span className="text-muted">· {r.employee.employeeCode}</span>}
            {joinShown([r.employee.jobTitle, r.employee.department]) && <span className="block text-xs text-muted">{joinShown([r.employee.jobTitle, r.employee.department])}</span>}
          </DetailRow>
          <DetailRow label="Kind">{CUSTODY_KIND_LABELS[r.kind]}</DetailRow>
          <DetailRow label="Status">
            <CustodyStatusBadge status={r.status} />
          </DetailRow>
          <DetailRow label="Handed over">{formatDateTime(r.outAt)}</DetailRow>
          <DetailRow label="Return">
            <DueText r={r} />
          </DetailRow>
          {r.closedAt && <DetailRow label="Closed">{formatDateTime(r.closedAt)}</DetailRow>}
          <DetailRow label="Purpose">{r.purpose}</DetailRow>
          <DetailRow label="Handed over by">{r.handedOverBy}</DetailRow>
          <DetailRow label="Recorded by">{whoText(r.issuedBy)}</DetailRow>
          <DetailRow label="Notes">{r.notes && <span className="whitespace-pre-line">{r.notes}</span>}</DetailRow>
          {'valueAtOut' in r && <DetailRow label="Value when handed over">{valueText(r.valueAtOut)}</DetailRow>}
        </dl>
      </Card>

      <Card title="Items">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Condition Out</th>
                <th scope="col">Accessories</th>
                {values && (
                  <th scope="col" className="text-right">
                    Value
                  </th>
                )}
                <th scope="col">Return</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.id}>
                  <td className="min-w-48">
                    <Link href={assetHref(i.asset.code)} className="font-semibold">
                      {i.asset.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      <span className="font-mono">{i.asset.code}</span>
                      {i.asset.serial ? ` · S/N ${i.asset.serial}` : ''}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{i.conditionOut ? ASSET_CONDITION_LABELS[i.conditionOut] : <span className="text-muted">—</span>}</td>
                  <td className="min-w-32">
                    {checklistText(i.accessoriesOut) || i.accessories ? (
                      <>
                        {checklistText(i.accessoriesOut)}
                        {checklistText(i.accessoriesOut) && i.accessories ? <span className="block text-xs text-muted">{i.accessories}</span> : i.accessories}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  {values && <td className="text-right whitespace-nowrap tabular-nums">{valueText(i.valueAtOut)}</td>}
                  <td className="min-w-48">
                    <ItemReturn item={i} record={r} today={today} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Signed Copy" action={!r.signed ? <NotSignedBadge /> : undefined}>
        <div className="space-y-3">
          {r.files.length ? (
            <ul className="space-y-1 text-sm">
              {r.files.map((f) => (
                <li key={f.id}>
                  <a href={CUSTODY_PATHS.signedFile(r.code, f.id)} target="_blank" rel="noopener noreferrer" className="font-semibold">
                    {f.fileName}
                  </a>
                  <span className="text-muted">
                    {' '}
                    · {sizeText(f.sizeBytes)} · {formatDateTime(f.uploadedAt)}
                    {f.uploadedBy ? ` by ${whoText(f.uploadedBy)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No signed copy yet.</p>
          )}
          {r.can.attach && <SignedCopyAttach code={r.code} />}
        </div>
      </Card>

      {r.can.receive && out.length > 0 && (
        <Card title="Receive Back">
          <ReceiveForm action={receiveBack.bind(null, r.code, out.map((i) => ({ id: i.id, accessoriesOut: (i.accessoriesOut ?? []).map((a) => ({ quantity: a.quantity })) })))} items={out} />
        </Card>
      )}

      <Card title="Terms on the Form">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {r.terms.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">As they were when it was handed over.</p>
      </Card>
    </div>
  );
}
