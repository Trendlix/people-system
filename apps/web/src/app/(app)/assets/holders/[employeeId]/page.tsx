import { RETURN_CONDITION_LABELS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ASSET_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { formatDateTime, titleCase } from '@/lib/format';
import { BackLink } from '../../../organization/ui';
import { todayInCairo } from '../../../employees/ui';
import { deductionText, itemsText, returnTone, valueText, whoText } from '../../custody';
import { incidentDeductionHref, missingAccessoriesText } from '../../upkeep';
import { loadHoldings } from '../../custody-data';
import { CustodyTable, HeldTable } from '../../custody-ui';
import { assetsCaller, assetsNotLoaded } from '../../data';
import { Empty, Loading, NoAccess } from '../../ui';

// A person's holdings (Assets step 3; the spec's Employee holdings: "Current holdings, damaged/missing history, custody
// history, actions: hand over, print custody statement"): what they hold now (since when, until when, overdue), the
// items that came back damaged or missing (they stay on the person's record, spec §6.4; for HR, "Create a deduction":
// owner, 21 October 2026, "Record it; HR decides a deduction"), and every custody record of theirs. Step 4 (22 October
// 2026: accessories): an item back without some of its accessories is listed too, with what didn't come back. The values only when
// the API sent them (the CEO, Finance and a Super Admin). A C-level person's only for those who see them (404 else).

export const metadata: Metadata = { title: 'Holdings · People System' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function Person({ params }: { params: PageProps<'/assets/holders/[employeeId]'>['params'] }) {
  const { employeeId } = await params;
  if (!UUID.test(employeeId)) notFound();
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const loaded = await loadHoldings(employeeId);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'holdings')}</Empty>;
  const h = loaded.value;
  const today = todayInCairo();
  const overdue = h.current.filter((c) => c.overdue).length;
  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{titleCase(h.employee.fullNameEn)}</h1>
        <p className="text-sm text-muted">{[h.employee.employeeCode, h.employee.jobTitle, h.employee.department].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {h.can.handOver && (
          <Link href={CUSTODY_PATHS.newWith({ employee: h.employee.id })} className="btn btn-primary">
            Hand over
          </Link>
        )}
        <Link href={CUSTODY_PATHS.statement(h.employee.id)} className="btn btn-secondary">
          Print custody statement
        </Link>
      </div>

      <Card
        title="Holds Now"
        action={
          <span className="text-sm text-muted tabular-nums">
            {itemsText(h.current.length)}
            {overdue ? ` · ${overdue} overdue` : ''}
            {'value' in h ? ` · ${valueText(h.value)}` : ''}
          </span>
        }
      >
        {h.current.length ? <HeldTable items={h.current} assetHref={ASSET_PATHS.asset} recordHref={CUSTODY_PATHS.record} /> : <p className="text-sm text-muted">Holds nothing now.</p>}
      </Card>

      <Card title="Damaged and Missing">
        {h.incidents.length ? (
          <ul className="divide-y divide-line-soft">
            {h.incidents.map((i) => (
              <li key={i.itemId} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 space-y-1">
                  <p>
                    <Link href={ASSET_PATHS.asset(i.asset.code)} className="font-semibold">
                      {i.asset.name}
                    </Link>{' '}
                    <span className="font-mono text-xs text-muted">{i.asset.code}</span>{' '}
                    <span className={`badge ${returnTone(i.condition)}`}>{RETURN_CONDITION_LABELS[i.condition]}</span>
                  </p>
                  <p className="text-xs text-muted">
                    On <Link href={CUSTODY_PATHS.record(i.custodyCode)}>{i.custodyCode}</Link>, received back {formatDateTime(i.returnedAt)}
                    {i.receivedBy ? ` by ${whoText(i.receivedBy)}` : ''}
                    {'valueAtOut' in i ? ` · value when handed over ${valueText(i.valueAtOut)}` : ''}
                  </p>
                  {missingAccessoriesText(i.missingAccessories) && <p className="text-sm text-warn">{missingAccessoriesText(i.missingAccessories)}</p>}
                  {i.notes && <p className="text-sm">{i.notes}</p>}
                  {i.deductions && i.deductions.length > 0 && (
                    <ul className="text-xs text-muted">
                      {i.deductions.map((d) => (
                        <li key={d.id}>Deduction: {deductionText(d)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {h.can.deduction && (() => {
                  const href = incidentDeductionHref(
                    { employeeId: h.employee.id, itemId: i.itemId, condition: i.condition, missing: i.missingAccessories, assetCode: i.asset.code, custodyCode: i.custodyCode },
                    today,
                  );
                  return href ? (
                    <Link href={href} className="btn btn-secondary">
                      Create a deduction
                    </Link>
                  ) : null;
                })()}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing came back damaged or missing.</p>
        )}
      </Card>

      <section className="space-y-3">
        <h2 className="font-semibold">Custody History</h2>
        {h.records.length ? <CustodyTable rows={h.records} href={CUSTODY_PATHS.record} person={false} /> : <Empty>No custody records yet.</Empty>}
      </section>
    </>
  );
}

export default function HoldingsPage({ params }: PageProps<'/assets/holders/[employeeId]'>) {
  return (
    <div className="max-w-6xl space-y-4">
      <BackLink href={CUSTODY_PATHS.holders}>Holdings</BackLink>
      <Suspense fallback={<Loading />}>
        <Person params={params} />
      </Suspense>
    </div>
  );
}
