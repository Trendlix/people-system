import { CONFIDENTIAL_LABEL } from '@trendlix/shared';

// The "C-level" mark (owner, 19 October 2026: "make C level Employees details not visible to HR"): beside a C-level
// person's name in the Employees list and on their profile or card, and on a confidential grade on the grades page.

/** "C-level", as a badge; `title` says what it means where it is shown. */
export function CLevelBadge({ title, className = '' }: { title?: string; className?: string }) {
  return (
    <span title={title} className={`badge bg-warn-soft text-warn ${className}`.trim()}>
      {CONFIDENTIAL_LABEL}
    </span>
  );
}
