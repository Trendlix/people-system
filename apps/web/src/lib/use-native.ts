'use client';

import { useSyncExternalStore } from 'react';
import { isNativeApp } from './native';

// Whether a page is shown inside the TrendLIX People app (the employee app, owner, 20 October 2026; lib/native.ts), for
// a component that shows something else there: the phone's camera on Take a photo, a PDF drawn with pdf.js. False on
// the server and while the page is hydrated (as the server drew it), then what the page knows; the shell never comes or
// goes while a page is open, so there is nothing to listen to.

const unchanging = () => () => {};

export function useNativeApp(): boolean {
  return useSyncExternalStore(unchanging, () => isNativeApp(), () => false);
}
