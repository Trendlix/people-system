'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { backAction, EXIT_HINT, EXIT_WINDOW_MS, previousPath, type NavigationLike } from '@/lib/back-button';
import { exitApp, handlesBackButton, onBackButton } from '@/lib/native';
import { useNativeApp } from '@/lib/use-native';

// Android's back button in the app (owner, 20 October 2026: the employee app; apps/mobile/README.md, Phase 5: "With
// history, go back. At /app Home, a second press within 2 seconds exits the app, after a short 'Press back again to
// exit' toast. Never leave the app for the site's desktop pages."), on every page the app can show (the root layout):
// lib/back-button.ts decides what a press does. Inside the app only, and only an APK carrying the App plugin: in a
// browser it does nothing and draws nothing; in an APK from before the plugin, Android's own back button is left alone.

/** What is open over a page that a press closes first: a modal dialog (the document viewer), or the top bar's menu. */
const OPEN_OVER_PAGE = 'dialog[open], details[open][data-closes-on-back]';

export function AppBackButton() {
  const router = useRouter();
  const inApp = useNativeApp();
  const [hint, setHint] = useState(false);
  const hintAt = useRef<number | null>(null);

  useEffect(() => {
    if (!handlesBackButton()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onBackButton(({ canGoBack }) => {
      const open = document.querySelector<HTMLDialogElement | HTMLDetailsElement>(OPEN_OVER_PAGE);
      const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
      const action = backAction({
        pathname: window.location.pathname,
        previous: previousPath(navigation, window.location.origin),
        canGoBack,
        open: open !== null,
        hintAt: hintAt.current,
        now: Date.now(),
      });
      switch (action.kind) {
        case 'close':
          if (open instanceof HTMLDialogElement) open.close();
          else if (open) open.open = false;
          return;
        case 'back':
          router.back();
          return;
        case 'go':
          router.replace(action.href);
          return;
        case 'hint':
          hintAt.current = Date.now();
          setHint(true);
          clearTimeout(timer);
          timer = setTimeout(() => {
            hintAt.current = null;
            setHint(false);
          }, EXIT_WINDOW_MS);
          return;
        case 'exit':
          clearTimeout(timer);
          hintAt.current = null;
          setHint(false);
          void exitApp();
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [router]);

  if (!inApp) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
      {hint && <p className="rounded-full bg-ink/90 px-4 py-2 text-sm font-medium text-white shadow-lg">{EXIT_HINT}</p>}
    </div>
  );
}
