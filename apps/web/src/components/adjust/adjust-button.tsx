'use client';

import { useRef, useState } from 'react';
import { replacePaperworkFile } from '@/app/(app)/employees/adjust-actions';
import { VIEW_BUTTON } from '@/components/document-viewer';
import type { Adjusted } from './canvas';
import { DocumentAdjuster, type AdjustSource } from './document-adjuster';

// The ways into the document adjuster: AdjustButton for a file chosen in the page and not uploaded yet (the upload
// form's preview), AdjustStoredButton for a document already in the employee file (the Documents tab).

export type { Adjusted } from './canvas';
export { DocumentAdjuster, type AdjustSource, type DocumentAdjusterProps } from './document-adjuster';

/** What AdjustButton takes. */
export interface AdjustButtonProps {
  /** The chosen file: a photo (JPEG, PNG or WebP) or a PDF. A photo opens in the browser; a PDF is turned into pages by
   *  the API (POST /paperwork/prepare), so it needs the OCR service, which the window says when it is down, and it must be
   *  4 MB or smaller. */
  file: File;
  /**
   * Called with the adjusted document when "Use this" is pressed (never on Cancel, which leaves `file` as it was):
   * a JPEG for one page ("<name>-adjusted.jpg"), one PDF for several ("<name>-adjusted.pdf"), at most 4 MB. `info.pages`:
   * how many pages it has; `info.note`: a sentence when its pictures had to be saved at a lower quality or resolution to
   * stay under 4 MB (also shown beside the button).
   */
  onAdjusted: (file: File, info: Adjusted) => void;
  /** What the document is, for the window's title: "Adjust <title>". Default "Document". */
  title?: string;
  /** What the button says. Default "Adjust". */
  children?: React.ReactNode;
  /** The button's look. Default that of the View links next to a file (VIEW_BUTTON). */
  className?: string;
  disabled?: boolean;
}

/**
 * "Adjust" for a file chosen in the page and not uploaded yet, e.g. in the upload form's preview:
 *
 *   <AdjustButton file={file} title="Birth Certificate" onAdjusted={(adjusted) => setFile(adjusted)} />
 *
 * It opens the document adjuster on `file` (crop with a free frame, turn, straighten, fit to the paper's edges, remove
 * pages) and gives back the adjusted File. Closing the window puts the focus back on the button.
 */
export function AdjustButton({ file, onAdjusted, title = 'Document', children = 'Adjust', className = VIEW_BUTTON, disabled }: AdjustButtonProps) {
  const [source, setSource] = useState<AdjustSource | null>(null);
  const [note, setNote] = useState('');
  const opener = useRef<HTMLButtonElement>(null);

  function closed() {
    setSource(null);
    opener.current?.focus(); // browsers do this too, but not all of them reliably
  }

  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          setNote('');
          setSource({ file });
        }}
        className={className}
      >
        {children}
      </button>
      {note && (
        <span role="status" className="text-xs text-muted">
          {note}
        </span>
      )}
      {source && (
        <DocumentAdjuster
          source={source}
          title={`Adjust ${title}`}
          saveLabel="Use this"
          onDone={(adjusted) => {
            setNote(adjusted.note ?? '');
            onAdjusted(adjusted.file, adjusted);
          }}
          onClose={closed}
        />
      )}
    </>
  );
}

/**
 * "Adjust" for a document in the employee file (HR): the stored file is opened in the adjuster (the web server fetches
 * it and the API prepares it), and Save puts the adjusted file in its place, after asking: the original is not kept. The
 * page then shows the new file, and its text is read again. `name`: what the document is; `owner`: whose file it is.
 */
export function AdjustStoredButton({ itemId, fileName, mimeType, name, owner }: { itemId: string; fileName: string; mimeType: string; name: string; owner: string }) {
  const [source, setSource] = useState<AdjustSource | null>(null);
  const [saved, setSaved] = useState('');
  const opener = useRef<HTMLButtonElement>(null);

  function closed() {
    setSource(null);
    opener.current?.focus();
  }

  async function replace(adjusted: Adjusted): Promise<string[] | undefined> {
    const fd = new FormData();
    fd.append('file', adjusted.file, adjusted.file.name);
    const result = await replacePaperworkFile(itemId, fd);
    if (result.errors?.length) return result.errors;
    setSaved(result.message ?? 'Saved.');
  }

  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setSaved('');
          setSource({ itemId, fileName, mimeType });
        }}
        className={VIEW_BUTTON}
      >
        Adjust<span className="sr-only"> {name}</span>
      </button>
      {/* said to screen readers; the line itself shows the new file's name and size */}
      <span role="status" className="sr-only">
        {saved}
      </span>
      {source && (
        <DocumentAdjuster
          source={source}
          title={`Adjust ${name} · ${owner}`}
          saveLabel="Save"
          confirmText="Replace the stored file with the adjusted one? The original is not kept."
          onDone={replace}
          onClose={closed}
        />
      )}
    </>
  );
}
