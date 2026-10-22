'use client';

import { useState } from 'react';
import { QUESTION_KIND_LABELS, QUESTION_KINDS, RECRUITMENT_LIMITS, questionMaxPoints, type QuestionOption, type VacancyQuestion } from '@trendlix/shared';
import { useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { isQuestionKind, moved, newQuestion, nextQuestionKey, withKind } from './recruitment';

// A vacancy's screening questions (owner, 22 October 2026: "the match score uses rules from the screening questions"): up
// to 10, each Yes or no, One choice, A number or Short text; required or not; a must-have (failing it filters the
// applicant out) with the answer wanted, the least number or the accepted options; and the points a good answer gives.
// Sent as JSON in the hidden `questions` field; the API checks every rule.

const L = RECRUITMENT_LIMITS;
const small =
  'inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
const smallDanger =
  'inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

const pointsOf = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export function QuestionsEditor({ initial }: { initial: VacancyQuestion[] }) {
  const [questions, setQuestions] = useState<VacancyQuestion[]>(initial);
  const fid = useFieldIds();
  const update = (i: number, change: Partial<VacancyQuestion>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...change } : q)));
  const updateOption = (i: number, k: number, change: Partial<QuestionOption>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, options: (q.options ?? []).map((o, m) => (m === k ? { ...o, ...change } : o)) } : q)));
  const total = questions.reduce((sum, q) => sum + questionMaxPoints(q), 0);

  return (
    <div className="space-y-4">
      <input type="hidden" name="questions" value={JSON.stringify(questions)} />
      {questions.length === 0 && <p className="text-sm text-muted">No questions yet. Applicants send their details and CV only.</p>}
      <ol className="space-y-4">
        {questions.map((q, i) => {
          const id = (name: string) => fid(`${q.key}-${name}`);
          return (
            <li key={q.key} className="space-y-3 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Question {i + 1}</span>
                <div className="flex flex-wrap gap-1">
                  <button type="button" disabled={i === 0} onClick={() => setQuestions((qs) => moved(qs, i, -1))} className={small}>
                    Move up<span className="sr-only"> question {i + 1}</span>
                  </button>
                  <button type="button" disabled={i === questions.length - 1} onClick={() => setQuestions((qs) => moved(qs, i, 1))} className={small}>
                    Move down<span className="sr-only"> question {i + 1}</span>
                  </button>
                  <button type="button" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} className={smallDanger}>
                    Remove<span className="sr-only"> question {i + 1}</span>
                  </button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <div>
                  <label htmlFor={id('text')} className="label">
                    Question
                  </label>
                  <input id={id('text')} value={q.text} maxLength={L.questionText} onChange={(e) => update(i, { text: e.target.value })} placeholder="e.g. How many years of video editing do you have?" className="input" />
                </div>
                <div>
                  <label htmlFor={id('kind')} className="label">
                    Answer
                  </label>
                  <Select
                    id={id('kind')}
                    value={q.kind}
                    onChange={(e) => {
                      const kind = e.target.value;
                      if (isQuestionKind(kind)) setQuestions((qs) => qs.map((x, j) => (j === i ? withKind(x, kind) : x)));
                    }}
                    className="input"
                  >
                    {QUESTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {QUESTION_KIND_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={q.required || q.knockout} disabled={q.knockout} onChange={(e) => update(i, { required: e.target.checked })} className="size-4" />
                  Required
                </label>
                {q.kind !== 'text' && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={q.knockout} onChange={(e) => update(i, { knockout: e.target.checked, ...(e.target.checked && { required: true }) })} className="size-4" />
                    Must-have: filter out those who don&apos;t meet it
                  </label>
                )}
              </div>
              {q.kind === 'yes_no' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor={id('wanted')} className="label">
                      Answer wanted
                    </label>
                    <Select id={id('wanted')} value={q.wanted ?? 'yes'} onChange={(e) => update(i, { wanted: e.target.value === 'no' ? 'no' : 'yes' })} className="input">
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor={id('points')} className="label">
                      Points for it
                    </label>
                    <input id={id('points')} type="number" min={0} max={L.points} value={q.points ?? 0} onChange={(e) => update(i, { points: pointsOf(e.target.value) })} className="input" />
                  </div>
                </div>
              )}
              {q.kind === 'number' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor={id('atLeast')} className="label">
                      At least
                    </label>
                    <input
                      id={id('atLeast')}
                      type="number"
                      min={0}
                      step="any"
                      value={q.atLeast ?? ''}
                      onChange={(e) => update(i, { atLeast: e.target.value === '' ? null : Number(e.target.value) })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label htmlFor={id('points')} className="label">
                      Points for reaching it
                    </label>
                    <input id={id('points')} type="number" min={0} max={L.points} value={q.points ?? 0} onChange={(e) => update(i, { points: pointsOf(e.target.value) })} className="input" />
                  </div>
                </div>
              )}
              {q.kind === 'choice' && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Options</p>
                  <ul className="space-y-2">
                    {(q.options ?? []).map((o, k) => (
                      <li key={k} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto_auto]">
                        <div>
                          <label htmlFor={id(`o${k}`)} className="sr-only">
                            Option {k + 1}
                          </label>
                          <input id={id(`o${k}`)} value={o.label} maxLength={L.optionText} placeholder={`Option ${k + 1}`} onChange={(e) => updateOption(i, k, { label: e.target.value })} className="input" />
                        </div>
                        <div>
                          <label htmlFor={id(`p${k}`)} className="sr-only">
                            Points for option {k + 1}
                          </label>
                          <input id={id(`p${k}`)} type="number" min={0} max={L.points} value={o.points} onChange={(e) => updateOption(i, k, { points: pointsOf(e.target.value) })} className="input" />
                        </div>
                        {q.knockout ? (
                          <label className="flex min-h-11 items-center gap-2 text-sm">
                            <input type="checkbox" checked={o.accepted} onChange={(e) => updateOption(i, k, { accepted: e.target.checked })} className="size-4" />
                            Accepted
                          </label>
                        ) : (
                          <span />
                        )}
                        <button
                          type="button"
                          disabled={(q.options ?? []).length <= L.optionsMin}
                          onClick={() => update(i, { options: (q.options ?? []).filter((_, m) => m !== k) })}
                          className={smallDanger}
                        >
                          Remove<span className="sr-only"> option {k + 1}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={(q.options ?? []).length >= L.options}
                    onClick={() => update(i, { options: [...(q.options ?? []), { label: '', points: 0, accepted: true }] })}
                    className={small}
                  >
                    Add an option
                  </button>
                  <p className="hint">Points per option{q.knockout ? '; untick the options that filter an applicant out' : ''}.</p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {QUESTION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              disabled={questions.length >= L.questions}
              onClick={() => setQuestions((qs) => [...qs, newQuestion(k, nextQuestionKey(qs))])}
              className="btn btn-secondary min-h-9 px-3 text-sm"
            >
              Add: {QUESTION_KIND_LABELS[k].toLowerCase()}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted tabular-nums">{total ? `A perfect match scores ${total} points.` : 'No question gives points yet: no match % is worked out.'}</p>
      </div>
    </div>
  );
}
