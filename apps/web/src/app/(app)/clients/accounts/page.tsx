import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError } from '@/lib/api';
import { todayInCairo } from '@/lib/date-picker';
import { isHidden, shownCode } from '@/lib/hidden';
import { canDelete, isSelfService } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Department } from '@/lib/types';
import { getOrNull } from '../../approvals/data';
import { ActionButton } from '../../employees/[id]/contracts/contract-buttons';
import { profileHref } from '../../employees/tab-list';
import { Empty, Loading } from '../../organization/ui';
import { loadJson } from '../../payroll/load';
import { AccountActions, AddAccount, AddTier, AssignmentActions, AssignPerson, TierActions } from './account-forms';
import { AccountSection } from './account-section';
import { CLIENT_HOURS_PATH } from '../hours/client-hours';
import {
  accountAnchor,
  accountFacts,
  addsClients,
  amountText,
  assignable,
  deleteAssignmentConfirm,
  deleteTierConfirm,
  focusedAccount,
  hasAmount,
  hiddenText,
  listsClientAccounts,
  missingAmounts,
  missingAmountsText,
  peopleCount,
  peopleOf,
  periodText,
  readsPeople,
  seesClientAccounts,
  sortedAccounts,
  standingBadge,
  statusBadge,
  type PersonRow,
} from './accounts';
import {
  addAssignment,
  createAccount,
  createTier,
  deleteAssignment,
  deleteTier,
  endAccount,
  endAssignment,
  updateAccount,
  updateAssignment,
  updateTier,
} from './actions';
import type { AssignmentView, ClientAccountsList, ClientAccountView, TierView } from './types';

// Clients → Client Accounts (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with
// it?"; asked, a "Client accounts list", the rate "variable", a part month "By days"): every client account, the active
// ones first, each with its code, size and team, its default amount a month, and its people (on it now, from a day to
// come, and those who were), each with their dates and amount; payroll pays each person the sum of their accounts for
// the days held, as the accounts allowance, when their contract has it. HR and the CEO add, change and end accounts,
// assign people (the account's default filled in, changed when someone's differs) and change or end an assignment, and
// keep the sizes (Small, Medium, Large …: a size only fills in an account's default); Finance and a Super Admin read
// them; a Super Admin deletes an assignment or a size made by mistake. The amounts only for those who see salaries; a
// C-level person's assignments are the CEO's, counted for anyone else ("C-level (1 person) — hidden"). The address's
// ?account= (the Audit Log's link, and Client Hours') marks and scrolls to one account. The API checks every change
// again. Client Hours (4 November 2026: "Full salary, hours tracked"), the month's timesheet hours by client, is a button
// away; Clients will hold Projects later. Managers (owner, 5 November 2026: "allow managers to add clients"; asked,
// "Anyone with the Manager role", "See the list and add", the amount "HR sets it later") open it too: the accounts
// without their people, sizes or amounts, and Add client (names, code, team, notes); HR and the CEO see such a client as
// "Amount not set", with a note at the top while any active one has none.

export const metadata: Metadata = { title: 'Client Accounts · People System' };

type Query = Record<string, string | string[] | undefined>;

const dash = <span className="text-muted">—</span>;

const NOT_YOURS = 'Only HR, the CEO, Finance, a Super Admin and managers can see the client accounts.';

/** One person on an account: name and code, dates, amount, note, where it stands, and HR's buttons. */
function AssignmentRow({
  a,
  account,
  seesAmounts,
  edits,
  removes,
  today,
}: {
  a: AssignmentView;
  account: ClientAccountView;
  seesAmounts: boolean;
  edits: boolean;
  removes: boolean;
  today: string;
}) {
  const badge = standingBadge(a.standing);
  const amount = seesAmounts ? amountText(a.amount) : null;
  return (
    <tr className="align-top">
      <td className="py-3 pe-3">
        <Link href={profileHref(a.employee.id, 'employment')} className="font-semibold">
          {a.employee.fullNameEn}
        </Link>
        {shownCode(a.employee.employeeCode) && <span className="text-muted"> · {a.employee.employeeCode}</span>}
        {a.note && <p className={`text-xs ${isHidden(a.note) ? 'text-muted' : ''}`}>{a.note}</p>}
      </td>
      <td className="py-3 pe-3 whitespace-nowrap tabular-nums">{periodText(a)}</td>
      {seesAmounts && (
        <td className="py-3 pe-3 text-right whitespace-nowrap tabular-nums">
          {/* their contract's amount per account is what payroll pays, in place of the assignment's (27 October 2026) */}
          {a.contractAmount ? (
            <>
              {amountText(a.contractAmount)}
              <span className="block text-xs text-muted">Their contract&apos;s rate</span>
            </>
          ) : (
            (amount ?? dash)
          )}
        </td>
      )}
      <td className="py-3 pe-3">
        <span className={`badge ${badge.tone}`}>{badge.label}</span>
      </td>
      {(edits || removes) && (
        <td className="py-3 text-right">
          {!edits ? (
            // a Super Admin who isn't HR or the CEO: Delete alone, for one added by mistake
            <ActionButton
              action={deleteAssignment.bind(null, a.id)}
              pendingText="Deleting…"
              variant="danger"
              confirmText={deleteAssignmentConfirm(a.employee.fullNameEn, account.nameEn)}
            >
              Delete
              <span className="sr-only"> {a.employee.fullNameEn}&apos;s assignment</span>
            </ActionButton>
          ) : (
            <AssignmentActions
              assignment={a}
              account={account.nameEn}
              update={updateAssignment.bind(null, a.id)}
              end={endAssignment.bind(null, a.id)}
              remove={removes ? deleteAssignment.bind(null, a.id) : null}
              seesAmounts={seesAmounts}
              today={today}
            />
          )}
        </td>
      )}
    </tr>
  );
}

/** An account's people: on it now, from a day to come, and those who were on it, each group with its heading. */
function People({
  account,
  seesAmounts,
  edits,
  removes,
  today,
}: {
  account: ClientAccountView;
  seesAmounts: boolean;
  edits: boolean;
  removes: boolean;
  today: string;
}) {
  const groups = peopleOf(account.assignments);
  const hidden = hiddenText(account.hidden);
  const parts = [
    { key: 'current', title: 'On It Now', rows: groups.current },
    { key: 'upcoming', title: 'From a Day to Come', rows: groups.upcoming },
    { key: 'past', title: 'Were on It', rows: groups.past },
  ].filter((p) => p.rows.length > 0);
  if (!parts.length) {
    return <p className="text-sm text-muted">No one is assigned to it yet.{hidden ? ` ${hidden}.` : ''}</p>;
  }
  return (
    <div className="space-y-4">
      {parts.map((p) => (
        <div key={p.key} className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="pb-1 text-left text-xs font-semibold tracking-wide text-muted uppercase">{p.title}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Dates</th>
                {seesAmounts && <th scope="col">Amount a month</th>}
                <th scope="col">Where it stands</th>
                {(edits || removes) && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {p.rows.map((a) => (
                <AssignmentRow key={a.id} a={a} account={account} seesAmounts={seesAmounts} edits={edits} removes={removes} today={today} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** One account's card: its name and facts, status, default amount and notes, HR's buttons, and its people. */
function AccountCard({
  account,
  list,
  people,
  departments,
  focused,
  removes,
  today,
}: {
  account: ClientAccountView;
  list: ClientAccountsList;
  people: readonly PersonRow[] | null;
  departments: Department[];
  focused: boolean;
  removes: boolean;
  today: string;
}) {
  const id = accountAnchor(account.id);
  const badge = statusBadge(account);
  const withPeople = readsPeople(list);
  // a manager's list: no sizes (5 November 2026)
  const facts = accountFacts(withPeople ? account : { ...account, tier: null });
  const amount = list.seesAmounts ? amountText(account.defaultAmount) : null;
  // a client a manager added, before HR set its amount: said to those who keep the accounts
  const noAmount = withPeople && !hasAmount(account);
  const edits = list.edits;
  return (
    <AccountSection id={id} focused={focused} labelledBy={`${id}-name`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-name`} className="text-lg font-semibold">
              {account.nameEn}
            </h3>
            {account.nameAr && (
              <span lang="ar" dir="rtl" className="text-muted">
                {account.nameAr}
              </span>
            )}
            <span className={`badge ${badge.tone}`}>{badge.label}</span>
          </div>
          {facts && <p className="text-sm text-muted">{facts}</p>}
          {withPeople && (
            <p className="text-sm">
              {noAmount ? <span className="badge bg-warn-soft text-warn">Amount not set</span> : amount ? <>Default {amount}</> : null}
              {(noAmount || amount) && ' · '}
              <span className="text-muted">{peopleCount(account.assignments, account.hidden)}</span>
            </p>
          )}
          {account.notes && <p className={`max-w-prose text-sm break-words ${isHidden(account.notes) ? 'text-muted' : ''}`}>{account.notes}</p>}
        </div>
        {edits && (
          <AccountActions
            account={account}
            update={updateAccount.bind(null, account.id)}
            end={endAccount.bind(null, account.id)}
            tiers={list.tiers}
            departments={departments}
            today={today}
          />
        )}
      </div>
      {withPeople && <People account={account} seesAmounts={list.seesAmounts} edits={edits} removes={removes} today={today} />}
      {withPeople && edits && account.status === 'active' && people && (
        <AssignPerson action={addAssignment.bind(null, account.id)} account={account} options={assignable(people, account)} seesAmounts={list.seesAmounts} />
      )}
    </AccountSection>
  );
}

/** The sizes and their default amounts; HR and the CEO add and change them, a Super Admin deletes one. */
function Sizes({ tiers, seesAmounts, edits, removes }: { tiers: readonly TierView[]; seesAmounts: boolean; edits: boolean; removes: boolean }) {
  if (!tiers.length && !edits) return null;
  // a Super Admin deletes one made by mistake, whoever else they are
  return (
    <section aria-labelledby="account-sizes" className="card space-y-3 p-5">
      <h2 id="account-sizes" className="font-semibold">
        Account Sizes
      </h2>
      {tiers.length > 0 ? (
        <ul className="divide-y divide-line-soft">
          {tiers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-semibold">{t.nameEn}</p>
                <p className="text-muted">
                  {seesAmounts && t.defaultAmount !== null ? `${amountText(t.defaultAmount)} · ` : ''}
                  {t.accounts === 1 ? '1 account' : `${t.accounts} accounts`}
                </p>
              </div>
              {edits ? (
                <TierActions tier={t} update={updateTier.bind(null, t.id)} remove={removes ? deleteTier.bind(null, t.id) : null} />
              ) : (
                removes && (
                  <ActionButton action={deleteTier.bind(null, t.id)} pendingText="Deleting…" variant="danger" confirmText={deleteTierConfirm(t.nameEn)}>
                    Delete<span className="sr-only"> the size {t.nameEn}</span>
                  </ActionButton>
                )
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No sizes yet.</p>
      )}
      {edits && <AddTier action={createTier} />}
    </section>
  );
}

async function AccountsView({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!listsClientAccounts(user)) {
    // an employee: to their dashboard, as the pages that aren't theirs (staff-only.tsx)
    if (isSelfService(user)) redirect('/');
    return <Empty>{NOT_YOURS}</Empty>;
  }
  const loaded = await loadJson<ClientAccountsList>('/client-accounts');
  if (loaded.kind !== 'ok') {
    return (
      <Empty>
        {loaded.kind === 'unavailable'
          ? 'Client accounts aren’t available yet.'
          : loaded.kind === 'forbidden'
            ? NOT_YOURS
            : `The client accounts could not be loaded. ${loaded.messages.join(' ')}`}
      </Empty>
    );
  }
  const list = loaded.value;
  const adds = addsClients(list);
  // what the forms choose from: the teams (a manager's Add client too), and the people for HR's and the CEO's Assign
  const [departments, people] = await Promise.all([
    adds || list.edits ? getOrNull<Department[]>('/departments') : null,
    list.edits ? getOrNull<PersonRow[]>('/employees') : null,
  ]);
  const today = todayInCairo();
  const focus = focusedAccount(query);
  const removes = canDelete(user);
  const accounts = sortedAccounts(list.accounts);
  // the active clients a manager added that have no amount yet, for those who keep the accounts (5 November 2026)
  const unset = readsPeople(list) ? missingAmounts(list.accounts) : [];
  const unsetText = missingAmountsText(unset.length);
  return (
    <div className="space-y-6">
      {unsetText && (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {unsetText}{' '}
          <Link href={`/clients/accounts?account=${unset[0].id}`} className="font-semibold text-warn">
            {unset.length === 1 ? `Open ${unset[0].nameEn}` : `Open the first, ${unset[0].nameEn}`}
          </Link>
        </p>
      )}
      {adds && <AddAccount action={createAccount} tiers={list.tiers} departments={departments ?? []} limited={!list.edits} />}
      <section aria-labelledby="accounts-list" className="space-y-4">
        <h2 id="accounts-list" className="font-semibold">
          {accounts.length === 1 ? '1 Account' : `${accounts.length} Accounts`}
        </h2>
        {accounts.length ? (
          accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              list={list}
              people={people}
              departments={departments ?? []}
              focused={focus === a.id}
              removes={removes}
              today={today}
            />
          ))
        ) : (
          <Empty>No client accounts yet.</Empty>
        )}
      </section>
      {readsPeople(list) && <Sizes tiers={list.tiers} seesAmounts={list.seesAmounts} edits={list.edits} removes={removes} />}
    </div>
  );
}

/** Client Hours, a button away, for those who see it: never a manager's (5 November 2026). */
async function ClientHoursLink() {
  try {
    if (!seesClientAccounts(await getCurrentUser())) return null;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  return (
    <Link href={CLIENT_HOURS_PATH} className="btn btn-secondary">
      Client Hours
    </Link>
  );
}

export default function ClientAccountsPage({ searchParams }: PageProps<'/clients/accounts'>) {
  // not behind StaffOnly: a manager opens it too (5 November 2026); AccountsView sends an employee to their dashboard
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Client Accounts</h1>
        {/* the month's timesheet hours by client (4 November 2026: "Full salary, hours tracked") */}
        <Suspense fallback={null}>
          <ClientHoursLink />
        </Suspense>
      </div>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <AccountsView searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
