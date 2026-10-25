import type { CvPositionGroup } from '@trendlix/shared';

// The positions as a drop-down list's options (owner, 25 October 2026: "should it be the positions?"; asked, "Position,
// grouped by team"): each team a group, its name the group's heading, its positions under it; on HR's lists the hidden
// ones too, marked "(hidden)". Inside the searchable <Select> (components/select.tsx), which shows the group headings.

export function PositionOptions({ groups }: { groups: readonly CvPositionGroup[] }) {
  return groups.map((g) => (
    <optgroup key={g.teamId} label={g.team}>
      {g.positions.map((p) => (
        <option key={p.key} value={p.key}>
          {p.hidden ? `${p.name} (hidden)` : p.name}
        </option>
      ))}
    </optgroup>
  ));
}
