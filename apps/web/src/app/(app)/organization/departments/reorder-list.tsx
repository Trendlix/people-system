'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FormErrors, SubmitButton, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';

type Item = { id: string; nameEn: string; nameAr: string | null };

type Props = {
  /** A heading, e.g. "Reorder Departments". */
  title: string;
  /** How to do it, under the title. */
  hint: string;
  /** Every department (or every team of one department), in the saved order. */
  items: Item[];
  /** Saves `ids`: every item's id, in the new order. */
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** Back to the list, unchanged. */
  cancelHref: string;
};

/** `list` with the item at `from` taken out and put back at `to`. */
function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** For screen readers: "Marketing moved to position 2 of 5." */
const placeOf = (name: string, index: number, count: number) => `${name} moved to position ${index + 1} of ${count}.`;

/**
 * The rows' place under a dragged one: after every other row whose middle is above the pointer. Read from the rows on
 * screen, so it holds while the list is still catching up with the pointer.
 */
function placeUnder(list: HTMLOListElement, id: string, y: number): number {
  let place = 0;
  for (const row of list.querySelectorAll<HTMLLIElement>(':scope > li')) {
    if (row.dataset.id === id) continue;
    const box = row.getBoundingClientRect();
    if (y > box.top + box.height / 2) place++;
  }
  return place;
}

function Grip() {
  return (
    <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">
      {[3, 8, 13].flatMap((y) => [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} />))}
    </svg>
  );
}

/**
 * Departments, or one department's teams, to put in order: drag a row (with a mouse from anywhere on it, with a finger
 * by its handle so the page still scrolls), or use its Move up / Move down buttons; then Save order.
 *
 * Next.js keeps a page it has left mounted (hidden) to show it again as it was, so an order left unsaved would come back
 * the next time Reorder is pressed: it starts again from the saved order whenever it is hidden.
 */
export function ReorderList(props: Props) {
  const [visit, setVisit] = useState(0);
  useLayoutEffect(() => () => setVisit((v) => v + 1), []);
  return <Reorder key={visit} {...props} />;
}

function Reorder({ title, hint, items, action, cancelHref }: Props) {
  const { state, pending, form } = useKeptForm(action);
  const [order, setOrder] = useState(items);
  const [said, setSaid] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; id: string; name: string; from: number; before: Item[] } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  // The Reorder button that led here is gone: start from the title.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  /** Moves the item to `to`, from wherever it is now. */
  function moveTo(id: string, to: number) {
    setOrder((list) => {
      const from = list.findIndex((d) => d.id === id);
      return from === to ? list : moved(list, from, to);
    });
  }

  function step(e: React.MouseEvent<HTMLButtonElement>, index: number, by: -1 | 1) {
    const button = e.currentTarget;
    const item = order[index];
    flushSync(() => {
      setOrder(moved(order, index, index + by));
      setSaid(placeOf(item.nameEn, index + by, order.length));
    });
    // React may have moved the row, which takes the focus off this button: put it back, or on the row's other button
    // once the row is first or last (this one is disabled then).
    const other = (by < 0 ? button.nextElementSibling : button.previousElementSibling) as HTMLButtonElement | null;
    (button.disabled ? other : button)?.focus();
  }

  function startDrag(e: React.PointerEvent<HTMLOListElement>) {
    const target = e.target as Element;
    const row = target.closest<HTMLLIElement>('li[data-id]');
    if (pending || drag.current || e.button !== 0 || !row || target.closest('button')) return;
    if (e.pointerType !== 'mouse' && !target.closest('[data-handle]')) return;
    const from = order.findIndex((d) => d.id === row.dataset.id);
    if (from < 0) return;
    e.preventDefault(); // no text selection
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, id: order[from].id, name: order[from].nameEn, from, before: order };
    setDragging(order[from].id);
  }

  function dragOver(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (d?.pointerId !== e.pointerId) return;
    moveTo(d.id, placeUnder(e.currentTarget, d.id, e.clientY));
  }

  function drop(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (d?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(null);
    const to = placeUnder(e.currentTarget, d.id, e.clientY);
    moveTo(d.id, to);
    if (to !== d.from) setSaid(placeOf(d.name, to, d.before.length));
  }

  /** The browser took the pointer away (e.g. to scroll): back to the order from before the drag. */
  function cancelDrag(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (d?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(null);
    setOrder(d.before);
  }

  return (
    <section className="card">
      <div className="p-5">
        <h3 id={headingId} ref={heading} tabIndex={-1} className="font-semibold outline-none">
          {title}
        </h3>
        <p className="mt-1 text-sm text-muted">{hint}</p>
      </div>
      <form {...form} className="border-t border-line">
        <ol
          aria-labelledby={headingId}
          onPointerDown={startDrag}
          onPointerMove={dragOver}
          onPointerUp={drop}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          className={dragging ? 'cursor-grabbing' : undefined}
        >
          {order.map((d, i) => (
            <li
              key={d.id}
              data-id={d.id}
              className={`flex items-center gap-2 border-b border-line-soft py-1.5 pr-3 pl-1 select-none sm:pr-5 ${
                dragging === d.id ? 'relative z-10 bg-accent-soft shadow-md' : 'bg-card'
              } ${pending || dragging ? '' : 'cursor-grab'}`}
            >
              <input type="hidden" name="ids" value={d.id} />
              <span data-handle aria-hidden="true" className="flex min-h-11 w-10 shrink-0 touch-none items-center justify-center text-muted">
                <Grip />
              </span>
              <span aria-hidden="true" className="w-6 shrink-0 text-right text-sm text-muted tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate px-1 font-medium">
                {d.nameEn}
                {d.nameAr && (
                  <span lang="ar" dir="rtl" className="ml-2 font-normal text-muted max-sm:hidden">
                    {d.nameAr}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 gap-2">
                <button type="button" disabled={pending || i === 0} onClick={(e) => step(e, i, -1)} className="btn btn-secondary px-3">
                  <span aria-hidden="true">↑</span>
                  <span className="max-sm:sr-only">Move up</span>
                  <span className="sr-only">: {d.nameEn}</span>
                </button>
                <button type="button" disabled={pending || i === order.length - 1} onClick={(e) => step(e, i, 1)} className="btn btn-secondary px-3">
                  <span aria-hidden="true">↓</span>
                  <span className="max-sm:sr-only">Move down</span>
                  <span className="sr-only">: {d.nameEn}</span>
                </button>
              </span>
            </li>
          ))}
        </ol>
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
        <div className="space-y-3 p-5">
          <FormErrors errors={state.errors} />
          <div className="flex flex-wrap gap-3">
            <SubmitButton busy={pending}>Save order</SubmitButton>
            {pending ? (
              <button type="button" disabled className="btn btn-secondary">
                Cancel
              </button>
            ) : (
              <Link href={cancelHref} className="btn btn-secondary">
                Cancel
              </Link>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
