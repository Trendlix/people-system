import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { viewingAsText, type Session } from '@/lib/view-as';
import { ViewAsControls } from './view-as';

/**
 * At the top of every page while a Super Admin views as someone (owner's decisions, 17 October 2026): whom, with Act as
 * them (off to start with) and Back to my account. View only, it says so; with Act as them on, it turns the warning
 * colour and says that changes are made in their name and recorded as done by the Super Admin.
 */
export async function ViewAsBanner() {
  let user: Session;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  const viewAs = user.viewAs;
  if (!viewAs) return null;
  const acting = viewAs.act;

  return (
    <section
      aria-label="Viewing as another user"
      className={`sticky top-0 z-40 border-b px-4 py-2 sm:px-8 ${acting ? 'border-warn/30 bg-warn-soft text-warn' : 'border-accent/20 bg-accent-soft text-ink'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <p dir="auto" className="text-sm font-semibold break-words">
            {viewingAsText(user)}
          </p>
          <p className={`text-xs ${acting ? '' : 'text-muted'}`}>
            {acting
              ? `Acting as them: changes are made in their name and recorded as done by you (${viewAs.by.email}).`
              : 'View only: you see what they see; changes are refused.'}
          </p>
        </div>
        {/* a developer who is also an employee: as themselves first, as a developer with its switch (22 October 2026) */}
        <ViewAsControls acting={acting} developerView={user.mode === undefined || user.mode === null ? null : user.mode === 'developer'} />
      </div>
    </section>
  );
}
