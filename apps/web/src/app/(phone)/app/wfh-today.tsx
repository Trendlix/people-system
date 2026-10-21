import Link from 'next/link';
import { appItemHref } from '@/lib/surface';
import { loadMyWfh } from '../../(app)/attendance/wfh/data';

// On the phone pages' Home (owner, 21 October 2026: "think about how should we handle the working from home in out erp";
// the brief: on Home, a line "Working from home today", where it applies): when a work from home day is approved for
// them today, a line saying so above today's check-in, opening the request. That day they check in from home, the office
// network not needed (the API's check-in). Nothing otherwise, nor when their days can't be read.

export async function WfhToday({ today }: { today: string }) {
  const mine = await loadMyWfh();
  const day = mine.kind === 'ok' ? mine.value.find((r) => r.status === 'approved' && r.date === today) : undefined;
  if (!day) return null;
  return (
    <Link href={appItemHref('requests', 'wfh', day.id)} className="card flex min-h-14 items-center justify-between gap-3 px-4 py-3 text-ink no-underline">
      <span>
        <span className="block font-semibold">Working from home today</span>
        <span className="block text-xs text-muted">Check in from home: the office network isn&apos;t needed today.</span>
      </span>
      <span aria-hidden="true" className="text-lg text-accent">
        ›
      </span>
    </Link>
  );
}
