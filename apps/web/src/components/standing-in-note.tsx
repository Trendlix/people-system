import { formatDate } from '@/lib/format';

// A stand-in's note on a request they decide (owner, 25 October 2026: "To a stand-in"): while an approver is on leave,
// what waits at their step shows to and is decided by the stand-in they named, and the request's page says for whom.
// Shared by the leave, permission, work from home, official duty, attendance correction and reimbursement pages.

/**
 * "Standing in for Ahmed Ali: they are on leave, so this request is yours to decide meanwhile; the step and the audit log
 * keep you both." Nothing when the caller decides as themself. `until`: the last day of their leave, when known.
 */
export function StandingInNote({ person, until }: { person: { fullNameEn: string } | null | undefined; until?: string | null }) {
  if (!person) return null;
  return (
    <p role="note" className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
      <span className="font-semibold">Standing in for {person.fullNameEn}</span>: they are on leave{until ? ` until ${formatDate(until)}` : ''}, so this request is yours to
      decide meanwhile. Its step and the audit log keep you both.
    </p>
  );
}
