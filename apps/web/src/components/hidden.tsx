import type { ReactNode } from 'react';
import { HIDDEN_LABEL, readsHidden } from '@/lib/hidden';

// "Hidden", in the page's muted style, where the API hid a person's job or social insurance details from a developer
// (owner, 22 October 2026: "Hide per-person details", "and the social insurance"); lib/hidden.ts says what counts.

export function Hidden({ className = '' }: { className?: string }) {
  return <span className={`text-muted ${className}`.trim()}>{HIDDEN_LABEL}</span>;
}

/** A text, or Hidden for one the API hid; `empty` for none (nothing by default). */
export function Shown({ text, empty = null }: { text: string | null | undefined; empty?: ReactNode }) {
  if (readsHidden(text)) return <Hidden />;
  return text ? <>{text}</> : <>{empty}</>;
}
