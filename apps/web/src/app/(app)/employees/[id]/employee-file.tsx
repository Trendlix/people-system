import Link from 'next/link';
import { LABELS, PAPERWORK_LABELS, requiredPaperwork, RESTRICTED_PAPERWORK, type PaperworkKind } from '@trendlix/shared';
import { DocumentViewer, type ViewerFile } from '@/components/document-viewer';
import { ApiError, apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, PaperworkItem } from '@/lib/types';
import { describePaperwork } from '../paper-details-actions';
import { formatSize, idScanTitle, OCR_LABEL, paperworkHref } from '../paperwork';
import { deletePaperwork, deletePaperworkItems, rereadPaperwork, uploadPaperwork } from '../paperwork-actions';
import { EXPIRY_WARNING_DAYS, ExpiryChip, Loading, ProfileSection } from '../ui';
import { DeleteFileButton, RereadButton, UploadPaperworkForm } from './employee-file-forms';
import { PaperDetails } from './inline-forms';

// The Documents tab: the employee file (scanned paperwork, spec §8.5) as a checklist of papers for the current
// employment type (requiredPaperwork), each with its number and expiry, whether it is uploaded, and its files. HR and
// the CEO see it (the API checks this again); only HR uploads, deletes and sets a paper's number and expiry. The
// national ID's number and expiry are the profile's own (changed on the National ID page).

type Employee = Pick<EmployeeProfile, 'id' | 'fullNameEn' | 'employment' | 'gender' | 'access' | 'identity'>;

const label = (kind: PaperworkKind) => PAPERWORK_LABELS[kind] ?? kind;
const NATIONAL_ID: readonly PaperworkKind[] = ['national_id_front', 'national_id_back'];

/** A paper of the checklist: one kind, or the national ID's two sides together. */
type Paper = { key: string; label: string; kinds: PaperworkKind[] };

function Title({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 className="font-semibold">
        Employee File
        <span className="badge ml-2 bg-line-soft align-middle text-muted">Restricted</span>
      </h2>
      {children && <span className="text-xs text-muted">{children}</span>}
    </div>
  );
}

export function EmployeeFileLoading() {
  return (
    <div className="space-y-3">
      <Title />
      <Loading />
    </div>
  );
}

/**
 * The other side of a national ID scan: the file of the other side uploaded closest in time to it (both sides are
 * usually uploaded together).
 */
function otherSide(item: PaperworkItem, other: PaperworkItem[]): PaperworkItem | undefined {
  const gap = (x: PaperworkItem) => Math.abs(Date.parse(x.uploadedAt) - Date.parse(item.uploadedAt));
  return other.reduce<PaperworkItem | undefined>((best, x) => (!best || gap(x) < gap(best) ? x : best), undefined);
}

/** A file as the document viewer shows it; `side`: which side of the national ID card it is. */
const viewed = (item: PaperworkItem, side?: 'Front' | 'Back'): ViewerFile => ({
  label: side,
  alt: side ? `${side} of the national ID card` : label(item.kind),
  src: paperworkHref(item.id),
  mimeType: item.mimeType,
});

/** One uploaded file: when, its name, size, uploader and whether its text was read; View, and for HR re-read and delete. */
function FileLine({ item, owner, canEdit }: { item: PaperworkItem; owner: string; canEdit: boolean }) {
  const name = label(item.kind);
  const view = { title: `${name} · ${owner}`, files: [viewed(item)], what: name };
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-semibold text-ok">
            <span aria-hidden="true">✓ </span>Uploaded
          </span>{' '}
          <span className="text-muted tabular-nums">{formatDate(item.uploadedAt)}</span>
        </p>
        <p className="text-xs break-all text-muted">
          <bdi>{item.fileName}</bdi> · {formatSize(item.sizeBytes)}
          {item.uploadedBy && ` · by ${item.uploadedBy.email}`} · {OCR_LABEL[item.ocrStatus] ?? OCR_LABEL.pending}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        {/* Loaded only when opened: each download of a national ID scan is written to the audit log. */}
        <DocumentViewer title={view.title} files={view.files}>
          View<span className="sr-only"> {view.what}</span>
        </DocumentViewer>
        {canEdit && item.ocrStatus !== 'done' && <RereadButton action={rereadPaperwork.bind(null, item.id)} name={name} />}
        {canEdit && (
          <DeleteFileButton
            action={deletePaperwork.bind(null, item.id)}
            name={name}
            confirmText={`Delete ${name} (${item.fileName}) from the employee file? This cannot be undone.`}
          />
        )}
      </div>
    </div>
  );
}

/** A national ID scan: one document, its front and back (either may be missing), uploaded together. */
type IdScan = { front?: PaperworkItem; back?: PaperworkItem };
const scannedOn = (scan: IdScan) => (scan.front ?? scan.back)!.uploadedAt;

/** The national ID's scans, newest first: each front with the back uploaded closest in time to it, then any back left over. */
function idScans(fronts: PaperworkItem[], backs: PaperworkItem[]): IdScan[] {
  const left = [...backs];
  const scans: IdScan[] = fronts.map((front) => {
    const back = otherSide(front, left);
    if (back) left.splice(left.indexOf(back), 1);
    return { front, back };
  });
  return [...scans, ...left.map((back) => ({ back }))].sort((a, b) => Date.parse(scannedOn(b)) - Date.parse(scannedOn(a)));
}

/**
 * A national ID scan as one document: when, its files, whether their text was read; View opens both sides together,
 * and for HR, Delete removes both (and Re-read reads a side whose text wasn't read).
 */
function IdScanLine({ scan, owner, canEdit }: { scan: IdScan; owner: string; canEdit: boolean }) {
  const { front, back } = scan;
  const items = [front, back].filter((x): x is PaperworkItem => !!x);
  const sides = front && back ? 'front and back' : front ? 'front only' : 'back only';
  const files = [front && viewed(front, 'Front'), back && viewed(back, 'Back')].filter((f): f is ViewerFile => !!f);
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-semibold text-ok">
            <span aria-hidden="true">✓ </span>Uploaded
          </span>
          <span className="text-muted tabular-nums">{formatDate(scannedOn(scan))}</span>
          <span className="text-muted">· {sides}</span>
          {!(front && back) && <span className="badge bg-warn-soft text-warn">{front ? 'Back missing' : 'Front missing'}</span>}
        </p>
        {items.map((item) => (
          <p key={item.id} className="text-xs break-all text-muted">
            {item.kind === 'national_id_front' ? 'Front' : 'Back'}: <bdi>{item.fileName}</bdi> · {formatSize(item.sizeBytes)}
            {item.uploadedBy && ` · by ${item.uploadedBy.email}`} · {OCR_LABEL[item.ocrStatus] ?? OCR_LABEL.pending}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        {/* Loaded only when opened: each download of a national ID scan is written to the audit log. */}
        <DocumentViewer title={idScanTitle({ front: !!front, back: !!back }, owner)} files={files}>
          View<span className="sr-only"> the national ID scan</span>
        </DocumentViewer>
        {canEdit &&
          items
            .filter((item) => item.ocrStatus !== 'done')
            .map((item) => <RereadButton key={item.id} action={rereadPaperwork.bind(null, item.id)} name={label(item.kind)} />)}
        {canEdit && (
          <DeleteFileButton
            action={deletePaperworkItems.bind(null, items.map((item) => item.id))}
            name="the national ID scan"
            confirmText={`Delete this national ID scan (${sides}) from the employee file? This cannot be undone.`}
          />
        )}
      </div>
    </div>
  );
}

/** "No. 12345 · Expires 01/01/2027 [Valid]", or "No expiry". */
function DetailsLine({ number, expiry, today }: { number: string | null | undefined; expiry: string | null | undefined; today: string }) {
  return (
    <>
      {number && (
        <span className="text-sm">
          <span className="text-muted">No.</span> <span className="tabular-nums">{number}</span>
        </span>
      )}
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        {expiry && (
          <span>
            <span className="text-muted">Expires</span> <span className="tabular-nums">{formatDate(expiry)}</span>
          </span>
        )}
        <ExpiryChip expiry={expiry ?? null} today={today} />
      </span>
    </>
  );
}

/** Where a paper's expiry stands, for the notice above the list. */
function expiryState(expiry: string | null | undefined, today: string): 'expired' | 'soon' | null {
  if (!expiry) return null;
  const days = (Date.parse(expiry) - Date.parse(today)) / 86_400_000;
  return days < 0 ? 'expired' : days <= EXPIRY_WARNING_DAYS ? 'soon' : null;
}

export async function EmployeeFile({ employee, today }: { employee: Employee; today: string }) {
  let items: PaperworkItem[];
  try {
    items = await apiGet<PaperworkItem[]>(`/employees/${employee.id}/paperwork`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // The rest of the profile stays usable.
    return (
      <div className="space-y-3">
        <Title />
        <p className="card p-6 text-sm text-muted">The employee file could not be loaded. Please try again in a moment.</p>
      </div>
    );
  }

  const type = employee.employment?.employmentType ?? null;
  const required = requiredPaperwork(type, employee.gender);
  const byKind = new Map<PaperworkKind, PaperworkItem[]>();
  for (const item of items) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]); // newest first, as listed
  const others = items.filter((item) => !required.includes(item.kind));
  const canEdit = employee.access.edit;

  // The national ID's two sides are one paper, with the number and expiry of the profile's national ID.
  const idKinds = required.filter((k) => NATIONAL_ID.includes(k));
  const papers: Paper[] = [
    ...(idKinds.length > 0 ? [{ key: 'national_id', label: 'National ID', kinds: idKinds }] : []),
    ...required.filter((k) => !NATIONAL_ID.includes(k)).map((k) => ({ key: k, label: label(k), kinds: [k] })),
  ];
  // The national ID counts as uploaded once both its sides are: it is one paper, like the others.
  const uploaded = papers.filter((paper) => paper.kinds.every((k) => byKind.has(k))).length;
  // A paper's number and expiry are its newest file's.
  const newest = (kind: PaperworkKind) => byKind.get(kind)?.[0];
  const expiryOf = (paper: Paper) => (paper.key === 'national_id' ? employee.identity?.expiryDate : newest(paper.kinds[0])?.expiresOn);

  const dated = (state: 'expired' | 'soon') =>
    [
      ...papers.filter((paper) => expiryState(expiryOf(paper), today) === state).map((paper) => ({ label: paper.label, expiry: expiryOf(paper)! })),
      ...others.filter((item) => expiryState(item.expiresOn, today) === state).map((item) => ({ label: label(item.kind), expiry: item.expiresOn! })),
    ]
      .map((x) => `${x.label} (${formatDate(x.expiry)})`)
      .join(', ');
  const expired = dated('expired');
  const soon = dated('soon');

  return (
    <div className="space-y-4">
      <Title>
        <span className="tabular-nums">
          {uploaded} of {papers.length} uploaded
        </span>
      </Title>
      <p className="text-sm text-muted">
        {type
          ? `The papers a ${LABELS.employmentType[type].toLowerCase()} employee's file needs.`
          : 'No current employment: until there is one, only the national ID is needed. The rest of the checklist follows the employment type.'}
        {type && type !== 'full_time' && ' The signed job offer and NDA will be added here with document generation.'}
      </p>

      {expired && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <b>Expired:</b> {expired}. Ask for a new copy and upload it.
        </p>
      )}
      {soon && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <b>Expires soon:</b> {soon}.
        </p>
      )}

      <ul className="card">
        {papers.map((paper) => {
          const isId = paper.key === 'national_id';
          const latest = newest(paper.kinds[0]);
          const restricted = paper.kinds.some((k) => RESTRICTED_PAPERWORK.includes(k));
          const anyFile = paper.kinds.some((k) => byKind.has(k));
          return (
            <li key={paper.key} className="space-y-3 border-b border-line-soft p-5 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <h3 className="font-semibold">{paper.label}</h3>
                {restricted && anyFile && <span className="text-xs text-muted">Opening it is recorded.</span>}
              </div>

              {isId ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <DetailsLine number={employee.identity?.nationalIdMasked} expiry={employee.identity?.expiryDate} today={today} />
                  {canEdit && (
                    <Link
                      href={`/employees/${employee.id}/edit/national-id`}
                      prefetch={false}
                      className="inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline"
                    >
                      Edit details<span className="sr-only"> of the national ID</span>
                    </Link>
                  )}
                </div>
              ) : (
                latest && (
                  <PaperDetails
                    action={canEdit ? describePaperwork.bind(null, latest.id) : null}
                    name={paper.label}
                    documentNo={latest.documentNo}
                    expiresOn={formatDate(latest.expiresOn)}
                  >
                    <DetailsLine number={latest.documentNo} expiry={latest.expiresOn} today={today} />
                  </PaperDetails>
                )
              )}

              {isId ? (
                // the national ID is one document: each scan shows its front and back together
                <div id="paper-national_id" className="scroll-mt-6 space-y-2 rounded-md target:ring-2 target:ring-accent target:ring-offset-4">
                  {anyFile ? (
                    idScans(byKind.get('national_id_front') ?? [], byKind.get('national_id_back') ?? []).map((scan) => (
                      <IdScanLine key={(scan.front ?? scan.back)!.id} scan={scan} owner={employee.fullNameEn} canEdit={canEdit} />
                    ))
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3">
                      <span className="badge bg-warn-soft text-warn">Missing</span>
                      {canEdit && (
                        <Link
                          href={`/employees/${employee.id}/edit/national-id`}
                          prefetch={false}
                          className="inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline"
                        >
                          Scan the ID card
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {paper.kinds.map((kind) => {
                    const files = byKind.get(kind) ?? [];
                    return (
                      <div key={kind} id={`paper-${kind}`} className="scroll-mt-6 rounded-md target:ring-2 target:ring-accent target:ring-offset-4">
                        {files.length > 0 ? (
                          <div className="space-y-2">
                            {files.map((item) => (
                              <FileLine key={item.id} item={item} owner={employee.fullNameEn} canEdit={canEdit} />
                            ))}
                          </div>
                        ) : (
                          <span className="badge bg-warn-soft text-warn">Missing</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {others.length > 0 && (
        <ProfileSection title="Other Documents">
          <ul className="card">
            {others.map((item) => (
              <li key={item.id} className="space-y-3 border-b border-line-soft p-5 last:border-0">
                <h3 className="font-semibold">{label(item.kind)}</h3>
                <PaperDetails
                  action={canEdit ? describePaperwork.bind(null, item.id) : null}
                  name={label(item.kind)}
                  documentNo={item.documentNo}
                  expiresOn={formatDate(item.expiresOn)}
                >
                  <DetailsLine number={item.documentNo} expiry={item.expiresOn} today={today} />
                </PaperDetails>
                <FileLine item={item} owner={employee.fullNameEn} canEdit={canEdit} />
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {canEdit && (
        <div className="card p-6">
          <UploadPaperworkForm action={uploadPaperwork.bind(null, employee.id)} defaultKind={required.find((kind) => !NATIONAL_ID.includes(kind) && !byKind.has(kind)) ?? 'other'} />
        </div>
      )}
    </div>
  );
}
