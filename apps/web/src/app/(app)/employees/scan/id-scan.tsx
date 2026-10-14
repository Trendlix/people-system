'use client';

import { startTransition, useCallback, useRef, useState, useTransition } from 'react';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, useFieldIds } from '@/components/form';
import type { IdCardFound, IdCardPrepared } from '@/lib/types';
import { PAPERWORK_ACCEPT, PAPERWORK_MAX_BYTES, PDF_MAX_BYTES, PDF_TOO_LARGE, SCANS_MAX_BYTES, SCANS_TOO_LARGE, TOO_LARGE } from '../paperwork';
import { prepareIdCard } from '../paperwork-actions';
import { shrinkPhoto } from '../shrink-photo';
import { CARD_TOL, cardDims, cardOff, cardRect, CARD_MM, fineOf, foundRect, frameCard, quarterFor, startRect, turnCard, type Card, type Rect, type Side } from './card';
import { Cropper, FrameSays, RotateBar } from './crop';
import { base64File, canvasFrom, cardJpeg, cutCard, turnCanvas } from './image';

// The ID scan, shared by the Add employee page and the National ID page (after the scan dialog of Prime ERP, Trendlix,
// production/web/src/scan/fields.tsx at commit 1368621, whose screenshot the owner sent):
//   1. one or two files: a photo or a PDF of each side, or one file that holds both sides (a flatbed scan page);
//   2. as soon as one is chosen, the OCR service finds the cards on it (POST /id-card/prepare): each one cut out along
//      its edges and set straight, FRONT and BACK side by side, with "Adjust by hand" for each and "Swap front and back";
//   3. "Read data from the scan" sends the two cut-out cards to be read (`onRead`), once both sides are there.
// Nothing is stored here: what is read, and the cut-out cards, go to the page that uses this.

/** How a side was framed by hand last time, so that the frame opens there again. */
interface Hand {
  page: number;
  quarter: number;
  base: number;
  fine: number;
  rect: Rect;
}

/** A side of the card as it will be read and kept: the card cut out (JPEG), the page it is on, and where on it. */
interface SideCard {
  file: File;
  page: number;
  /** Where the OCR service found it on that page, in the page's points. */
  found: Card | null;
  hand: Hand | null;
}

/** What the chosen files gave: the pages as analysed, each side, and a sentence on what was done. */
interface Prepared {
  pages: IdCardPrepared['pages'];
  front: SideCard | null;
  back: SideCard | null;
  note: string;
}

/**
 * A side being framed by hand: the page it comes from, turned by `quarter`, shown turned by `base + fine` degrees
 * under the frame `rect`. `fine` is the slider (±10°): for a card that was found it starts at how far the card leans
 * from the nearest quarter turn, so a card already upright starts near 0°; `base` holds what the slider cannot (a lean
 * of more than 10°, or less than a tenth of a degree), so that the frame starts exactly on the card.
 */
interface Adjust {
  side: Side;
  page: number;
  work: HTMLCanvasElement;
  quarter: number;
  base: number;
  fine: number;
  rect: Rect;
}

type Files = { front: File | null; back: File | null };

const SIDE_LABEL: Record<Side, string> = { front: 'Front', back: 'Back' };
const READABLE = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
/** A whole scanner page keeps enough detail for the card at this size, and two of them stay well under 4 MB. */
const SCAN_SIDE = 3000;
const CAPTION = 'text-xs font-semibold tracking-wide text-muted uppercase';

/** The box the API gives for a card (degrees), as the frame's arithmetic takes it (radians). */
const cardOf = (f: IdCardFound): Card => ({ cx: f.box.cx, cy: f.box.cy, w: f.box.w, h: f.box.h, angle: (f.box.angle * Math.PI) / 180 });

/** What was done with the chosen files, in a sentence. */
function whatHappened(p: IdCardPrepared): string {
  const { front, back } = p;
  if (front && back) {
    const done =
      front.page === back.page
        ? 'The picture showed both sides. Each card was found, cut out along its edges and set straight.'
        : 'Both sides were found, each cut out along its edges and set straight.';
    const told = front.recognised === 'front' && back.recognised === 'back';
    return told ? done : `${done} Which side is which could not be told for sure: check them, and swap front and back if needed.`;
  }
  if (front || back) return `Only one card was found: frame the ${front ? 'back' : 'front'} by hand.`;
  return 'No card was found: frame each side by hand.';
}

function prepared(p: IdCardPrepared): Prepared {
  const side = (f: IdCardFound | null, s: Side): SideCard | null =>
    f && { file: base64File(f.image, `national-id-${s}.jpg`), page: f.page, found: cardOf(f), hand: null };
  return { pages: p.pages, front: side(p.front, 'front'), back: side(p.back, 'back'), note: whatHappened(p) };
}

/** Why a chosen file cannot be sent, or null. Photos are made smaller first, so only a PDF's size counts here. */
function refusal(file: File): string | null {
  if (!READABLE.test(file.type)) return 'Choose a JPG, PNG or WebP photo, or a PDF.';
  if (file.type === 'application/pdf' && file.size > PDF_MAX_BYTES) return PDF_TOO_LARGE;
  return null;
}

/** The chosen files ready to send: photos made smaller (more when both together are still too large), or why not. */
async function ready({ front, back }: Files & { front: File }): Promise<{ front: File; back: File | null } | { errors: string[] }> {
  const wrong = [front, back].flatMap((f) => (f && refusal(f)) || []);
  if (wrong.length) return { errors: [...new Set(wrong)] };
  const shrink = async (side: number) => ({ front: await shrinkPhoto(front, side), back: back && (await shrinkPhoto(back, side)) });
  const size = (f: { front: File; back: File | null }) => f.front.size + (f.back?.size ?? 0);
  let out = await shrink(SCAN_SIDE);
  if (size(out) > SCANS_MAX_BYTES) out = await shrink(2200);
  if (size(out) > SCANS_MAX_BYTES) return { errors: [SCANS_TOO_LARGE] };
  if (out.front.size > PAPERWORK_MAX_BYTES || (out.back?.size ?? 0) > PAPERWORK_MAX_BYTES) return { errors: [TOO_LARGE] };
  return out;
}

/** The picture a file holds, as it will be read and saved. Its address is made when it is shown and let go when it is not. */
function Preview({ file, alt }: { file: File; alt: string }) {
  const attach = useCallback(
    (img: HTMLImageElement) => {
      const address = URL.createObjectURL(file);
      img.src = address;
      return () => URL.revokeObjectURL(address);
    },
    [file],
  );
  // eslint-disable-next-line @next/next/no-img-element -- a picture made in this page (a blob), not a file of the site
  return <img ref={attach} alt={alt} className="h-32 w-auto max-w-full rounded-md border border-line bg-white object-contain" />;
}

/**
 * The ID scan: the two file areas, the cards found on them, framing a side by hand, and "Read data from the scan".
 * `onRead` reads the two cut-out cards and gives back what went wrong, or nothing when they were read.
 */
export function IdScan({ onRead }: { onRead: (cards: { front: File; back: File }) => Promise<string[] | undefined> }) {
  const fid = useFieldIds();
  const [files, setFiles] = useState<Files>({ front: null, back: null });
  const [set, setSet] = useState<Prepared | null>(null);
  const [errors, setErrors] = useState<string[]>();
  const [preparing, startPreparing] = useTransition();
  const runs = useRef(0);

  const [adjust, setAdjust] = useState<Adjust | null>(null);
  const [adjustSays, setAdjustSays] = useState('');
  const [opening, setOpening] = useState(false);
  /** The pages as canvases, opened once each; a new scan starts again. */
  const pageCanvases = useRef(new Map<number, Promise<HTMLCanvasElement>>());
  const adjustButtons = useRef<Partial<Record<Side, HTMLButtonElement | null>>>({});
  const panel = useRef<HTMLDivElement>(null);

  const [readErrors, setReadErrors] = useState<string[]>();
  const [reading, startReading] = useTransition();
  const [readOnce, setReadOnce] = useState(false);

  // ---------- the chosen files ----------

  function choose(side: Side, file: File | null) {
    const next = { ...files, [side]: file };
    setFiles(next);
    const run = ++runs.current;
    setAdjust(null);
    setReadErrors(undefined);
    if (!next.front) {
      // a back alone waits for the front
      setSet(null);
      setErrors(undefined);
      return;
    }
    const front = next.front;
    startPreparing(async () => {
      const sendable = await ready({ ...next, front });
      if (run !== runs.current) return;
      if ('errors' in sendable) {
        startTransition(() => {
          setSet(null);
          setErrors(sendable.errors);
        });
        return;
      }
      const fd = new FormData();
      fd.append('front', sendable.front, sendable.front.name);
      if (sendable.back) fd.append('back', sendable.back, sendable.back.name);
      const result = await prepareIdCard(fd);
      if (run !== runs.current) return;
      startTransition(() => {
        pageCanvases.current = new Map();
        setSet(result.prepared ? prepared(result.prepared) : null);
        setErrors(result.prepared ? undefined : result.errors);
      });
    });
  }

  function swap() {
    setAdjust(null);
    setSet((s) => s && { ...s, front: s.back, back: s.front, note: 'The two sides have changed places.' });
  }

  // ---------- a side framed by hand ----------
  // When the card was cut out badly, or not found at all, HR frames it: the page the side is on is shown with the frame
  // where the card was found. The frame is dragged, the picture turned in quarter turns, and the card rotated by hand, up
  // to ten degrees either way in tenths of a degree, until it lies exactly level.

  function pageCanvas(n: number): Promise<HTMLCanvasElement> {
    let made = pageCanvases.current.get(n);
    if (!made && set) {
      made = canvasFrom(base64File(set.pages[n].image, `page-${n + 1}.jpg`));
      pageCanvases.current.set(n, made);
    }
    return made ?? Promise.reject(new Error('No such page.'));
  }

  async function openAdjust(side: Side, at?: number) {
    if (!set) return;
    const card = set[side];
    const page = at ?? card?.hand?.page ?? card?.page ?? (side === 'front' ? 0 : set.pages.length - 1);
    setOpening(true);
    try {
      const raw = await pageCanvas(page);
      const hand = card?.hand?.page === page ? card.hand : null;
      const found = !hand && card?.found && card.page === page ? card.found : null;
      let st: Adjust;
      if (hand) {
        // as it was framed last time
        st = { side, page, work: hand.quarter ? turnCanvas(raw, hand.quarter) : raw, quarter: hand.quarter, base: hand.base, fine: hand.fine, rect: { ...hand.rect } };
      } else if (found) {
        // where the card was found, with the page turned so that it lies level: the quarter turns as by Rotate 90°, the
        // rest on the slider
        const quarter = quarterFor(found.angle);
        const work = quarter ? turnCanvas(raw, quarter) : raw;
        const at = foundRect(turnCard(found, raw.width, raw.height, quarter), work.width, work.height);
        const fine = fineOf(at.base);
        st = { side, page, work, quarter, base: at.base - fine, fine, rect: at.rect };
      } else {
        // with nothing to start from, a card-shaped frame in the middle
        st = { side, page, work: raw, quarter: 0, base: 0, fine: 0, rect: cardRect(startRect(), raw.width, raw.height) };
      }
      setAdjust(st);
      setAdjustSays('');
      requestAnimationFrame(() => {
        panel.current?.scrollIntoView?.({ block: 'nearest' });
        if (at === undefined) panel.current?.focus({ preventScroll: true });
      });
    } catch {
      setErrors(['The page could not be opened to frame the card. Choose the file again.']);
    } finally {
      setOpening(false);
    }
  }

  function closeAdjust(side: Side) {
    setAdjust(null);
    setAdjustSays('');
    requestAnimationFrame(() => adjustButtons.current[side]?.focus());
  }

  function turn() {
    setAdjust((a) => {
      if (!a) return a;
      const work = turnCanvas(a.work, 90);
      return { ...a, work, quarter: (a.quarter + 90) % 360, base: 0, fine: 0, rect: cardRect(startRect(), work.width, work.height) };
    });
  }

  /** The framed card becomes the picture of that side: cut out with its margin and brought to the size of an ID card. */
  async function applyFrame() {
    const st = adjust;
    if (!st) return;
    const W = st.work.width;
    const H = st.work.height;
    if (Math.abs(cardOff(st.rect.w * W, st.rect.h * H)) > CARD_TOL) {
      setAdjust({ ...st, rect: cardRect(st.rect, W, H) });
      setAdjustSays('The frame was far from the shape of an ID card, so it has been fitted to one. Check it, then press Use this frame again.');
      return;
    }
    const [cw, ch] = cardDims(Math.round(st.rect.w * W), Math.round(st.rect.h * H));
    const cut = cutCard(st.work, frameCard(st.rect, W, H, st.base + st.fine), [cw, ch]);
    // the print size: the card itself, 85.6 mm across, whatever margin the cut kept around it
    const dpi = Math.round(((cut.frame[2] - cut.frame[0]) * cut.width) / (CARD_MM[0] / 25.4));
    const blob = await cardJpeg(cut, dpi);
    if (!blob) {
      setAdjustSays('The card could not be cut out in this browser. Try again.');
      return;
    }
    const file = new File([blob], `national-id-${st.side}.jpg`, { type: 'image/jpeg' });
    const hand: Hand = { page: st.page, quarter: st.quarter, base: st.base, fine: st.fine, rect: { ...st.rect } };
    setSet((s) => {
      if (!s) return s;
      const was = s[st.side];
      const card: SideCard = { file, page: st.page, found: was?.page === st.page ? was.found : null, hand };
      const again = readOnce ? ' Press Read data from the scan to read it again from the adjusted picture.' : '';
      return { ...s, [st.side]: card, note: `The ${st.side} was framed by hand.${again}` };
    });
    closeAdjust(st.side);
  }

  // ---------- reading ----------

  const both = Boolean(set?.front && set.back);

  function read() {
    if (!set?.front || !set.back) return;
    const cards = { front: set.front.file, back: set.back.file };
    startReading(async () => {
      const failed = await onRead(cards);
      startTransition(() => {
        setReadErrors(failed);
        if (!failed) setReadOnce(true);
      });
    });
  }

  const busy = preparing || reading || opening;

  function figure(side: Side) {
    const card = set?.[side];
    const label = SIDE_LABEL[side];
    return (
      <figure key={side} className="m-0 grid min-w-0 content-start justify-items-start gap-1.5">
        {card ? (
          <Preview file={card.file} alt={`${label} of the card, as it will be read and saved`} />
        ) : (
          <p className="flex h-32 w-52 items-center justify-center rounded-md border border-dashed border-line p-3 text-center text-sm text-muted">
            Not found yet
          </p>
        )}
        <figcaption className={CAPTION}>{label}</figcaption>
        <button
          ref={(el) => {
            adjustButtons.current[side] = el;
          }}
          type="button"
          onClick={() => void openAdjust(side)}
          disabled={busy}
          aria-expanded={adjust?.side === side}
          className="btn btn-secondary"
        >
          Adjust by hand<span className="sr-only"> the {side}</span>
        </button>
      </figure>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('front')} className="label">
            ID scan, front
          </label>
          <FileDrop
            id={fid('front')}
            accept={PAPERWORK_ACCEPT}
            aria-describedby={fid('front-hint')}
            onChange={(e) => choose('front', e.currentTarget.files?.[0] ?? null)}
          />
          <p id={fid('front-hint')} className="hint">
            JPG, PNG or PDF. One file that holds both sides is enough.
          </p>
        </div>
        <div>
          <label htmlFor={fid('back')} className="label">
            ID scan, back
          </label>
          <FileDrop
            id={fid('back')}
            accept={PAPERWORK_ACCEPT}
            aria-describedby={fid('back-hint')}
            onChange={(e) => choose('back', e.currentTarget.files?.[0] ?? null)}
          />
          <p id={fid('back-hint')} className="hint">
            Optional. Leave it empty when the first file holds both sides.
          </p>
        </div>
      </div>
      <p className="text-sm text-muted">
        From a scanner: scan to a JPG or PDF file, then choose it, drag it in or paste it. Both sides on one page, or on two pages of one PDF, are
        told apart. On a phone the camera can be used.
      </p>

      <FormErrors errors={errors} />
      {files.back && !files.front && <p className="text-sm text-muted">Choose the front too: a file that holds the front, or both sides.</p>}

      <div aria-live="polite" className="space-y-3" hidden={!preparing && !set}>
        {preparing ? (
          <p className="text-sm text-muted">Finding the card on the scan…</p>
        ) : (
          set && (
            <>
              <div className="flex flex-wrap gap-4">{(['front', 'back'] as const).map(figure)}</div>
              <p className="text-sm">{set.note}</p>
              {(set.front || set.back) && (
                <button type="button" onClick={swap} disabled={busy} className="btn btn-secondary">
                  Swap front and back
                </button>
              )}
            </>
          )
        )}
      </div>

      {adjust && set && (
        <div
          ref={panel}
          tabIndex={-1}
          role="region"
          aria-label={`Frame the ${adjust.side} by hand`}
          className="space-y-3 rounded-lg border border-line bg-canvas p-4 outline-none"
        >
          <p id={fid('adjust-how')} className="text-sm">
            <b>{SIDE_LABEL[adjust.side]}: frame the card by hand.</b> Drag the frame over the card, or drag its handles to resize it. Rotate the card
            until it lies exactly level: up to 10 degrees either way, a tenth of a degree at a time. With the keyboard, the arrow keys move the frame
            and Shift with the arrow keys resizes it.
          </p>
          {set.pages.length > 1 && (
            <div role="group" aria-label="Page of the scan" className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Page</span>
              {set.pages.map((_, n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={adjust.page === n}
                  disabled={opening}
                  onClick={() => void openAdjust(adjust.side, n)}
                  className={`btn ${adjust.page === n ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {n + 1}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={turn} className="btn btn-secondary">
              Rotate 90°
            </button>
            <button
              type="button"
              onClick={() => setAdjust((a) => a && { ...a, rect: cardRect(a.rect, a.work.width, a.work.height) })}
              className="btn btn-secondary"
            >
              ID card shape
            </button>
            <RotateBar fine={adjust.fine} onFine={(v) => setAdjust((a) => a && { ...a, fine: fineOf(v) })} />
          </div>
          <Cropper
            work={adjust.work}
            angle={adjust.base + adjust.fine}
            rect={adjust.rect}
            onRect={(rect) => {
              setAdjust((a) => a && { ...a, rect });
              setAdjustSays('');
            }}
            label={`The scan the ${adjust.side} is cut out of`}
            frame="Frame of the card"
            describedBy={fid('adjust-how')}
            tall
          />
          <p className="text-sm text-muted" aria-live="polite">
            <FrameSays rect={adjust.rect} W={adjust.work.width} H={adjust.work.height} tilt={adjust.base + adjust.fine} />
          </p>
          {adjustSays && (
            <p role="alert" className="text-sm text-warn">
              {adjustSays}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void applyFrame()} className="btn btn-primary">
              Use this frame
            </button>
            <button type="button" onClick={() => closeAdjust(adjust.side)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-line pt-4">
        <FormErrors errors={readErrors} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={read} disabled={!both || busy || adjust !== null} className="btn btn-primary">
            {reading ? 'Reading the card…' : 'Read data from the scan'}
          </button>
          {set && !both && !preparing && <p className="text-sm text-muted">Both sides are needed to read the card: frame the missing side by hand.</p>}
        </div>
      </div>
    </div>
  );
}
