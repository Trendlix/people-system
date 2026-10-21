import { appItemHref } from '@/lib/surface';
import type { Session } from '@/lib/view-as';
import { loadWaitingScorecards } from '../../(app)/kpis/data';
import { actionButton, ownCardText, ownWaiting } from '../../(app)/kpis/scorecard';
import { PhoneCard, RowLink, RowList } from './ui';

// The employee's own KPI scorecard waiting for them on the phone's Home and My Requests (owner's brief, 21 October 2026:
// "a card on Home and Requests for the employee's self-rating and sign-off"): "Your October 2026 KPI: rate yourself by
// 03/11/2026", "… ready to sign by 10/11/2026", each opening the scorecard under My Requests, with its form. Nothing
// when none waits, or what waits couldn't be read (the KPI pages say so).

export async function MyKpiCard({ user }: { user: Pick<Session, 'employeeId'> }) {
  if (!user.employeeId) return null;
  const waiting = await loadWaitingScorecards();
  if (waiting.kind !== 'ok') return null;
  const mine = ownWaiting(waiting.value, user.employeeId);
  if (!mine.length) return null;
  return (
    <PhoneCard title="Your KPI" flush>
      <RowList label="Your KPI scorecards waiting for you">
        {mine.map((s) => (
          <RowLink
            key={s.id}
            href={appItemHref('requests', 'kpi', s.id)}
            title={ownCardText(s)}
            line={s.action === 'self_rate' ? 'Pick how you did on each metric, then send it.' : 'Read the score and the comments, then sign that you have read it.'}
            aside={<span className="badge">{actionButton(s)}</span>}
          />
        ))}
      </RowList>
    </PhoneCard>
  );
}
