import type { StepAhead } from '@/lib/steps-ahead';

// The steps a request still has to go through, as the last items of its Every Step list (owner, 1 November 2026: "in the
// everystep, can we add all the steps and show where the request is standing?"; lib/steps-ahead.ts): the one it waits at
// now marked Now, the ones after it faint.

export function StepsAheadItems({ steps }: { steps: readonly StepAhead[] }) {
  return steps.map((s) => (
    <li key={`ahead-${s.key}`} className="relative" aria-current={s.now ? 'step' : undefined}>
      <span
        aria-hidden="true"
        className={`absolute top-1.5 -left-[23px] size-3 rounded-full border-2 ${s.now ? 'border-warn bg-warn-soft ring-2 ring-warn/25' : 'border-line bg-card'}`}
      />
      <p className={`text-sm ${s.now ? 'font-medium' : 'text-muted'}`}>
        {s.text}
        {s.now && <span className="badge ml-2 bg-warn-soft align-middle text-warn">Now</span>}
      </p>
    </li>
  ));
}
