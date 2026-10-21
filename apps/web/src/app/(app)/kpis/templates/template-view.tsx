import { KPI_ATTENDANCE_METRIC, type KpiTemplateView } from '@trendlix/shared';
import { aboveTarget, pillarGroups, UNPLACED_TITLE } from './[jobTitleId]/builder';

// A version of a job title's KPI template as everyone reads it (owner, 21 October 2026: "Managers can view their team's
// templates"): its pillars with their weights and max points, each metric with the JD duty it is linked to, its
// definition and how it's measured, its criteria scale and its target, and the automatic Attendance metric in its
// pillar. As the prototype's templates by role: JD duty → KPI metric → criteria → max. The pillars are the version's own
// (owner, 21 October 2026: "Fully flexible"): those it was published with; a draft's, the KPI framework's newest, those
// whose pillar is gone under Unplaced.

const none = <span className="text-muted">—</span>;

export function TemplateView({
  template,
  headingLevel = 'h4',
}: {
  template: Pick<KpiTemplateView, 'metrics' | 'attendancePoints' | 'pillars' | 'attendancePillar'>;
  headingLevel?: 'h3' | 'h4';
}) {
  const Heading = headingLevel;
  return (
    <div className="space-y-6">
      {pillarGroups(template.metrics, template.attendancePoints, { pillars: template.pillars, attendancePillar: template.attendancePillar }).map((g) => (
        <section key={g.pillar?.key ?? 'unplaced'} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Heading className={g.pillar ? 'font-semibold' : 'font-semibold text-warn'}>{g.pillar ? g.pillar.name : UNPLACED_TITLE}</Heading>
            {g.pillar && (
              <p className="text-sm text-muted tabular-nums">
                Weight {g.pillar.weight}% · max {g.max} points
              </p>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">KPI metric</th>
                  <th scope="col">JD duty</th>
                  <th scope="col">Criteria</th>
                  <th scope="col" className="text-right">
                    Target
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.metrics.map((m) => (
                  <tr key={m.id ?? m.number} className="align-top">
                    <td className="min-w-56 align-top">
                      <span className="font-semibold">{m.name}</span>
                      {m.pillar === null && m.wasIn && <span className="block text-xs text-warn">It was in {m.wasIn}, which the framework no longer has.</span>}
                      {m.definition && <span className="block text-xs text-muted">{m.definition}</span>}
                      {m.howMeasured && <span className="mt-1 block text-xs text-muted">Measured: {m.howMeasured}</span>}
                    </td>
                    <td className="min-w-40 align-top text-sm">{m.jdDuty ?? none}</td>
                    <td className="min-w-48 align-top">
                      <ul className="space-y-0.5 text-sm">
                        {m.criteria.map((c, j) => (
                          <li key={j} className="flex flex-wrap items-center gap-x-2">
                            <span>{c.label}</span>
                            <span className="text-muted tabular-nums">= {c.points}</span>
                            {aboveTarget(c.points, m.targetPoints) && <span className="badge">Above target</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="text-right align-top tabular-nums">{m.targetPoints}</td>
                  </tr>
                ))}
                {g.attendance && (
                  <tr className="align-top">
                    <td className="align-top">
                      <span className="font-semibold">{KPI_ATTENDANCE_METRIC}</span> <span className="badge bg-line-soft text-muted">Automatic</span>
                      <span className="block text-xs text-muted">Filled in by the system: its points × the month&apos;s attendance score, as payroll works it out.</span>
                    </td>
                    <td className="align-top">{none}</td>
                    <td className="align-top text-sm text-muted">Nobody picks it</td>
                    <td className="text-right align-top tabular-nums">{template.attendancePoints}</td>
                  </tr>
                )}
                {g.metrics.length === 0 && !g.attendance && (
                  <tr>
                    <td colSpan={4} className="text-sm text-muted">
                      No metric in this pillar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
