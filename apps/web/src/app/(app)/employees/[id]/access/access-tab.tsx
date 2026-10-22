import { ASSETS_ACCESS_LABELS, type EmployeeAccessView } from '@trendlix/shared';
import Link from 'next/link';
import { accessBadgeClass, accessLabel, accessStatusLine, WITHOUT_CONTRACT_LABEL } from '@/lib/access';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeProfile, FingerprintDevice, OpenSession, UserAccount } from '@/lib/types';
import { loadJson, notLoadedText } from '../../../payroll/load';
import { AccountPanel } from '../../../users/account-panel';
import { RoleBadges } from '../../../users/ui';
import { giveAccessNow, sendAccessLink, setSignInEmail } from '../../access-actions';
import { profileHref } from '../../tab-list';
import { GiveAccessForm, LinkForm, SignInEmailForm } from './access-forms';

// The profile's Access tab (owner, 22 October 2026: "i dont thint that the users and employees needs to be divided, any
// active employee with active contract should have access"; asked where: "On the employee profile"). For HR, an Admin
// and a Super Admin (a C-level person's for the CEO and a Super Admin): where their access stands, the email they sign
// in with ("let the HR Choose which mail to use"), Give access now, the set-password links ("Set-password link"), and
// for an Admin the account's tools (roles, Assets access, turning it off, sessions: the Users page's). The person sees
// "Your Sign-In" on their own: the email and their last sign-in.

const dateTime = (iso: string) => formatDateTime(iso);

export async function AccessTab({ profile }: { profile: Pick<EmployeeProfile, 'id' | 'fullNameEn'> }) {
  const [me, loaded] = await Promise.all([getCurrentUser(), loadJson<EmployeeAccessView>(`/employees/${profile.id}/access`)]);
  if (loaded.kind !== 'ok') {
    return <p className="text-sm text-muted">{loaded.kind === 'unavailable' ? 'Their access isn’t shown to you.' : notLoadedText(loaded, 'their access')}</p>;
  }
  const v = loaded.value;
  if (!v.can.invite) return <YourSignIn view={v} />;

  const a = v.account;
  // the Users page's tools, for an Admin and a Super Admin (the API checks them again)
  const panel =
    a && v.can.manageAccount
      ? await Promise.all([
          loadJson<UserAccount>(`/users/${a.id}`),
          loadJson<OpenSession[]>(`/users/${a.id}/sessions`),
          loadJson<FingerprintDevice[]>(`/users/${a.id}/devices`),
        ])
      : null;

  return (
    <div className="space-y-6">
      <section className="card max-w-xl space-y-3 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">Access</h3>
          <span className={accessBadgeClass(v.state)}>{accessLabel(v.state)}</span>
        </div>
        <p className="text-sm">{accessStatusLine(v, dateTime)}</p>
        {a && (
          <p className="text-sm text-muted">
            Signs in with <span className="font-medium break-all text-ink">{a.email}</span>
          </p>
        )}
        {v.withoutContract && (
          // listed, never closed by it: a renewal is usually on its way; their employment's end closes it (offboarding)
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {WITHOUT_CONTRACT_LABEL}: {v.notEligibleReason ?? 'their contract isn’t in force today.'} Their access stays on, as a renewal is usually on
            its way; the end of their employment closes it.
          </p>
        )}
        {v.state === 'clash' && v.clash?.otherEmployee && (
          <p className="text-sm">
            The account is {v.clash.otherEmployee.id === profile.id ? 'theirs' : <Link href={profileHref(v.clash.otherEmployee.id, 'access')}>{v.clash.otherEmployee.fullNameEn}’s</Link>}.
          </p>
        )}
        {v.state === 'pending' && <GiveAccessForm action={giveAccessNow.bind(null, profile.id)} />}
        {v.state === 'closed' && !v.can.manageAccount && <p className="hint">An Admin can turn their access back on.</p>}
      </section>

      {(v.signInEmail.work || v.signInEmail.personal) && (
        <section className="card max-w-xl space-y-3 p-6">
          <div>
            <h3 className="font-semibold">Sign-In Email</h3>
            <p className="mt-1 text-sm text-muted">The email they sign in with. Switching keeps the same account and the same password.</p>
          </div>
          <SignInEmailForm
            action={setSignInEmail.bind(null, profile.id)}
            saved={v.signInEmail.choice ?? (v.signInEmail.email && v.signInEmail.email === v.signInEmail.personal?.toLowerCase() ? 'personal' : 'work')}
            work={v.signInEmail.work}
            personal={v.signInEmail.personal}
          />
        </section>
      )}

      {a?.isActive && (
        <section className="card max-w-xl space-y-3 p-6">
          {a.passwordSet ? (
            <>
              <div>
                <h3 className="font-semibold">Password Reset</h3>
                <p className="mt-1 text-sm text-muted">A link to set a new password, working once for 7 days. Setting it signs them out everywhere.</p>
              </div>
              <LinkForm action={sendAccessLink.bind(null, profile.id, 'reset')} purpose="reset" emailReady={v.emailReady} resend={false} email={a.email} />
            </>
          ) : (
            <>
              <div>
                <h3 className="font-semibold">Invitation</h3>
                <p className="mt-1 text-sm text-muted">
                  A link to set their first password, working once for 7 days, in English and Arabic. Nothing is sent until you press it.
                </p>
              </div>
              <LinkForm action={sendAccessLink.bind(null, profile.id, 'invite')} purpose="invite" emailReady={v.emailReady} resend={v.state === 'invited'} email={a.email} />
            </>
          )}
        </section>
      )}

      {a && !v.can.manageAccount && (
        // HR sees them; an Admin changes them (the Users page's rules)
        <section className="card max-w-xl space-y-3 p-6">
          <h3 className="font-semibold">Roles</h3>
          <RoleBadges roles={a.roles} />
          <p className="text-sm">
            Assets access: <span className="font-medium">{ASSETS_ACCESS_LABELS[a.assetsAccess]}</span>
          </p>
          <p className="hint">An Admin changes their roles, their Assets access and their sessions.</p>
        </section>
      )}

      {panel &&
        (panel[0].kind === 'ok' && panel[1].kind === 'ok' ? (
          <AccountPanel me={me} user={panel[0].value} sessions={panel[1].value} devices={panel[2]} temporaryPassword={false} />
        ) : (
          <p className="text-sm text-muted">Their account’s roles and sessions couldn’t be loaded. Please try again.</p>
        ))}
    </div>
  );
}

/** On their own profile: the email they sign in with and their last sign-in, read only. */
function YourSignIn({ view: v }: { view: EmployeeAccessView }) {
  return (
    <section className="card max-w-xl space-y-3 p-6">
      <h3 className="font-semibold">Your Sign-In</h3>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-muted">Email</dt>
          <dd className="font-medium break-all">{v.account?.email ?? v.signInEmail.email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Last sign-in</dt>
          <dd>{v.account?.lastSignInAt ? formatDateTime(v.account.lastSignInAt) : '—'}</dd>
        </div>
        {v.account && (
          <div>
            <dt className="text-muted">Account made</dt>
            <dd>{formatDate(v.account.createdAt)}</dd>
          </div>
        )}
      </dl>
      <p className="text-sm text-muted">
        <Link href="/account/password">Change password</Link> · <Link href="/account/sessions">Your sessions</Link>. HR changes the email you sign in with.
      </p>
    </section>
  );
}
