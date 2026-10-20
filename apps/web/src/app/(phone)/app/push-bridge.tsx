'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isNativeApp, onPushOpened, onPushReceived, pushStatus } from '@/lib/native';
import { pushHref } from '@/lib/notifications';
import { turnOnPush } from '@/lib/push-client';

// Push notifications in the app, once for the phone pages (owner, 20 October 2026: "Push notifications: yes (decisions,
// things waiting for someone, a check-in reminder)"; apps/mobile/README.md, Phase 4). Inside the TrendLIX People app
// only, never on the server nor in a browser: once notifications are allowed, it registers the phone again by itself
// each time the phone pages open (opening the app, after signing in, back from the full site: the token can change, the
// person signed in too, and the API keeps when it was last seen), errors ignored; a notification tapped opens its page on
// the phone pages (or the inbox); one received while the app is open refreshes the page, so the bell's count is right.
// Draws nothing.

export function PushBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    let live = true;
    void pushStatus().then((status) => {
      if (live && status === 'granted') void turnOnPush(false).catch(() => undefined);
    });
    const offOpened = onPushOpened((data) => router.push(pushHref(data)));
    const offReceived = onPushReceived(() => router.refresh());
    return () => {
      live = false;
      offOpened();
      offReceived();
    };
  }, [router]);

  return null;
}
