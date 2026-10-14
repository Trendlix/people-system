'use client';

import { useEffect, useRef, useState } from 'react';

// A file to choose, or to drag in or paste (owner's request: drag any file straight in). After the file box of Prime ERP
// (Trendlix), production/web/src/fields.tsx and drop.tsx at commit 1368621.
//
// The browser's own file box stays, so the keyboard, a screen reader and a phone choose files as they always did. A file
// that is dropped or pasted is put on that box and goes the way a chosen file goes: `onChange` runs (e.g. limitFileSize),
// and the form, or whoever reads the box, finds it. The kinds the box takes (`accept`) hold for a dropped or pasted file
// too: one of another kind is not taken, the box keeps what it held, and the area says what is taken.

/** Whether what is being dragged is a file brought in from outside, and not a word, a link or a picture of the page. */
const carriesFiles = (dt: DataTransfer | null | undefined): boolean => Array.from(dt?.types ?? []).includes('Files');

/**
 * Whether a file box that takes `accept` takes this file. A browser applies `accept` to a file that is chosen, and to none
 * that is dropped: this is the same test, by the kind the file says it is (image/png, image/*) or by the end of its name
 * (.pdf). A box that names no kind takes every file.
 */
export function fits(file: File, accept: string | undefined): boolean {
  const kinds = (accept ?? '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return !kinds.length || kinds.some((k) => (k.startsWith('.') ? name.endsWith(k) : k.endsWith('/*') ? type.startsWith(k.slice(0, -1)) : type === k));
}

/**
 * Puts a file on a file box as if it had been chosen there, and tells the box so (its `change` event). `from`: the list
 * the file came in, used where a browser cannot make a list of its own. False when the box could not be given the file.
 */
function putFile(box: HTMLInputElement, file: File, from?: FileList | null): boolean {
  let list: FileList | null;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    list = dt.files;
  } catch {
    list = from && from.length === 1 ? from : null;
  }
  if (!list) return false;
  try {
    box.files = list;
  } catch {
    return false;
  }
  if (!box.files?.length) return false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

const KIND_NAMES: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/*': 'pictures',
  'application/pdf': 'PDF',
};

/** "image/jpeg,image/png,application/pdf" → "JPG, PNG or PDF" */
function kindsOf(accept: string): string {
  const names = [...new Set(accept.split(',').map((k) => KIND_NAMES[k.trim().toLowerCase()] ?? k.trim().replace(/^\./, '').toUpperCase()))].filter(Boolean);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? '');
}

/** 812 → "812 B", 245 760 → "240 KB", 1 258 291 → "1.2 MB" */
function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const INPUT =
  'block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-white file:px-4 file:text-sm file:font-semibold';

/**
 * A file box inside an area a file can be dragged onto, or pasted into (⌘V or Ctrl+V) while the area or its box is
 * selected. One file is taken; of several, the first. Labelled like any input, by `id`.
 */
export function FileDrop({
  id,
  name,
  accept,
  required,
  onChange,
  'aria-describedby': describedBy,
}: {
  id: string;
  name?: string;
  accept?: string;
  required?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  'aria-describedby'?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // entering what is inside the area is said before leaving the area itself: counted, not guessed
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState('');
  const [chosen, setChosen] = useState<File | null>(null);

  // A file let go of beside the area would otherwise be opened by the browser in place of the page, losing the form.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (carriesFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    // a form emptied after it was sent empties the box too
    const form = input.current?.form;
    const reset = () => setChosen(null);
    form?.addEventListener('reset', reset);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
      form?.removeEventListener('reset', reset);
    };
  }, []);

  function take(file: File, all?: FileList | null) {
    if (!input.current) return;
    if (!fits(file, accept)) {
      setRefused(file.name || 'The file');
      return;
    }
    setRefused('');
    putFile(input.current, file, all);
  }

  const hintId = `${id}-drop`;
  return (
    <div
      tabIndex={-1}
      data-over={over ? '' : undefined}
      onDragEnter={(e) => {
        if (!carriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!carriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!depth.current) depth.current = 1; // held over it without having been seen to come in
        setOver(true);
      }}
      onDragLeave={() => {
        if (!depth.current) return;
        depth.current--;
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        if (!carriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const all = e.dataTransfer.files;
        if (all?.length) take(all[0], all);
      }}
      onPaste={(e) => {
        const all = e.clipboardData?.files;
        if (!all?.length) return;
        e.preventDefault();
        take(all[0], all);
      }}
      className={`flex min-w-0 flex-col gap-1.5 rounded-lg border border-dashed p-3 outline-none focus:border-accent ${
        over ? 'border-accent bg-accent-soft' : 'border-line bg-white'
      }`}
    >
      <input
        ref={input}
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
        onChange={(e) => {
          setRefused('');
          setChosen(e.currentTarget.files?.[0] ?? null);
          onChange?.(e);
        }}
        className={INPUT}
      />
      <p id={hintId} aria-live="polite" className={`text-xs ${refused ? 'text-danger' : 'text-muted'}`}>
        {refused
          ? `${refused} was not taken. This box takes ${kindsOf(accept ?? '')}.`
          : over
            ? 'Drop the file here to choose it.'
            : chosen
              ? `Chosen: ${chosen.name} (${sizeOf(chosen.size)}). Drag another file here to replace it.`
              : 'Drag a file here, or choose one.'}
      </p>
    </div>
  );
}
