'use client';

import { useEffect, useId, useState } from 'react';
import { DocumentViewer } from '@/components/document-viewer';
import { countPdfPages, formatSize } from '@/lib/scan-helper';
import { useBlobAddress } from './blob-address';

// Checking a file before it is sent (owner's words: "check it, then confirm it"), whether it was scanned, chosen or
// dropped: a picture is shown as it is, a PDF in a small viewer of the browser's own, with its name, kind, size and pages
// when they are known, View larger, and Choose another. The form's own button then confirms it.

const KIND_NAMES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG photo',
  'image/png': 'PNG picture',
  'image/webp': 'WebP picture',
};

/** A PDF's page count, read from the file once it is shown (null until then, or when it cannot be told). */
function usePdfPages(file: File | null): number | null {
  const [counted, setCounted] = useState<{ file: File; pages: number | null } | null>(null);
  useEffect(() => {
    if (!file || file.size > 50 * 1024 * 1024) return;
    let current = true;
    file.arrayBuffer().then(
      (buffer) => {
        if (current) setCounted({ file, pages: countPdfPages(new Uint8Array(buffer)) });
      },
      () => {
        // unreadable: the pages are not said
      },
    );
    return () => {
      current = false;
    };
  }, [file]);
  return counted && counted.file === file ? counted.pages : null;
}

/**
 * The file to check (`file`), before the form sends it. `pages`: when already known (e.g. from the scanner); counted
 * otherwise for a PDF. `scanned`: it came from the scanner. `problem`: why the form will not take it (e.g. too large).
 * `onChooseAnother`: the file is put aside, to choose, drop or scan another. `actions`: more buttons beside those, e.g.
 * Crop & adjust.
 */
export function FileCheck({
  file,
  pages,
  scanned = false,
  problem,
  onChooseAnother,
  actions,
}: {
  file: File;
  pages?: number | null;
  scanned?: boolean;
  problem?: string;
  onChooseAnother: () => void;
  actions?: React.ReactNode;
}) {
  const headingId = useId();
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  const counted = usePdfPages(isPdf && pages == null ? file : null);
  const pageCount = pages ?? counted;
  const shown = useBlobAddress(file);
  const kind = KIND_NAMES[file.type] ?? (file.type || 'File');

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <div>
        <h4 id={headingId} className="font-semibold">
          Check the File
        </h4>
        <p className="mt-0.5 text-sm text-muted">Make sure it is the right document, complete and readable. Then confirm and upload it.</p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="w-full shrink-0 sm:w-72">
          {isPdf ? (
            <iframe ref={shown} title={`Preview of ${file.name}`} className="h-80 w-full rounded-md border border-line bg-white" />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- a file chosen in this page (a blob), not a file of the site
            <img ref={shown} alt={`Preview of ${file.name}`} className="max-h-80 w-full rounded-md border border-line bg-white object-contain" />
          ) : (
            <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">This kind of file can&apos;t be shown here.</p>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Name</dt>
            <dd className="min-w-0 font-medium break-words">{file.name}</dd>
            <dt className="text-muted">Kind</dt>
            <dd>
              {kind}
              {scanned ? ', from the scanner' : ''}
            </dd>
            {pageCount != null && (
              <>
                <dt className="text-muted">Pages</dt>
                <dd className="tabular-nums">{pageCount}</dd>
              </>
            )}
            <dt className="text-muted">Size</dt>
            <dd className="tabular-nums">{formatSize(file.size)}</dd>
          </dl>
          {problem && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <DocumentViewer title={file.name} files={[{ alt: `The file ${file.name}`, src: file }]} className="btn btn-secondary">
              View larger<span className="sr-only">: {file.name}</span>
            </DocumentViewer>
            {actions}
            <button type="button" onClick={onChooseAnother} className="btn btn-secondary">
              Choose another
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
