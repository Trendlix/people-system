'use client';

import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { Select } from '@/components/select';
import type { SetupGroup } from './setup-pages';

// The setup menu on a phone (owner, 23 October 2026: "Side menu with headings", a drop-down on a phone): "Setup page",
// each group's pages under its heading, the current one chosen as the server drew it; choosing another opens it.

export function SetupPicker({ groups, current }: { groups: readonly SetupGroup[]; current: string | null }) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="lg:hidden">
      <label htmlFor={id} className="label">
        Setup page
      </label>
      <Select
        id={id}
        className="input"
        // drawn again with each page (its key is the page), so it never shows a page it isn't on
        defaultValue={current ?? ''}
        onChange={(e) => {
          if (e.target.value) router.push(e.target.value);
        }}
      >
        {current === null && <option value="">Choose a page</option>}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.pages.map((p) => (
              <option key={p.key} value={p.href}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}
