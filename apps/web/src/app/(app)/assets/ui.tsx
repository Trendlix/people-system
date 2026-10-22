import {
  ASSET_GROUP_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_TYPE_LABELS,
  productImageLabel,
  type AssetListView,
  type AssetPhotoRef,
  type AssetRowView,
  type AssetStatus,
} from '@trendlix/shared';
import Link from 'next/link';
import { assetPhotoSrc } from '@/lib/asset-paths';
import { assetQrSvg } from '@/lib/asset-qr';
import { Empty, Loading } from '../organization/ui';
import { countText, holderText, moneyText, pagesOf, placeText, quantityText, rowBookText, statusTone, type ReadQuery } from './assets';

// Small building blocks shared by the Assets pages (owner, 21 October 2026: "i want to add this module with a special
// permission to the system"): the status badge, the photo thumbnail, the register's table (money only for those who
// see the values: the API leaves it out for everyone else), the QR code, and what a page says without access.

export { Empty, Loading };

export function StatusBadge({ status }: { status: AssetStatus }) {
  return <span className={`badge ${statusTone(status)}`}>{ASSET_STATUS_LABELS[status]}</span>;
}

/**
 * The photo the lists show (the asset's first), or a camera outline when it has none. The maker's product image (from a
 * draft from Claude, 21 October 2026) carries a small "Product image" badge: it shows the model, not the item itself.
 */
export function AssetThumb({ code, photo, size = 'size-12' }: { code: string; photo: AssetPhotoRef | null; size?: string }) {
  if (!photo) {
    return (
      <span aria-hidden="true" className={`flex ${size} shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-muted`}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
          <circle cx="12" cy="13.5" r="3.5" />
        </svg>
      </span>
    );
  }
  if (photo.product) {
    return (
      <span className="inline-flex shrink-0 flex-col items-center gap-0.5" title={productImageLabel(photo.product.sourceHost)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the website with the caller's session (app/asset-photo) */}
        <img src={assetPhotoSrc(code, photo.id)} alt="" loading="lazy" className={`${size} rounded-lg border border-line bg-white object-contain`} />
        <span className="badge max-w-16 px-1.5 py-0 text-center text-[10px] leading-tight whitespace-normal">Product image</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- served by the website with the caller's session (app/asset-photo)
  return <img src={assetPhotoSrc(code, photo.id)} alt="" loading="lazy" className={`${size} shrink-0 rounded-lg border border-line bg-canvas object-cover`} />;
}

/** Without Assets access: what the page says (the API refuses anyway). */
export function NoAccess() {
  return <Empty>You don&apos;t have access to Assets. An Admin gives it on the Users page.</Empty>;
}

/**
 * The register as a table: the photo, the code and name (with the group and type), the status, the room and kit, the
 * serial, who holds it, and for those who see the values the market and book value. Each opens the asset's page.
 */
export function AssetTable({ rows, values, href }: { rows: AssetRowView[]; values: boolean; href: (code: string) => string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Photo</span>
            </th>
            <th scope="col">Asset</th>
            <th scope="col">Status</th>
            <th scope="col">Room · Kit</th>
            <th scope="col">Serial</th>
            <th scope="col">Holder</th>
            {values && (
              <>
                <th scope="col" className="text-right">
                  Market Value
                </th>
                <th scope="col" className="text-right">
                  Book Value
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="w-16">
                <AssetThumb code={a.code} photo={a.photo} />
              </td>
              <td className="min-w-56">
                <Link href={href(a.code)} className="font-semibold">
                  {a.name}
                </Link>
                <span className="block text-xs text-muted">
                  <span className="font-mono">{a.code}</span> · {ASSET_GROUP_LABELS[a.group]} · {ASSET_TYPE_LABELS[a.type] ?? a.type}
                </span>
                {/* step 4 (22 October 2026: accessories): the main asset it goes out with */}
                {a.parent && (
                  <span className="block text-xs text-muted">
                    Attached to <span className="font-mono">{a.parent.code}</span> {a.parent.name}
                  </span>
                )}
                {a.group === 'consumable' && (
                  <span className="mt-0.5 block text-xs tabular-nums">
                    {quantityText(a.quantity, a.unit)}
                    {a.reorder && <span className="badge ml-1.5 bg-warn-soft text-warn">Reorder</span>}
                  </span>
                )}
              </td>
              <td>
                <StatusBadge status={a.status} />
              </td>
              <td className="min-w-32">{placeText(a) ?? <span className="text-muted">—</span>}</td>
              <td className="font-mono text-xs break-all">{a.serial ?? <span className="font-sans text-muted">—</span>}</td>
              <td className="min-w-32">{holderText(a.holder) ?? <span className="text-muted">—</span>}</td>
              {values && (
                <>
                  <td className="text-right whitespace-nowrap tabular-nums">{a.values ? moneyText(a.values.marketValue) : '—'}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">{a.values ? rowBookText(a.values) : '—'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The asset's QR code (its page's address), drawn on the server; `className` sizes it. */
export async function AssetQr({ code, className = 'size-40' }: { code: string; className?: string }) {
  const svg = await assetQrSvg(code);
  return (
    <div role="img" aria-label={`QR code opening the page of ${code}`} className={`${className} [&>svg]:block [&>svg]:size-full`} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/** A row of the asset's details: a label and its value (a dash when there is none). */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '' || children === false;
  return (
    <div className="grid gap-1 border-b border-line-soft py-2.5 last:border-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{empty ? <span className="text-muted">—</span> : children}</dd>
    </div>
  );
}

/** How many the register lists, and the pages before and after. */
export function Pages({ list, query, listHref }: { list: AssetListView; query: ReadQuery; listHref?: Parameters<typeof pagesOf>[2] }) {
  const pages = pagesOf(list, query, listHref);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted tabular-nums">
        {countText(list)}, by code{pages.count > 1 ? ` · page ${list.page} of ${pages.count}` : ''}.
      </p>
      {pages.count > 1 && (
        <nav aria-label="Pages" className="flex gap-2">
          {pages.previous ? (
            <Link href={pages.previous} className="btn btn-secondary">
              Previous
            </Link>
          ) : null}
          {pages.next ? (
            <Link href={pages.next} className="btn btn-secondary">
              Next
            </Link>
          ) : null}
        </nav>
      )}
    </div>
  );
}

/** What the page says while it loads. */
export const AssetsLoading = Loading;
