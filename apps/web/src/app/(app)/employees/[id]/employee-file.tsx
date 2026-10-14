import Link from 'next/link';
import { LABELS, PAPERWORK_LABELS, requiredPaperwork, RESTRICTED_PAPERWORK, type PaperworkKind } from '@trendlix/shared';
import { ApiError, apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, PaperworkItem } from '@/lib/types';
import { formatSize, OCR_LABEL, paperworkHref } from '../paperwork';
import { deletePaperwork, rereadPaperwork, uploadPaperwork } from '../paperwork-actions';
import { Loading } from '../ui';
import { DeleteFileButton, RereadButton, UploadPaperworkForm } from './employee-file-forms';

// The Employee file card on the profile: the scanned paperwork checklist for the employment type (spec §8.5).
// HR and the CEO see it (the API checks this again); only HR uploads and deletes.

type Employee = Pick<EmployeeProfile, 'id' | 'employmentType' | 'gender' | 'access'>;

function Card({ children }: { children: React.ReactNode }) {
  return <section className="card p-6">{children}</section>;
}

function Title({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">
        Employee File
        <span className="badge ml-2 bg-line-soft align-middle text-muted">Restricted</span>
      </h2>
      {children}
    </div>
  );
}

export function EmployeeFileLoading() {
  return (
    <Card>
      <Title />
      <Loading />
    </Card>
  );
}

const label = (kind: PaperworkKind) => PAPERWORK_LABELS[kind] ?? kind;

/** One uploaded file: when, view link, its name, size, uploader and whether its text was read; for HR, re-read and delete. */
function FileLine({ item, showKind, canEdit }: { item: PaperworkItem; showKind: boolean; canEdit: boolean }) {
  const name = label(item.kind);
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="text-sm">
          {showKind ? (
            <span className="font-medium">{name}</span>
          ) : (
            <span className="font-semibold text-ok">
              <span aria-hidden="true">✓ </span>Uploaded
            </span>
          )}{' '}
          <span className="text-muted">{formatDate(item.uploadedAt)}</span>
        </p>
        <p className="text-xs break-all text-muted">
          <bdi>{item.fileName}</bdi> · {formatSize(item.sizeBytes)}
          {item.uploadedBy && ` · by ${item.uploadedBy.email}`} · {OCR_LABEL[item.ocrStatus] ?? OCR_LABEL.pending}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        {/* Never prefetched: each download of a national ID scan is written to the audit log. */}
        <Link href={paperworkHref(item.id)} prefetch={false} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center text-sm font-semibold">
          View<span className="sr-only"> {name} (opens in a new tab)</span>
        </Link>
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

export async function EmployeeFile({ employee }: { employee: Employee }) {
  let items: PaperworkItem[];
  try {
    items = await apiGet<PaperworkItem[]>(`/employees/${employee.id}/paperwork`);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // The rest of the profile stays usable.
    return (
      <Card>
        <Title />
        <p className="mt-3 text-sm text-muted">The employee file could not be loaded. Please try again in a moment.</p>
      </Card>
    );
  }

  const required = requiredPaperwork(employee.employmentType, employee.gender);
  const byKind = new Map<PaperworkKind, PaperworkItem[]>();
  for (const item of items) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]); // newest first, as listed
  const others = items.filter((item) => !required.includes(item.kind));
  const uploaded = required.filter((kind) => byKind.has(kind)).length;
  const canEdit = employee.access.edit;

  return (
    <Card>
      <Title>
        <span className="text-sm text-muted tabular-nums">
          {uploaded} of {required.length} uploaded
        </span>
      </Title>
      <p className="mt-1 text-sm text-muted">
        Scanned paperwork for a {LABELS.employmentType[employee.employmentType].toLowerCase()} employee.
        {employee.employmentType !== 'full_time' && ' The signed job offer and NDA will be added here with document generation.'}
      </p>

      <ul className="mt-3">
        {required.map((kind) => {
          const files = byKind.get(kind) ?? [];
          return (
            <li key={kind} className="grid gap-2 border-b border-line-soft py-3 last:border-0 sm:grid-cols-[14rem_1fr] sm:gap-4">
              <div className="text-sm">
                <span className="font-medium">{label(kind)}</span>
                {files.length > 0 && RESTRICTED_PAPERWORK.includes(kind) && <span className="block text-xs text-muted">Opening it is recorded.</span>}
              </div>
              <div className="min-w-0 space-y-2">
                {files.length > 0 ? (
                  files.map((item) => <FileLine key={item.id} item={item} showKind={false} canEdit={canEdit} />)
                ) : (
                  <span className="badge bg-warn-soft text-warn">Missing</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {others.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold">Other Documents</h3>
          <ul className="mt-2">
            {others.map((item) => (
              <li key={item.id} className="border-b border-line-soft py-3 last:border-0">
                <FileLine item={item} showKind canEdit={canEdit} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && (
        <div className="mt-6">
          <UploadPaperworkForm
            action={uploadPaperwork.bind(null, employee.id)}
            defaultKind={required.find((kind) => !byKind.has(kind)) ?? 'other'}
          />
        </div>
      )}
    </Card>
  );
}
