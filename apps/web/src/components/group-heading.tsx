import { titleCase } from '@/lib/format';
import { peopleCount } from '@/lib/place-groups';

const LOOK = {
  section: 'bg-line-soft py-3 text-base text-ink',
  department: 'bg-canvas py-2.5 text-sm text-ink',
  team: 'bg-card py-2 text-sm font-medium text-muted',
} as const;

/**
 * The row above a group of people in a table (a section such as Active, a department, or a team), across every column,
 * with how many they are and, for a section, who is in it. Its name stays in view while a wide table scrolls sideways.
 */
export function GroupHeading({ level, name, count, span, note }: { level: keyof typeof LOOK; name: string | null; count: number; span: number; note?: string }) {
  return (
    <tr>
      <th colSpan={span} scope="colgroup" className={`text-left tracking-normal normal-case ${LOOK[level]}`}>
        <span className={`sticky left-4 inline-flex flex-wrap items-baseline gap-x-2 ${level === 'team' ? 'pl-4' : ''}`}>
          {name === null ? 'No Department' : titleCase(name)}
          <span className="text-xs font-normal text-muted">
            {peopleCount(count)}
            {note && ` · ${note}`}
          </span>
        </span>
      </th>
    </tr>
  );
}
