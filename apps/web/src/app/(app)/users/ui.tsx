import type { Role } from '@trendlix/shared';
import { isAdmin, ROLE_LABELS } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../organisation/ui';

// Small building blocks shared by the Users pages (the generic ones come from the Organisation pages).

export { BackLink, Empty, Loading };

/** Shows the children only to admins; others get a short explanation (the API refuses them anyway). */
export async function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return <Empty>Only admins can manage users.</Empty>;
  return children;
}

export function StatusBadge({ active }: { active: boolean }) {
  return active ? <span className="badge bg-ok-soft text-ok">Active</span> : <span className="badge bg-line-soft text-muted">Inactive</span>;
}

export function RoleBadges({ roles }: { roles: Role[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r} className="badge">
          {ROLE_LABELS[r]}
        </span>
      ))}
    </span>
  );
}

export const LINKED_BY_WORK_EMAIL =
  'Linked by work email: a user is linked to the employee whose work email is the same as their sign-in email.';
