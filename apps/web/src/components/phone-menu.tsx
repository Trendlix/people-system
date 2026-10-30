'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * The side menu on a phone (owner, 30 October 2026: "go through the mobile version menu. it has an issue in it"): the
 * brand and a Menu button; the menu itself, the same list as on a computer, opens under them top to bottom, its
 * sections opening downwards, and closes when a page is chosen in it or on Escape. On a computer the button is hidden
 * and the menu always shows, as the design's side menu. (It doesn't read the page's address: the layout around every
 * page is prepared ahead, and the address is only known when a page is asked for.)
 */
export function PhoneMenu({ brand, children }: { brand: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return (
    <>
      <div className="flex items-center justify-between gap-3 md:mb-8">
        <div className="min-w-0 px-2">{brand}</div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="main-menu"
          onClick={() => setOpen(!open)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-sidebar-line text-sidebar-ink hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-sidebar-text md:hidden"
        >
          {open ? <X aria-hidden="true" className="size-5" strokeWidth={1.6} /> : <Menu aria-hidden="true" className="size-5" strokeWidth={1.6} />}
          <span className="sr-only">{open ? 'Close the menu' : 'Menu'}</span>
        </button>
      </div>
      {/* a link chosen in it: the page opens and the menu closes; a section's button keeps it open */}
      <div
        id="main-menu"
        className={`${open ? 'flex' : 'hidden'} mt-4 flex-col md:mt-0 md:flex md:min-h-0 md:flex-1`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {children}
      </div>
    </>
  );
}
