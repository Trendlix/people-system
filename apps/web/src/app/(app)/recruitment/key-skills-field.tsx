'use client';

import { useRef, useState } from 'react';
import { KEY_SKILLS_LIMITS } from '@trendlix/shared';
import { jobTitleName, suggestedFrom, suggestedText, typedKeySkills, withSuggested } from './cv-fit';

// The vacancy form's key skills as chips (owner, 25 October 2026: "when a vacancy has no key skills, suggest them from its
// description for HR to confirm"; "Full CV fit score"): HR adds them (typed, commas between), removes any, or presses
// Suggest key skills, which adds those the rules find in the form's title, job title and texts as they are now
// (packages/shared cv-fit.ts suggestKeySkills). Nothing is saved until HR saves the form; the form sends them as before,
// separated by commas, with anything still typed in the box.

export function KeySkillsField({
  initial,
  initialNote = null,
  jobTitles,
  inputId,
  hintId,
}: {
  initial: string[];
  /** Said as the form opens with key skills suggested already (?suggest=1). */
  initialNote?: string | null;
  /** The job titles' picker labels, to read the chosen one's name. */
  jobTitles: { id: string; label: string }[];
  inputId: string;
  hintId: string;
}) {
  const [skills, setSkills] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(initialNote);
  const box = useRef<HTMLDivElement>(null);

  const add = () => {
    const typed = typedKeySkills(draft);
    if (!typed.length) return;
    setSkills((s) => withSuggested(s, typed).skills);
    setDraft('');
  };

  const suggest = () => {
    const form = box.current?.closest('form');
    if (!form) return;
    const fd = new FormData(form);
    const text = (name: string) => {
      const v = fd.get(name);
      return typeof v === 'string' ? v : '';
    };
    const jobTitleId = text('jobTitleId');
    const found = suggestedFrom({
      title: text('title').trim(),
      jobTitle: jobTitleName(jobTitles.find((j) => j.id === jobTitleId)?.label),
      about: text('about'),
      responsibilities: text('responsibilities'),
      requirements: text('requirements'),
    });
    const next = withSuggested(skills, found);
    setSkills(next.skills);
    setNote(suggestedText(next.added, found.length));
  };

  // sent as before: separated by commas, anything still typed in the box with them
  const sent = [...skills, ...typedKeySkills(draft)].join(', ');

  return (
    <div ref={box} className="space-y-2">
      <input type="hidden" name="keySkills" value={sent} />
      {skills.length > 0 ? (
        <ul aria-label="Key skills" className="flex flex-wrap gap-2">
          {skills.map((s) => (
            <li key={s} className="badge inline-flex items-center gap-1 bg-canvas text-ink">
              <span dir="auto">{s}</span>
              <button
                type="button"
                onClick={() => setSkills((list) => list.filter((x) => x !== s))}
                aria-label={`Remove ${s}`}
                className="-me-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">None yet.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor={inputId} className="label">
            Add key skills, separated by commas
          </label>
          <input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds them, never saves the form
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            aria-describedby={hintId}
            placeholder="e.g. Premiere Pro, After Effects, color grading"
            className="input"
          />
        </div>
        <button type="button" onClick={add} disabled={!draft.trim()} className="btn btn-secondary">
          Add
        </button>
        <button type="button" onClick={suggest} disabled={skills.length >= KEY_SKILLS_LIMITS.max} className="btn btn-secondary">
          Suggest key skills
        </button>
      </div>
      <p id={hintId} className="hint">
        Up to {KEY_SKILLS_LIMITS.max}, each up to {KEY_SKILLS_LIMITS.length} characters. Found as whole words in any case, in English or Arabic (a known skill
        under its other names too). Suggest key skills reads the title and the texts above.
      </p>
      {note && (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      )}
    </div>
  );
}
