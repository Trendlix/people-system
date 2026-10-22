'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { CAREERS_PATH } from './careers';
import { Cross, MenuBars } from './icons';
import { MENU_LINKS } from './site';

// The careers pages' header, as trendlix.com's (owner, 22 October 2026: "i need it to match the UI"; its new home hero,
// "this is it"): fixed at the top on a dark, see-through, blurred band; the logo on the left in white (the company's
// logo, made white as the main site shows its own), and on the right only the Menu, three thin bars and MENU (no
// language switcher: the careers pages are in English only). Once the page is scrolled, the band darkens, so the white
// letters stay readable over the light bands. The menu is the main site's full-screen overlay of big links, a modal
// dialog: the page behind can't be reached, Escape closes it, and the focus goes back to the Menu button.

export function SiteHeader({ logo, name }: { logo: string | null; name: string }) {
  const [scrolled, setScrolled] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const close = () => menu.current?.close();

  return (
    <>
      <a
        href="#careers-main"
        className="sr-only z-[60] rounded bg-white px-4 py-2 text-black focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to the content
      </a>
      <header
        className={`fixed inset-x-0 top-0 z-50 text-[#f1f1f1] backdrop-blur-[24.9px] transition-colors duration-300 ${scrolled ? 'bg-black/70' : 'bg-black/[0.14]'}`}
      >
        <div className="careers-container flex items-center justify-between gap-4 py-6">
          <a href={CAREERS_PATH} className="flex min-h-11 min-w-0 items-center" aria-label={`${name} careers`}>
            {logo ? (
              <Image src={logo} alt="" width={144} height={32} unoptimized priority className="h-auto max-h-9 w-28 object-contain object-left [filter:brightness(0)_invert(1)] sm:w-36" />
            ) : (
              <span className="careers-display truncate text-3xl">{name}</span>
            )}
          </a>
          <button
            ref={opener}
            type="button"
            onClick={() => menu.current?.showModal()}
            aria-haspopup="dialog"
            className="careers-display flex min-h-11 shrink-0 items-center gap-2 text-base leading-[24.74px] tracking-[-0.02em] sm:text-xl"
          >
            <MenuBars className="size-5" strokeWidth={1.5} />
            Menu
          </button>
        </div>
      </header>

      <dialog ref={menu} className="careers-menu" aria-label="Menu" onClose={() => opener.current?.focus()}>
        <div className="careers-container flex h-full flex-col">
          <div className="flex justify-end py-6">
            <button type="button" onClick={close} className="flex size-11 items-center justify-center" aria-label="Close the menu" autoFocus>
              <Cross className="size-8" strokeWidth={1.5} />
            </button>
          </div>
          <nav aria-label="TrendLIX" className="flex flex-1 items-center overflow-y-auto pb-16">
            <ul className="grid gap-6 lg:grid-cols-2 lg:gap-x-16 lg:gap-y-4">
              {MENU_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="careers-menu-link careers-wipe">
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <a href={CAREERS_PATH} aria-current="page" className="careers-menu-link careers-wipe" onClick={close}>
                  Careers
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </dialog>
    </>
  );
}
