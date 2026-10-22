import {
  ASSET_CLASS_LABELS,
  ASSET_CONDITION_LABELS,
  ASSET_GROUP_LABELS,
  ASSET_TYPE_LABELS,
  assetFieldsOf,
  assetLabelUrl,
  type AssetHistoryView,
  type AssetView,
} from '@trendlix/shared';
import Link from 'next/link';
import { DeleteForm } from '@/components/form';
import { APP_ASSET_PATHS, APP_CUSTODY_PATHS, ASSET_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { formatDate, formatDateTime } from '@/lib/format';
import { deleteAsset } from './actions';
import { AssetActions } from './asset-actions';
import { CustodyHistoryList, MaintenanceList } from './asset-history';
import { PhotoManager } from './asset-photos';
import { assetPageAction } from './custody-actions';
import { bookValueText, doneText, holderText, moneyText, quantityText, warrantyText, yearsText } from './assets';
import { AssetQr, DetailRow, StatusBadge } from './ui';
import { deltaText, disposalText } from './upkeep';
import { AccessoriesSection, AttachItemForm, AttachToForm, DetachButton, DisposalAmountForm, DisposeForm, MaintenanceEntry, StockActions } from './upkeep-ui';

// An asset's page (owner, 21 October 2026: "i want to add this module with a special permission to the system"; the
// spec's asset detail at /assets/[code]: "Photos, QR code, all fields, values table, custody history, maintenance log,
// actions"; "This is the URL inside the QR code"): its photos, its QR code, every field its group has, the values for
// the CEO, Finance and a Super Admin alone (the API leaves them out for everyone else), its custody history and
// maintenance log, and what the caller may do now: Edit, Edit values, Print label, and a
// Super Admin's Delete (never for one that was in custody: it is disposed of instead). The site's page and the phone
// pages' show it alike (`surface`). Since step 3 (custody, 21 October 2026): its custody history and maintenance log
// (`history`, GET /assets/:code/history; null when it couldn't be read), and for a custodian or a manager Hand over,
// Send to repair and Back from repair, Mark lost and Mark found, each while its status allows it. Step 4 (22 October
// 2026: accessories, "Both kinds"; "kits / stock / repairs / disposal"): its accessories' checklist, the main asset it is
// attached to or the assets attached to it (attach and detach), a consumable's stock with Use and Restock and its moves,
// a maintenance entry by hand, and disposal (an Assets manager's; once disposed, how and when, the amount and the book
// value then for the CEO, Finance and a Super Admin).

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

/** A line of the values: its label, and its value on the right (the card is a narrow column beside the details). */
function ValueRow({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{empty ? <span className="text-muted">—</span> : children}</dd>
    </div>
  );
}

const amount = (value: number | null) => (value === null ? null : <span className="whitespace-nowrap tabular-nums">{moneyText(value)}</span>);

/** The values (the CEO, Finance, a Super Admin): the purchase, the market value with its note, and the book value. */
function ValuesCard({ asset, surface }: { asset: AssetView; surface: 'site' | 'app' }) {
  const v = asset.values;
  if (!v) return null;
  return (
    <Card
      title="Values"
      action={
        asset.can.values && surface === 'site' ? (
          <Link href={ASSET_PATHS.values(asset.code)} className="text-sm font-semibold">
            Edit values
          </Link>
        ) : undefined
      }
    >
      <p className="mb-2 text-xs text-muted">Only the CEO, Finance and a Super Admin see these. All in EGP.</p>
      <dl>
        <ValueRow label="Purchase cost">{amount(v.purchasePrice)}</ValueRow>
        <ValueRow label="Supplier">{v.supplier}</ValueRow>
        <ValueRow label="Invoice number">{v.invoiceNo}</ValueRow>
        <ValueRow label="Market value (low)">{amount(v.priceLow)}</ValueRow>
        <ValueRow label="Market value">{amount(v.marketValue)}</ValueRow>
        <ValueRow label="Market value (high)">{amount(v.priceHigh)}</ValueRow>
        <ValueRow label="Updated">{v.priceUpdatedAt ? formatDateTime(v.priceUpdatedAt) : null}</ValueRow>
        <ValueRow label="Book value">
          <span className={v.bookValue.amount === null && !v.bookValue.expensed ? 'text-muted' : 'font-semibold whitespace-nowrap tabular-nums'}>{bookValueText(v.bookValue)}</span>
        </ValueRow>
      </dl>
      {v.priceNote && (
        <p className="mt-3 text-sm">
          <span className="text-muted">How the market value was reached: </span>
          {v.priceNote}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Book value: straight line over its useful life from the purchase date; 0 (Expensed) below the capitalization threshold.</p>
    </Card>
  );
}

export function AssetDetail({
  asset,
  surface,
  today,
  done,
  photosFailed,
  history = null,
  values = false,
}: {
  asset: AssetView;
  surface: 'site' | 'app';
  /** YYYY-MM-DD in Cairo. */
  today: string;
  done?: string | null;
  photosFailed?: number | null;
  /** Its custody history, maintenance log and actions (step 3); null: not read (an API from before it). */
  history?: AssetHistoryView | null;
  /** Whether the caller sees the values (a repair's cost). */
  values?: boolean;
}) {
  const fields = assetFieldsOf(asset.group);
  const said = doneText(done, asset.code, photosFailed);
  const site = surface === 'site';
  const handOverHref = (site ? CUSTODY_PATHS : APP_CUSTODY_PATHS).newWith({ asset: asset.code });
  const act = (kind: 'repair' | 'back' | 'lost' | 'found') => assetPageAction.bind(null, asset.code, kind, values);
  return (
    <div className="space-y-4">
      {said && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${photosFailed ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {said}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {asset.can.edit && (
          <Link href={ASSET_PATHS.edit(asset.code)} className="btn btn-primary">
            Edit
          </Link>
        )}
        {history?.can.hand_over && (
          <Link href={handOverHref} className="btn btn-secondary">
            Hand over
          </Link>
        )}
        {asset.can.values && site && (
          <Link href={ASSET_PATHS.values(asset.code)} className="btn btn-secondary">
            Edit values
          </Link>
        )}
        {site && (
          <Link href={ASSET_PATHS.label(asset.code)} className="btn btn-secondary">
            Print label
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card title="Photos">
            <PhotoManager code={asset.code} photos={asset.photos} canAdd={asset.can.photos} canDelete={asset.can.delete && site} />
          </Card>

          <Card title="Details">
            <dl>
              <DetailRow label="Group">{ASSET_GROUP_LABELS[asset.group]}</DetailRow>
              <DetailRow label="Type">
                {ASSET_TYPE_LABELS[asset.type] ?? asset.type} <span className="font-mono text-xs text-muted">{asset.type}</span>
              </DetailRow>
              <DetailRow label="Accounting class">{ASSET_CLASS_LABELS[asset.assetClass]}</DetailRow>
              <DetailRow label="Brand">{asset.brand}</DetailRow>
              <DetailRow label="Model">{asset.model}</DetailRow>
              {fields.serial && <DetailRow label="Serial number">{asset.serial && <span className="font-mono">{asset.serial}</span>}</DetailRow>}
              {fields.condition && <DetailRow label="Condition">{asset.condition && ASSET_CONDITION_LABELS[asset.condition]}</DetailRow>}
              <DetailRow label="Status">
                <StatusBadge status={asset.status} />
              </DetailRow>
              <DetailRow label="Room">{asset.room?.name}</DetailRow>
              {fields.kit && (
                <DetailRow label="Kit">
                  {asset.kit && (
                    <>
                      <span className="font-mono text-xs">{asset.kit.code}</span> {asset.kit.name}
                    </>
                  )}
                </DetailRow>
              )}
              <DetailRow label="Held by">{holderText(asset.holder)}</DetailRow>
              {asset.parent && (
                <DetailRow label="Attached to">
                  <Link href={site ? ASSET_PATHS.asset(asset.parent.code) : APP_ASSET_PATHS.asset(asset.parent.code)} className="font-mono text-sm font-semibold">
                    {asset.parent.code}
                  </Link>{' '}
                  {asset.parent.name}
                </DetailRow>
              )}
              {asset.disposal && <DetailRow label="Disposed">{disposalText(asset.disposal)}</DetailRow>}
              {fields.stock && (
                <>
                  <DetailRow label="Quantity">
                    <span className="tabular-nums">{quantityText(asset.quantity, asset.unit)}</span>
                    {asset.reorder && <span className="badge ml-2 bg-warn-soft text-warn">Reorder</span>}
                  </DetailRow>
                  <DetailRow label="Reorder level">{asset.reorderLevel === null ? null : <span className="tabular-nums">{quantityText(asset.reorderLevel, asset.unit)}</span>}</DetailRow>
                </>
              )}
              <DetailRow label="Purchase date">{formatDate(asset.purchaseDate)}</DetailRow>
              {fields.usefulLife && <DetailRow label="Useful life">{asset.usefulLifeYears === null ? null : yearsText(asset.usefulLifeYears)}</DetailRow>}
              <DetailRow label="Warranty">{warrantyText(asset.warrantyEnd, today)}</DetailRow>
              <DetailRow label="Labelled">{asset.labeledAt ? formatDateTime(asset.labeledAt) : 'Not yet'}</DetailRow>
              <DetailRow label="Notes">{asset.notes && <span className="whitespace-pre-line">{asset.notes}</span>}</DetailRow>
              <DetailRow label="Registered">
                <>
                  {formatDateTime(asset.createdAt)}
                  {asset.createdBy && <span className="text-muted"> by {asset.createdBy.name ?? asset.createdBy.email}</span>}
                </>
              </DetailRow>
              <DetailRow label="Last changed">{formatDateTime(asset.updatedAt)}</DetailRow>
            </dl>
          </Card>

          {!fields.stock && asset.accessories && (
            <Card title="Accessories">
              <AccessoriesSection code={asset.code} group={asset.group} accessories={asset.accessories} canEdit={!!asset.can.accessories && site} />
            </Card>
          )}

          {!fields.stock && (asset.parent || (asset.attached?.length ?? 0) > 0 || asset.can.attach) && (
            <Card title="Attached Items">
              <div className="space-y-4">
                {asset.parent ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      It is attached to{' '}
                      <Link href={site ? ASSET_PATHS.asset(asset.parent.code) : APP_ASSET_PATHS.asset(asset.parent.code)} className="font-mono font-semibold">
                        {asset.parent.code}
                      </Link>{' '}
                      {asset.parent.name}: it goes out with it on a handover, and can still be handed over alone.
                    </p>
                    {asset.can.attach && site && <DetachButton code={asset.code} mainCode={asset.parent.code} />}
                  </div>
                ) : asset.attached && asset.attached.length > 0 ? (
                  <ul className="divide-y divide-line-soft">
                    {asset.attached.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                        <span>
                          <Link href={site ? ASSET_PATHS.asset(a.code) : APP_ASSET_PATHS.asset(a.code)} className="font-mono text-sm font-semibold">
                            {a.code}
                          </Link>{' '}
                          {a.name}
                          {a.holder && <span className="block text-xs text-muted">With {a.holder}</span>}
                        </span>
                        <StatusBadge status={a.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nothing is attached to it. Valuable accessories with their own code (a battery, a monitor) can be attached, to go out with it.</p>
                )}
                {asset.can.attach && site && !asset.parent && <AttachItemForm code={asset.code} />}
                {asset.can.attach && site && !asset.parent && !(asset.attached?.length ?? 0) && <AttachToForm code={asset.code} />}
              </div>
            </Card>
          )}

          {fields.stock && (
            <Card title="Stock">
              <div className="space-y-4">
                <p className="text-sm">
                  <span className="text-2xl font-semibold tabular-nums">{quantityText(asset.quantity, asset.unit)}</span>
                  {asset.reorder && <span className="badge ml-2 bg-warn-soft text-warn">Reorder</span>}
                </p>
                {asset.can.stock && <StockActions code={asset.code} quantity={asset.quantity ?? 0} unit={asset.unit} />}
                {history?.stockMoves && history.stockMoves.length > 0 ? (
                  <ul aria-label="Stock moves" className="divide-y divide-line-soft">
                    {history.stockMoves.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
                        <span>
                          <span className={`font-semibold tabular-nums ${m.delta < 0 ? 'text-warn' : 'text-ok'}`}>{deltaText(m.delta, asset.unit)}</span>
                          <span className="text-muted"> · {quantityText(m.quantityAfter, asset.unit)} after</span>
                          {m.note && <span className="block">{m.note}</span>}
                        </span>
                        <span className="text-xs text-muted">
                          {formatDateTime(m.at)}
                          {m.by ? ` · ${m.by.name ?? m.by.email}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No stock moves yet.</p>
                )}
              </div>
            </Card>
          )}

          <Card title="Custody History">
            {history ? <CustodyHistoryList history={history} surface={surface} /> : <p className="text-sm text-muted">The custody history could not be loaded.</p>}
          </Card>
          <Card title="Maintenance Log">
            <div className="space-y-4">
              {history ? <MaintenanceList history={history} surface={surface} /> : <p className="text-sm text-muted">The maintenance log could not be loaded.</p>}
              {history && (
                <AssetActions
                  can={history.can}
                  values={values}
                  actions={{ send_to_repair: act('repair'), back_from_repair: act('back'), mark_lost: act('lost'), mark_found: act('found') }}
                />
              )}
              {asset.can.maintenance && asset.status !== 'disposed' && <MaintenanceEntry code={asset.code} values={values} />}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card title="QR Code">
            <div className="flex flex-col items-center gap-3 text-center">
              <AssetQr code={asset.code} className="size-44" />
              <p className="font-mono text-sm font-semibold">{asset.code}</p>
              <p className="text-xs break-all text-muted">{assetLabelUrl(asset.code)}</p>
              {site && (
                <Link href={ASSET_PATHS.label(asset.code)} className="text-sm font-semibold">
                  Print label
                </Link>
              )}
            </div>
          </Card>
          <ValuesCard asset={asset} surface={surface} />
          {asset.disposal ? (
            <Card title="Disposal">
              <dl>
                <DetailRow label="How">{disposalText(asset.disposal)}</DetailRow>
                <DetailRow label="Approved by">{asset.disposal.approvedBy}</DetailRow>
                <DetailRow label="Notes">{asset.disposal.notes && <span className="whitespace-pre-line">{asset.disposal.notes}</span>}</DetailRow>
                <DetailRow label="Recorded by">{asset.disposal.by ? (asset.disposal.by.name ?? asset.disposal.by.email) : null}</DetailRow>
                {'amount' in asset.disposal && <DetailRow label="Amount received">{asset.disposal.amount === null || asset.disposal.amount === undefined ? null : moneyText(asset.disposal.amount)}</DetailRow>}
                {'bookValue' in asset.disposal && (
                  <DetailRow label="Book value then">{asset.disposal.bookValue === null || asset.disposal.bookValue === undefined ? null : moneyText(asset.disposal.bookValue)}</DetailRow>
                )}
              </dl>
              {asset.can.values && site && (
                <div className="mt-3">
                  <DisposalAmountForm code={asset.code} amount={asset.disposal.amount ?? null} />
                </div>
              )}
            </Card>
          ) : (
            asset.can.dispose &&
            site && (
              <Card title="Dispose">
                <div className="space-y-3">
                  <p className="text-sm text-muted">Sold, scrapped, written off or donated: it stays on record, out of every total and list but Disposed.</p>
                  <DisposeForm
                    code={asset.code}
                    name={asset.name}
                    values={asset.can.values}
                    purchaseDate={asset.purchaseDate}
                    inKit={asset.kit?.code ?? null}
                    attached={asset.attached?.length ?? 0}
                  />
                </div>
              </Card>
            )
          )}
          {asset.can.delete && site && (
            <Card title="Delete">
              {asset.everInCustody ? (
                <p className="text-sm text-muted">It was in custody, so it stays on record: dispose of it instead.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted">For an asset registered by mistake. Its code is never given again. An asset that was in custody can&apos;t be deleted.</p>
                  <DeleteForm
                    action={deleteAsset.bind(null, asset.code)}
                    confirmText={`Delete ${asset.code} ${asset.name}? Its photos go with it. This can't be undone.`}
                    label="Delete asset"
                  />
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
