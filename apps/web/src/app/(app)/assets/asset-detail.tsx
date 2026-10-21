import {
  ASSET_CLASS_LABELS,
  ASSET_CONDITION_LABELS,
  ASSET_GROUP_LABELS,
  ASSET_TYPE_LABELS,
  assetFieldsOf,
  assetLabelUrl,
  type AssetView,
} from '@trendlix/shared';
import Link from 'next/link';
import { DeleteForm } from '@/components/form';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { formatDate, formatDateTime } from '@/lib/format';
import { deleteAsset } from './actions';
import { PhotoManager } from './asset-photos';
import { bookValueText, doneText, holderText, moneyText, quantityText, warrantyText, yearsText } from './assets';
import { AssetQr, DetailRow, StatusBadge } from './ui';

// An asset's page (owner, 21 October 2026: "i want to add this module with a special permission to the system"; the
// spec's asset detail at /assets/[code]: "Photos, QR code, all fields, values table, custody history, maintenance log,
// actions"; "This is the URL inside the QR code"): its photos, its QR code, every field its group has, the values for
// the CEO, Finance and a Super Admin alone (the API leaves them out for everyone else), the places for its custody
// history and maintenance log (later steps), and what the caller may do now: Edit, Edit values, Print label, and a
// Super Admin's Delete (never for one that was in custody: it is disposed of instead). The site's page and the phone
// pages' show it alike (`surface`).

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
}: {
  asset: AssetView;
  surface: 'site' | 'app';
  /** YYYY-MM-DD in Cairo. */
  today: string;
  done?: string | null;
  photosFailed?: number | null;
}) {
  const fields = assetFieldsOf(asset.group);
  const said = doneText(done, asset.code, photosFailed);
  const site = surface === 'site';
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

          <Card title="Custody History">
            <p className="text-sm text-muted">Hand-overs and returns show here once custody is set up, a later step of Assets.</p>
          </Card>
          <Card title="Maintenance Log">
            <p className="text-sm text-muted">Repairs, services and inspections show here once repairs are set up, a later step of Assets.</p>
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
          {asset.can.delete && site && (
            <Card title="Delete">
              {asset.everInCustody ? (
                <p className="text-sm text-muted">It was in custody, so it stays on record: dispose of it instead (disposal is a later step of Assets).</p>
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
