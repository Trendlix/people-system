'use client';

import { useEffect, useRef } from 'react';
import { clearPushToken, readPushToken } from '@/lib/notifications';
import { forgetPush, isNativeApp } from '@/lib/native';

// In a Sign out form, inside the Trendlix People app (owner, 20 October 2026: "Push notifications: yes (decisions,
// things waiting for someone, a check-in reminder)"; apps/mobile/README.md, Phase 4): the push token this phone
// registered, as a hidden field, so signing out unregisters it with the API (app/login/actions.ts, logout) and the phone
// gets no more notifications for the person signed out. On sending the form, the phone forgets its token too and the
// page the one it kept. Outside the app the field stays empty and nothing else happens.

/** The page's storage, null when the browser refuses it (a private window, storage blocked). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function PushTokenField() {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const field = input.current;
    const form = field?.form;
    if (!field || !form || !isNativeApp()) return;
    field.value = readPushToken(storage()) ?? '';
    // the form's own listener runs before React reads the form (at the page's root), so the token sent is the latest
    // one kept, also one registered after this menu was drawn
    const onSubmit = () => {
      field.value = readPushToken(storage()) ?? '';
      clearPushToken(storage());
      void forgetPush();
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  return <input ref={input} type="hidden" name="pushToken" defaultValue="" />;
}
