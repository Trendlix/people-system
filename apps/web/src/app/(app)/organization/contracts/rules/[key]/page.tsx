import { END_REASON_LABELS, ENDING_RULES } from '@trendlix/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { EndingRule } from '@/lib/types';
import { BackLink, Loading, RequireEditor } from '../../../ui';
import { updateEndingRule } from '../../actions';
import { INITIATOR_LABELS } from '../../labels';
import { EndingRuleForm } from '../../rule-form';

async function EditRule({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  // Rules are a fixed list (packages/shared/src/contracts.ts); anything else gets the 404 page without asking the API.
  if (!(ENDING_RULES as readonly string[]).includes(key)) notFound();
  const rule = (await apiGet<EndingRule[]>('/ending-rules')).find((r) => r.key === key);
  if (!rule) notFound();
  return (
    <RequireEditor>
      <h2 className="text-lg font-semibold">{rule.label}</h2>
      <p className="mt-1 text-sm text-muted">
        Started by: {INITIATOR_LABELS[rule.initiator] ?? rule.initiator} · Ends as: {END_REASON_LABELS[rule.endReason] ?? rule.endReason} · Source:{' '}
        {rule.source}
      </p>
      <div className="mt-4">
        <EndingRuleForm action={updateEndingRule.bind(null, rule.key)} rule={rule} />
      </div>
    </RequireEditor>
  );
}

export default function EndingRulePage({ params }: PageProps<'/organization/contracts/rules/[key]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/contracts">Contracts &amp; Endings</BackLink>
      <Suspense fallback={<Loading />}>
        <EditRule params={params} />
      </Suspense>
    </div>
  );
}
