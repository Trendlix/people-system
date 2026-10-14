import { logout } from '@/app/login/actions';
import { getCurrentUser } from '@/lib/session';

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr: 'HR',
  finance: 'Finance',
  ceo: 'CEO',
  admin: 'Admin',
};

export async function UserMenu() {
  const user = await getCurrentUser();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 text-right">
        <p className="truncate text-sm font-medium">{user.email}</p>
        <p className="truncate text-xs text-muted">{user.roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ')}</p>
      </div>
      <form action={logout}>
        <button type="submit" className="btn btn-secondary">
          Sign out
        </button>
      </form>
    </div>
  );
}
