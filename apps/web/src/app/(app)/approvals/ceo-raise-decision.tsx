import type { LawRates } from '@trendlix/shared';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import type { FormState } from '@/lib/types';
import { isDirect } from '../raise-requests/list';
import { RaiseDecisionForm } from './raise-decision-form';
import { decisionFigures, pendingRaiseView } from './raises';

/**
 * The CEO's decision on a raise waiting for them, from what Approvals reads of it (GET /raises/pending): the same form
 * on an Approvals card and, since 19 October 2026 (owner: "when a raise request was sent to the CEO, is showed in
 * approvals not raise requests"), on its row on Raise Requests, folded behind Decide there. Who reads the comment
 * follows who asked for it (none for a raise HR prepared directly: HR, Finance and the CEO); the reason starts as the
 * raise's, for the CEO to change when approving (19 October 2026: "i might want to ammend the raise reason").
 */
export function CeoRaiseDecision({
  raise: r,
  request,
  rates,
  action,
  folded = false,
}: {
  raise: PendingRaise;
  /** Its raise request, when read. */
  request: RaiseRequest | null;
  /** The years' rates set by law, for the net in the figures of another raise. */
  rates: readonly LawRates[];
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  folded?: boolean;
}) {
  return (
    <RaiseDecisionForm
      action={action}
      confirmApprove={pendingRaiseView(r).confirmApprove}
      name={r.employee.fullNameEn}
      previousGross={r.previous?.grossSalary ?? null}
      requester={request && !isDirect(request) ? request.requester : null}
      reason={r.raise?.reason ?? null}
      figures={decisionFigures(r, rates)}
      folded={folded}
    />
  );
}
