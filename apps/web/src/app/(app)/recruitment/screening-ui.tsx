'use client';

import { useActionState, useId, useMemo, useRef, useState } from 'react';
import {
  aboutKey,
  filteredComments,
  SCREENING_AUTHOR_ROLE_LABELS,
  SCREENING_VERDICT_LABELS,
  SCREENING_VERDICTS,
  type ScreeningCommentView,
  type ScreeningComments,
  type ScreeningPerson,
  type ScreeningVerdict,
} from '@trendlix/shared';
import { FormErrors } from '@/components/form';
import { Select } from '@/components/select';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { addScreeningComment, deleteScreeningComment, editScreeningComment } from './comment-actions';
import { authorName, chipOf, COMMENT_MAX, commentFilters, insertMention, keptMentions, mentionParts, mentionQueryAt, mentionSuggestions, verdictBadge } from './screening';

// Screening comments on the site (owner, 24 October 2026, on a candidate's profile: "is there a way to add screening
// comments?", then "and i can add genearrl comments"; asked, "Yes: Good fit / Maybe / Not a fit" and "HR + hiring manager
// & interviewers"): the comments, each with what it is about, its verdict, who wrote it (their role then) and when, and
// "edited"; the form, with what it is about, the text, an optional verdict and @mentions of the colleagues who may read
// it (typing @ offers them; only they are offered); the author's Edit within 24 hours and a Super Admin's Delete. On the
// candidate's profile, every comment with filters (All, General, each record); on an applicant's and a general CV's page
// and in the CV window, the record's with the general ones. The API checks every rule again.

function Verdict({ verdict }: { verdict: ScreeningVerdict | null }) {
  const badge = verdictBadge(verdict);
  return badge ? <span className={`badge ${badge.className}`}>{badge.label}</span> : null;
}

/** A comment's text, the colleagues mentioned marked. */
function CommentText({ c }: { c: ScreeningCommentView }) {
  const parts = mentionParts(
    c.comment,
    c.mentions.map((m) => m.name),
  );
  return (
    <p className="text-sm break-words whitespace-pre-line" dir="auto">
      {parts.map((p, i) =>
        p.mention ? (
          <span key={i} className="font-semibold text-accent">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * The text with @mentions: typing @ offers the colleagues of `mentionable` (arrows, Enter or Tab to choose one, Esc to
 * stop); each chosen is sent as `mentions` while their "@Name" stays in the text.
 */
function MentionText({
  id,
  label,
  defaultText,
  defaultMentions,
  people,
  mentionable,
}: {
  id: string;
  label: string;
  defaultText: string;
  defaultMentions: string[];
  people: readonly ScreeningPerson[];
  mentionable: readonly string[];
}) {
  const [text, setText] = useState(defaultText);
  const [chosen, setChosen] = useState<string[]>(defaultMentions);
  const [typing, setTyping] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = `${id}-people`;
  const hintId = `${id}-hint`;
  const suggestions = typing ? mentionSuggestions(people, mentionable, typing.query, chosen) : [];
  const kept = keptMentions(text, chosen, people);
  const allowed = kept.filter((m) => mentionable.includes(m));
  const notTold = kept.filter((m) => !mentionable.includes(m)).map((m) => people.find((p) => p.id === m)?.name ?? '');

  function look(el: HTMLTextAreaElement) {
    setTyping(mentionQueryAt(el.value, el.selectionStart ?? el.value.length));
    setActive(0);
  }

  function choose(p: ScreeningPerson) {
    const el = box.current;
    if (!el || !typing) return;
    const done = insertMention(text, typing.start, el.selectionStart ?? text.length, p.name);
    setText(done.text);
    setChosen((was) => [...was.filter((x) => x !== p.id), p.id]);
    setTyping(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(done.caret, done.caret);
    });
  }

  return (
    <div className="relative space-y-1">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <textarea
        ref={box}
        id={id}
        name="comment"
        rows={4}
        required
        maxLength={COMMENT_MAX}
        value={text}
        dir="auto"
        // unsaved text: the CV window asks before it closes on Esc
        data-unsaved={text.trim() !== defaultText.trim() ? 'true' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          look(e.target);
        }}
        onClick={(e) => look(e.currentTarget)}
        onKeyDown={(e) => {
          if (!suggestions.length) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            choose(suggestions[Math.min(active, suggestions.length - 1)]);
          } else if (e.key === 'Escape') {
            // closes the list, not the CV window around it
            e.preventDefault();
            e.stopPropagation();
            setTyping(null);
          }
        }}
        onBlur={() => setTimeout(() => setTyping(null), 150)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={suggestions.length ? `${listId}-${Math.min(active, suggestions.length - 1)}` : undefined}
        aria-describedby={hintId}
        className="input"
      />
      {suggestions.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Colleagues to mention" className="absolute inset-x-0 z-10 max-h-56 overflow-y-auto rounded-lg border border-line bg-card py-1 shadow-lg">
          {suggestions.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-accent-soft text-accent' : 'hover:bg-canvas'}`}
            >
              <span className="font-semibold">{p.name}</span> <span className="text-xs text-muted">· {SCREENING_AUTHOR_ROLE_LABELS[p.role]}</span>
            </li>
          ))}
        </ul>
      )}
      <p id={hintId} className="hint">
        Type @ to mention a colleague who may read it: they are told.
        {notTold.length > 0 && ` ${notTold.filter(Boolean).join(', ')} can’t read a comment about this, so won’t be told.`}
      </p>
      {allowed.map((m) => (
        <input key={m} type="hidden" name="mentions" value={m} />
      ))}
    </div>
  );
}

/** The optional verdict: none, Good fit, Maybe, Not a fit. */
function VerdictChoice({ name, defaultValue }: { name: string; defaultValue: ScreeningVerdict | null }) {
  return (
    <fieldset className="space-y-1">
      <legend className="label">
        Verdict <span className="font-normal text-muted">(optional)</span>
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" name={name} value="" defaultChecked={!defaultValue} />
          No verdict
        </label>
        {SCREENING_VERDICTS.map((v) => (
          <label key={v} className="flex min-h-9 items-center gap-2">
            <input type="radio" name={name} value={v} defaultChecked={defaultValue === v} />
            {SCREENING_VERDICT_LABELS[v]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const mentionableOf = (data: ScreeningComments, key: string): string[] => data.targets.find((t) => t.key === key)?.mentionable ?? [];

/** A new comment: what it is about (`defaultTarget` first chosen), the text with @mentions, the optional verdict. */
export function CommentForm({ data, defaultTarget }: { data: ScreeningComments; defaultTarget: string }) {
  const fid = useId();
  const [target, setTarget] = useState(data.targets.some((t) => t.key === defaultTarget) ? defaultTarget : (data.targets[0]?.key ?? ''));
  // a fresh form after each comment added
  const [round, setRound] = useState(0);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await addScreeningComment(data.candidateId, prev, fd);
    if (next.message && !next.errors) setRound((r) => r + 1);
    return next;
  }, {});
  if (!data.can.add || !data.targets.length) return null;
  const typedBack = (k: string) => {
    const v = state.errors ? state.values?.[k] : undefined;
    return typeof v === 'string' ? v : '';
  };
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line p-4">
      <FormErrors errors={state.errors} />
      {state.message && !state.errors && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
      {data.targets.length > 1 ? (
        <div>
          <label htmlFor={`${fid}-target`} className="label">
            About
          </label>
          <Select id={`${fid}-target`} name="target" value={target} onChange={(e) => setTarget(e.target.value)} className="input">
            {data.targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="target" value={target} />
      )}
      <MentionText
        key={round}
        id={`${fid}-comment`}
        label="Comment"
        defaultText={typedBack('comment')}
        defaultMentions={[]}
        people={data.people}
        mentionable={mentionableOf(data, target)}
      />
      <VerdictChoice key={`v${round}`} name="verdict" defaultValue={(typedBack('verdict') || null) as ScreeningVerdict | null} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Adding…' : 'Add comment'}
      </button>
    </form>
  );
}

/** The author's change to their comment (within 24 hours of writing it). */
function EditComment({ c, data, onDone }: { c: ScreeningCommentView; data: ScreeningComments; onDone: () => void }) {
  const fid = useId();
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await editScreeningComment(c.id, prev, fd);
    if (next.message && !next.errors) onDone();
    return next;
  }, {});
  const mentionable = mentionableOf(data, aboutKey(c.about));
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors errors={state.errors} />
      <MentionText
        id={`${fid}-comment`}
        label="Comment"
        defaultText={c.comment}
        defaultMentions={c.mentions.map((m) => m.id)}
        people={[...data.people, ...c.mentions.filter((m) => !data.people.some((p) => p.id === m.id)).map((m) => ({ ...m, role: 'hr' as const }))]}
        mentionable={[...new Set([...mentionable, ...c.mentions.map((m) => m.id)])]}
      />
      <VerdictChoice name="verdict" defaultValue={c.verdict} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save comment'}
        </button>
        <button type="button" onClick={onDone} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteComment({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(() => deleteScreeningComment(id), {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Delete this comment? This can’t be undone.')) e.preventDefault();
      }}
      className="space-y-2"
    >
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-danger hover:underline">
        {pending ? 'Deleting…' : 'Delete'}
      </button>
    </form>
  );
}

/** One comment: what it is about, the verdict, who (their role then), when, "edited"; Edit and Delete when allowed. */
function CommentItem({ c, data, showChip }: { c: ScreeningCommentView; data: ScreeningComments; showChip: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="space-y-2 border-b border-line-soft py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold">{authorName(c)}</span>
        {c.authorRole && <span className="badge bg-canvas text-ink">{SCREENING_AUTHOR_ROLE_LABELS[c.authorRole]}</span>}
        <span className="text-xs text-muted">
          {formatDateTime(c.createdAt)}
          {c.editedAt && (
            <span title={`Edited ${formatDateTime(c.editedAt)}`}>
              {' · '}edited
            </span>
          )}
        </span>
      </div>
      {(showChip || c.verdict) && (
        <div className="flex flex-wrap gap-1">
          {showChip && <span className={`badge ${c.about.kind === 'general' ? 'bg-accent-soft text-accent' : 'bg-canvas text-ink'}`}>{chipOf(c)}</span>}
          <Verdict verdict={c.verdict} />
        </div>
      )}
      {editing ? <EditComment c={c} data={data} onDone={() => setEditing(false)} /> : <CommentText c={c} />}
      {!editing && (c.can.edit || c.can.delete) && (
        <div className="flex flex-wrap items-start gap-4">
          {c.can.edit && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-accent hover:underline">
              Edit
              {c.editableUntil && <span className="sr-only">, until {formatDateTime(c.editableUntil)}</span>}
            </button>
          )}
          {c.can.delete && <DeleteComment id={c.id} />}
          {c.can.edit && c.editableUntil && <span className="self-center text-xs text-muted">You can edit it until {formatDateTime(c.editableUntil)}.</span>}
        </div>
      )}
    </li>
  );
}

/**
 * Comments, newest first, each with a chip of what it is about; `ownKey`: the record whose page (or CV) this is, its own
 * comments without a chip, the others marked ("General", "General CV APP-…").
 */
export function CommentList({ comments, data, ownKey, empty = 'No comments yet.' }: { comments: readonly ScreeningCommentView[]; data: ScreeningComments; ownKey?: string; empty?: string }) {
  if (!comments.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul>
      {comments.map((c) => (
        <CommentItem key={c.id} c={c} data={data} showChip={!ownKey || aboutKey(c.about) !== ownKey} />
      ))}
    </ul>
  );
}

/**
 * The Screening Comments card. `mode` profile: every comment, with the filters All / General / each record, the form on
 * General; record: the record's comments (`comments`, with the general ones, marked), the form on the record.
 */
export function ScreeningCommentsCard({
  data,
  notLoaded,
  mode,
  comments,
  defaultTarget,
}: {
  data: ScreeningComments | null;
  /** What is said when the comments couldn't be loaded. */
  notLoaded: string;
  mode: 'profile' | 'record';
  /** The record's comments (record mode). */
  comments?: readonly ScreeningCommentView[];
  defaultTarget: string;
}) {
  const [filter, setFilter] = useState('all');
  const filters = useMemo(() => (data && mode === 'profile' ? commentFilters(data) : []), [data, mode]);
  const shown = data ? (mode === 'profile' ? filteredComments(data.comments, filter, data.targets) : [...(comments ?? [])]) : [];
  return (
    <section id="screening-comments" aria-labelledby="screening-comments-title" className="card scroll-mt-4 space-y-4 p-6">
      <h2 id="screening-comments-title" className="text-lg font-semibold">
        Screening Comments
      </h2>
      {!data ? (
        <p className="text-sm text-muted">{notLoaded}</p>
      ) : (
        <>
          {mode === 'profile' && filters.length > 2 && (
            <div role="group" aria-label="Show comments about" className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold ${filter === f.key ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-canvas'}`}
                >
                  {f.label}
                  <span className="tabular-nums">{f.count}</span>
                </button>
              ))}
            </div>
          )}
          <CommentList comments={shown} data={data} ownKey={mode === 'record' ? defaultTarget : undefined} empty={filter === 'all' ? 'No comments yet.' : 'No comments about this yet.'} />
          <CommentForm data={data} defaultTarget={defaultTarget} />
        </>
      )}
    </section>
  );
}
