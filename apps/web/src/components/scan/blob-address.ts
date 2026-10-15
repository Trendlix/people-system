'use client';

import { useCallback } from 'react';

/**
 * A callback ref that gives a frame, a picture or a link its own address for `blob` while it is in the page, and lets
 * the address go (revokes it) as soon as it is not: when it is taken out, or shown with another file.
 */
export function useBlobAddress(blob: Blob) {
  return useCallback(
    (el: HTMLIFrameElement | HTMLImageElement | HTMLAnchorElement | null): void | (() => void) => {
      if (!el) return;
      const address = URL.createObjectURL(blob);
      if (el instanceof HTMLAnchorElement) el.href = address;
      else el.src = address;
      return () => URL.revokeObjectURL(address);
    },
    [blob],
  );
}
