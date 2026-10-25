import { KPI_ATTENDANCE_METRIC, kpiMetricDuties, type KpiTemplateView } from '@trendlix/shared';
import { aboveTarget, leftOutPillarNote, pillarGroups, pillarsFromText, UNPLACED_TITLE } from './[jobTitleId]/builder';

// A version of a job title's KPI template as everyone reads it (owner, 21 October 2026: "Managers can view their team's
// templates"): its pillars with their weights and max points, each metric with the JD duty it is linked to, its
// definition and how it's measured, its criteria scale and its target, and the automatic Attendance metric in its
// pillar. As the prototype's templates by role: JD duty → KPI metric → criteria → max. The pillars are the version's own
// (owner, 21 October 2026: "Fully flexible"): those it was published with; a draft's, the KPI framework's newest, those
// whose pillar is gone under Unplaced. Whose pillars they are (owner, 22 October 2026: "but i need pillars to each
// department"): its department's own, or the company's, and whether the job title weights them its own way. While
// attendance is out of the KPI (owner, 25 October 2026: "Fixed cut only"), the Attendance metric isn't shown, and a
// pillar it was alone in says it isn't scored.

const none = <span className="text-muted">—</span>;

/**
 * A metric's JD duties, each on its line (several from 25 October 2026: "Yes, several duties"; one saved before, or
 * answered by an API from before, a list of it); none: a dash.
 */
function DutyList({ duties }: { duties: string[] }) {
  if (!duties.length) return none;
  return (
    <ul className={duties.length > 1 ? 'list-disc space-y-1 ps-4' : undefined}>
      {duties.map((d) => (
        <li key={d} dir="auto">
          {d}
        </li>
      ))}
    </ul>
  );
}

export function TemplateView({
  template,
  headingLevel = 'h4',
  attendance = true,
}: {
  template: Pick<KpiTemplateView, 'metrics' | 'attendancePoints' | 'pillars' | 'attendancePillar'> &
    // an API from before department pillars sends neither
    Partial<Pick<KpiTemplateView, 'pillarsFrom' | 'ownWeights'>>;
  headingLevel?: 'h3' | 'h4';
  /** Whether the Attendance metric counts in the KPI (the setting, 25 October 2026); on unless sent. */
  attendance?: boolean;
}) {
  const Heading = headingLevel;
  const whose = pillarsFromText(template.pillarsFrom);
  return (
    <div className="space-y-6">
      {(whose || template.ownWeights) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {whose && <span>{whose}</span>}
          {template.ownWeights && <span className="badge bg-accent-soft text-accent">Own weights for this job title</span>}
        </p>
      )}
      {pillarGroups(template.metrics, template.attendancePoints, { pillars: template.pillars, attendancePillar: template.attendancePillar }, attendance).map((g) => (
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
                  <th scope="col">JD duties</th>
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
                    <td className="min-w-48 align-top text-sm">
                      <DutyList duties={kpiMetricDuties(m)} />
                    </td>
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
                      {g.leftOut && g.pillar ? leftOutPillarNote(g.pillar) : 'No metric in this pillar.'}
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
