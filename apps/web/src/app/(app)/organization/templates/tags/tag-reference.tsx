'use client';

import { useId, useRef, useState } from 'react';
import { TAG_GROUP_LABELS, TAG_GROUPS, TEMPLATE_TAGS } from '@trendlix/shared';
import { count, matchesTag } from '../tag-check';

const none = <span className="text-muted">—</span>;

/**
 * The tag list (TEMPLATE_TAGS) by group, with a search box (by tag or label) and Copy beside each tag, which puts
 * {{tag}} on the clipboard to paste into Word; a screen reader hears "Copied".
 */
export function TagReference() {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  // said by a screen reader; `said` makes copying the same tag twice a change it hears again
  const [announcement, setAnnouncement] = useState('');
  const said = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  async function copy(tag: string) {
    const text = `{{${tag}}}`;
    said.current++;
    const again = said.current % 2 ? '' : ' ';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setAnnouncement(`Copied ${text}${again}`);
    } catch {
      // the clipboard can be blocked: the tag is still on screen to select and copy by hand
      setCopied(null);
      setAnnouncement(`${text} couldn't be copied: select it and copy it by hand.${again}`);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  }

  const groups = TAG_GROUPS.map((group) => ({ group, tags: TEMPLATE_TAGS.filter((t) => t.group === group && matchesTag(t, query)) })).filter(
    (g) => g.tags.length > 0,
  );
  const shown = groups.reduce((n, g) => n + g.tags.length, 0);

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <label htmlFor={searchId} className="label">
          Search tags
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. salary, national_id or الاسم"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${searchId}-count`}
          className="input"
        />
        <p id={`${searchId}-count`} role="status" className="hint">
          {query.trim() ? (shown ? `${count(shown, 'tag')} of ${TEMPLATE_TAGS.length} match.` : `No tags match “${query.trim()}”.`) : `${count(TEMPLATE_TAGS.length, 'tag')}.`}
        </p>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {groups.map(({ group, tags }) => (
        <section key={group} aria-labelledby={`${searchId}-${group}`} className="space-y-3">
          <h2 id={`${searchId}-${group}`} className="text-lg font-semibold">
            {TAG_GROUP_LABELS[group]}
          </h2>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Label</th>
                  <th>In Arabic</th>
                  <th>Comes From</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.tag}>
                    <td className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <code dir="ltr" className="rounded-md border border-accent/20 bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent select-all">
                          {`{{${t.tag}}}`}
                        </code>
                        <button
                          type="button"
                          onClick={() => copy(t.tag)}
                          className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-semibold text-accent hover:bg-accent-soft"
                        >
                          {copied === t.tag ? 'Copied' : 'Copy'}
                          <span className="sr-only"> {`{{${t.tag}}}`}</span>
                        </button>
                      </div>
                      {t.restricted && <span className="badge mt-1 bg-warn-soft text-warn">Restricted</span>}
                    </td>
                    <td className="min-w-40">{t.labelEn}</td>
                    <td className="min-w-40" lang="ar" dir="rtl">
                      {t.labelAr}
                    </td>
                    <td className="min-w-40 text-muted">{t.source}</td>
                    <td className="min-w-32">{t.note ?? none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
