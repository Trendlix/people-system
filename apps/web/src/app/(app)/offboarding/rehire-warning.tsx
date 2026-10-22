import { managesOffboarding, rehireWarningText, strongWarning } from './offboarding';
import { loadRehireMatches } from './data';
import { getCurrentUser } from '@/lib/session';

// Rehire eligibility's warning (owner, 22 October 2026: the full module; the brief: "a warning when a job offer or a new
// hire matches a former employee (the national ID or email), especially Not eligible ... a warning, not a block"): on a
// rehire's form and on a job offer, for HR, the CEO and a Super Admin, who they are, when they left and the decision.
// Nothing when nobody matches, the server doesn't have it yet, or the caller doesn't handle offboarding.

export async function RehireWarning({ employeeId, email }: { employeeId?: string | null; email?: string | null }) {
  if (!employeeId && !email) return null;
  const user = await getCurrentUser();
  if (!managesOffboarding(user)) return null;
  const loaded = await loadRehireMatches({ employeeId, email });
  if (loaded.kind !== 'ok' || loaded.value.length === 0) return null;
  const strong = strongWarning(loaded.value);
  return (
    <div role="note" className={`rounded-lg px-4 py-3 text-sm ${strong ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>
      <p className="font-semibold">{strong ? 'Not eligible to be hired again' : 'Worked here before'}</p>
      <ul className="mt-1 space-y-1">
        {loaded.value.map((m) => (
          <li key={m.employeeId}>{rehireWarningText(m)}</li>
        ))}
      </ul>
    </div>
  );
}
