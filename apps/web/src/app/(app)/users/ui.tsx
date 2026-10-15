import type { Role } from '@trendlix/shared';
import { isAdmin, ROLE_LABELS } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../organization/ui';

// Small building blocks shared by the Users pages (the generic ones come from the Organization pages).

export { BackLink, Empty, Loading };

/** Shows the children only to Admins and Super Admins; others get a short explanation (the API refuses them anyway). */
export async function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return <Empty>Only admins can manage users.</Empty>;
  return children;
}

export function StatusBadge({ active }: { active: boolean }) {
  return active ? <span className="badge bg-ok-soft text-ok">Active</span> : <span className="badge bg-line-soft text-muted">Inactive</span>;
}

/** Each role as a badge; Super Admin, the role above Admin and the only one that deletes, stands out in solid colour. */
export function RoleBadges({ roles }: { roles: Role[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r} className={r === 'super_admin' ? 'badge bg-accent text-white' : 'badge'}>
          {ROLE_LABELS[r] ?? r}
        </span>
      ))}
    </span>
  );
}

/** What an Admin sees on a Super Admin's account, in place of the forms that change it (the API refuses them with 403). */
export const ONLY_SUPER_ADMIN_CHANGES = 'Only a Super Admin can change this account.';

export const LINKED_BY_WORK_EMAIL =
  'Linked by work email: a user is linked to the employee whose work email is the same as their sign-in email.';
