import { kpiPillarOf, type KpiFrameworkVersionView } from '@trendlix/shared';
import { frameworkChangedText, pillarsLabel } from '../templates/framework';

// The KPI pillars as everyone reads them (owner, 21 October 2026: "Fully flexible"; 22 October 2026: "but i need pillars
// to each department"): a version's pillars, each with its short name and weight, the Attendance metric's marked; the
// company's and a department's alike.

/** A version's pillars, read only: each with its short name and weight, the Attendance metric's marked. */
export function PillarsList({ version: v }: { version: Pick<KpiFrameworkVersionView, 'pillars' | 'attendancePillar'> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Pillar</th>
            <th scope="col">Short name</th>
            <th scope="col" className="text-right">
              Weight
            </th>
          </tr>
        </thead>
        <tbody>
          {v.pillars.map((p) => (
            <tr key={p.key}>
              <td className="font-medium">
                {p.name}
                {p.key === v.attendancePillar && <span className="badge ml-2 bg-line-soft text-muted">Attendance counts here</span>}
              </td>
              <td className="text-muted">{p.short}</td>
              <td className="text-right tabular-nums">{p.weight}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A version under its title ("In Force", "Next"): its number, how many pillars, where Attendance counts, who saved it. */
export function FrameworkVersion({ title, version: v, note }: { title: string; version: KpiFrameworkVersionView; note: string }) {
  const changed = frameworkChangedText(v);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-muted">
          Version {v.version} · {pillarsLabel(v.pillars.length)} · Attendance in {kpiPillarOf(v, v.attendancePillar)?.name ?? '—'}
        </span>
      </div>
      <p className="text-sm text-muted">
        {note}
        {changed ? ` ${changed}.` : ''}
      </p>
      <PillarsList version={v} />
    </div>
  );
}
