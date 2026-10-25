'use client';

import { useEffect, useRef, useState } from 'react';
import {
  APPLICATION_SOURCE_LABELS,
  CV_BATCH_LIMIT,
  GENERAL_CV_LIMITS,
  GENERAL_CV_SOURCE_LABELS,
  HR_CONSENT_TEXT,
  HR_CV_SOURCES,
  MOVE_STAGES,
  APPLICATION_STAGE_LABELS,
  OTHER_POSITION,
  RECRUITMENT_LIMITS,
  type ApplicationSource,
  type CvBatchTarget,
  type CvPositionGroup,
  type CvSaveResult,
  type CvUploadView,
  type GeneralCvSource,
} from '@trendlix/shared';
import { FormErrors, useFieldIds, useKeptForm } from '@/components/form';
import { NoticeInput } from '@/components/notice-input';
import { PhoneInput } from '@/components/phone-input';
import { PositionOptions } from '@/components/position-options';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { POSITION_FIELD } from '../../careers/careers';
import { discardBatch, readBatch, saveBatch, uploadBatchCv } from './general-actions';
import { batchSources, duplicateText, inBatchRepeats, mergeReadings, rowOf, saveRows, type BatchRow } from './general';

// General CVs' forms (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and what cam on
// randomly", "Both"; "is there a way to easy apply from linkedin?" … "why not"): HR's Add a CV, adding one to a vacancy,
// and the bulk upload: many CVs dropped at once, each read for the person's name, email and mobile, checked by HR row by
// row, then saved. The API checks each again. Add a CV takes the mobile and the notice period as the careers page's forms
// do (22 October 2026: the mobile "like the one applied in the system, country code and no extra zero"; the notice period
// "in Days" … "and a selectoor to make it months"). Since 25 October 2026 (owner: "should it be the positions?"; asked,
// "Position, grouped by team") a general CV is for a position, picked from HR's list (the careers page's, with the hidden
// ones too, marked) or Other in words; its team is the position's.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const L = RECRUITMENT_LIMITS;
const CV_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** How often a batch with scans still being read asks again, and for how long at most (22 October 2026). */
const READING_POLL_MS = 10_000;
const READING_POLLS = 90;

const str = (state: FormState, name: string, fallback = '') => {
  const v = state.values?.[name];
  return typeof v === 'string' ? v : fallback;
};

// ---------- Add a CV ----------

/** HR adds a CV that came by email, WhatsApp, LinkedIn, in person or by referral, with the person's agreement. */
export function AddCvForm({ action, positions }: { action: Action; positions: readonly CvPositionGroup[] }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const v = (name: string) => str(state, name);
  const [position, setPosition] = useState(v(POSITION_FIELD));
  const [source, setSource] = useState(v('source'));
  return (
    <form {...form} className="card space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('source')} className="label">
            How it came
          </label>
          <Select id={fid('source')} name="source" required value={source} onChange={(e) => setSource(e.target.value)} className="input">
            <option value="">Choose…</option>
            {HR_CV_SOURCES.map((s) => (
              <option key={s} value={s}>
                {GENERAL_CV_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {source === 'referral' ? (
          <div>
            <label htmlFor={fid('referrer')} className="label">
              Referred by
            </label>
            <input id={fid('referrer')} name="referrer" required maxLength={GENERAL_CV_LIMITS.referrer} defaultValue={v('referrer')} className="input" />
          </div>
        ) : (
          <div className="hidden sm:block" />
        )}
        <div className="sm:col-span-2">
          <label htmlFor={fid('fullName')} className="label">
            Full name
          </label>
          <input id={fid('fullName')} name="fullName" required maxLength={L.name} defaultValue={v('fullName')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('email')} className="label">
            Email
          </label>
          <input id={fid('email')} name="email" type="email" required maxLength={L.email} defaultValue={v('email')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('mobile')} className="label">
            Mobile
          </label>
          <PhoneInput id={fid('mobile')} name="mobile" label="Mobile" required defaultValue={v('mobile')} />
        </div>
        <div>
          <label htmlFor={fid('position')} className="label">
            The position they would like
          </label>
          <Select id={fid('position')} name={POSITION_FIELD} required value={position} onChange={(e) => setPosition(e.target.value)} className="input">
            <option value="">Choose…</option>
            <PositionOptions groups={positions} />
            <option value={OTHER_POSITION}>Other (write it)</option>
          </Select>
        </div>
        {position === OTHER_POSITION ? (
          <div>
            <label htmlFor={fid('positionOther')} className="label">
              Which position
            </label>
            <input id={fid('positionOther')} name="positionOther" required maxLength={GENERAL_CV_LIMITS.positionOther} defaultValue={v('positionOther')} className="input" />
          </div>
        ) : (
          <div className="hidden sm:block" />
        )}
        <div>
          <label htmlFor={fid('linkedin')} className="label">
            LinkedIn <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('linkedin')} name="linkedin" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={L.link} defaultValue={v('linkedin')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('portfolio')} className="label">
            Portfolio <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('portfolio')} name="portfolio" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={L.link} defaultValue={v('portfolio')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('yearsExperience')} className="label">
            Years of experience <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('yearsExperience')} name="yearsExperience" inputMode="decimal" maxLength={4} defaultValue={v('yearsExperience')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('noticePeriod')} className="label">
            Notice period <span className="font-normal text-muted">(optional)</span>
          </label>
          <NoticeInput id={fid('noticePeriod')} defaultNumber={v('noticeNumber')} defaultUnit={v('noticeUnit')} />
        </div>
        <div>
          <label htmlFor={fid('expectedSalary')} className="label">
            Expected salary, EGP a month <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('expectedSalary')} name="expectedSalary" inputMode="numeric" maxLength={12} defaultValue={v('expectedSalary')} className="input" />
        </div>
        <div className="sm:col-span-2">
          {/* the CV's first screening comment, as the person adding it (24 October 2026: HR's notes became comments) */}
          <label htmlFor={fid('notes')} className="label">
            First screening comment <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea id={fid('notes')} name="notes" rows={3} maxLength={L.notes} defaultValue={v('notes')} aria-describedby={fid('notes-hint')} className="input" />
          <p id={fid('notes-hint')} className="hint">
            Kept as your first comment on this CV, for HR, the CEO and a Super Admin.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('cv')} className="label">
            The CV
          </label>
          <input id={fid('cv')} name="cv" type="file" required accept={CV_ACCEPT} aria-describedby={fid('cv-hint')} className="input" />
          <p id={fid('cv-hint')} className="hint">
            A PDF or a Word file (.docx), at most {L.cvMb} MB.
          </p>
        </div>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required defaultChecked={v('consent') === 'on'} className="mt-1 size-4 shrink-0" />
        <span>
          {HR_CONSENT_TEXT}
          <span className="block text-xs text-muted">Kept with your name and the time, as the person’s consent.</span>
        </span>
      </label>
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Adding…' : 'Add the CV'}
      </button>
    </form>
  );
}

// ---------- Add to a vacancy ----------

/** Adds a general CV to an open (or on hold) vacancy at Applied or Shortlisted. */
export function MoveForm({ action, vacancies }: { action: Action; vacancies: { id: string; label: string }[] }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  if (!vacancies.length) return <p className="text-sm text-muted">No vacancy is open (or on hold) to add it to.</p>;
  return (
    <form {...form} className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor={fid('vacancyId')} className="label">
            Vacancy
          </label>
          <Select id={fid('vacancyId')} name="vacancyId" required defaultValue={str(state, 'vacancyId')} className="input">
            <option value="">Choose…</option>
            {vacancies.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        <fieldset className="space-y-1">
          <legend className="label">At</legend>
          <div className="flex min-h-10 flex-wrap items-center gap-4">
            {MOVE_STAGES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="radio" name="stage" value={s} defaultChecked={str(state, 'stage', 'applied') === s} />
                {APPLICATION_STAGE_LABELS[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Adding…' : 'Add to the vacancy'}
        </button>
      </div>
      <p className="hint">Its CV is copied to an application with the same reference. The vacancy’s screening questions weren’t asked, so it has no match (—).</p>
    </form>
  );
}

// ---------- the bulk upload ----------

const sourceLabel = (target: CvBatchTarget, s: string) => (target.kind === 'vacancy' ? APPLICATION_SOURCE_LABELS[s as ApplicationSource] : GENERAL_CV_SOURCE_LABELS[s as GeneralCvSource]) ?? s;

/**
 * Many CVs at once (LinkedIn's Easy Apply CVs, say): chosen or dropped, sent one by one (no request larger than a CV),
 * each read for the person's name, email and mobile. HR checks the rows (a scanned PDF's are theirs to fill in), picks
 * the source (LinkedIn to start with), then saves them: applications at Applied on a vacancy, or general CVs. A row whose
 * email applied already is skipped; a general CV's sent in the last 30 days is kept only when ticked.
 */
export function BulkUpload({ target, initial, positions, doneHref }: { target: CvBatchTarget; initial: CvUploadView[]; positions: readonly CvPositionGroup[]; doneHref: string }) {
  const [rows, setRows] = useState<BatchRow[]>(() => initial.map(rowOf));
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [result, setResult] = useState<CvSaveResult | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'discard' | null>(null);
  const [over, setOver] = useState(false);
  const [polls, setPolls] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const fid = useFieldIds();
  const general = target.kind === 'general';
  const sources = batchSources(target);
  const repeats = inBatchRepeats(rows);

  const edit = (id: string, change: Partial<BatchRow>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)));

  async function take(files: File[]) {
    if (!files.length || progress) return;
    const room = CV_BATCH_LIMIT - rows.length;
    const said: string[] = [];
    if (files.length > room) said.push(`A batch takes at most ${CV_BATCH_LIMIT} CVs: ${room > 0 ? `the first ${room} are uploaded` : 'save or discard these first'}.`);
    const sending = files.slice(0, Math.max(0, room));
    setResult(null);
    setProgress({ done: 0, of: sending.length });
    for (const [n, file] of sending.entries()) {
      if (file.size > L.cvMb * 1024 * 1024) {
        said.push(`${file.name}: larger than ${L.cvMb} MB.`);
      } else {
        const fd = new FormData();
        fd.set('cv', file, file.name);
        try {
          const r = await uploadBatchCv(target, fd);
          if ('upload' in r) {
            setRows((all) => [...all, rowOf(r.upload)]);
            if (r.upload.reading) setPolls(0);
          }
          else said.push(r.error.startsWith(file.name) ? r.error : `${file.name}: ${r.error}`);
        } catch {
          said.push(`${file.name}: could not be uploaded. Please try again.`);
        }
      }
      setProgress({ done: n + 1, of: sending.length });
    }
    setProgress(null);
    setProblems(said);
    if (box.current) box.current.value = '';
  }

  async function save() {
    setBusy('save');
    setProblems([]);
    const r = await saveBatch(target, saveRows(rows, target)).catch(() => ({ errors: ['Could not save. Please try again.'] }));
    setBusy(null);
    if ('errors' in r) {
      setProblems(r.errors);
      return;
    }
    const saved = new Set(r.result.saved.map((s) => s.id));
    setRows((all) => all.filter((x) => !saved.has(x.id)));
    setReasons(Object.fromEntries(r.result.skipped.map((s) => [s.id, s.reason])));
    setResult(r.result);
  }

  async function discard(id?: string) {
    if (!id && !window.confirm(`Discard the ${rows.length} CVs of this batch? Nothing of them is saved.`)) return;
    setBusy('discard');
    const r = await discardBatch(target, id).catch(() => ({ errors: ['Could not discard. Please try again.'] }));
    setBusy(null);
    if (r.errors?.length) {
      setProblems(r.errors);
      return;
    }
    setRows((all) => (id ? all.filter((x) => x.id !== id) : []));
    if (!id) setResult(null);
  }

  const toSave = rows.filter((r) => !r.skip).length;

  // scans being read by the OCR service: their rows filled in as each is read (asked every 10 seconds, for 15 minutes)
  const anyReading = rows.some((r) => r.reading);
  useEffect(() => {
    if (!anyReading || polls >= READING_POLLS) return;
    const timer = window.setTimeout(() => {
      void readBatch(target)
        .then((r) => {
          if ('uploads' in r) setRows((all) => mergeReadings(all, r.uploads));
        })
        .catch(() => undefined)
        .finally(() => setPolls((n) => n + 1));
    }, READING_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [anyReading, polls, target]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(Array.from(e.dataTransfer.files).filter((f) => /\.(pdf|docx)$/i.test(f.name)));
        }}
        className={`card space-y-3 border-2 border-dashed p-6 ${over ? 'border-accent bg-accent-soft' : 'border-line'}`}
      >
        <label htmlFor={fid('files')} className="label">
          CVs to upload
        </label>
        <input
          ref={box}
          id={fid('files')}
          type="file"
          multiple
          accept={CV_ACCEPT}
          disabled={!!progress || rows.length >= CV_BATCH_LIMIT}
          onChange={(e) => void take(Array.from(e.currentTarget.files ?? []))}
          aria-describedby={fid('files-hint')}
          className="input"
        />
        <p id={fid('files-hint')} className="hint">
          Choose or drop PDF or Word files (.docx), each at most {L.cvMb} MB, up to {CV_BATCH_LIMIT} in a batch. Each is read for the name, email and mobile; a scanned PDF is read by the OCR service in a
          minute or two, its row filling in as it is (or fill it in yourself).
        </p>
        {progress && (
          <p role="status" className="text-sm">
            Uploading {Math.min(progress.done + 1, progress.of)} of {progress.of}…
          </p>
        )}
      </div>

      <FormErrors errors={problems} />

      {result && (
        <div role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          <p className="font-semibold">
            {result.saved.length ? `Saved ${result.saved.length}: ${result.saved.map((s) => s.reference).join(', ')}.` : 'Nothing was saved.'}
            {result.skipped.length > 0 && ` ${result.skipped.length} left in the batch: see each row.`}
          </p>
          {result.saved.length > 0 && rows.length === 0 && (
            <a href={doneHref} className="font-semibold">
              Open them
            </a>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <section aria-labelledby={fid('rows')} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id={fid('rows')} className="text-lg font-semibold">
              Check Each CV ({rows.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={fid('all-source')} className="text-sm">
                Source for all
              </label>
              <Select id={fid('all-source')} value="" onChange={(e) => e.target.value && setRows((all) => all.map((r) => ({ ...r, source: e.target.value })))} className="input min-w-36">
                <option value="">Choose…</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(target, s)}
                  </option>
                ))}
              </Select>
              {general && (
                <>
                  <label htmlFor={fid('all-position')} className="text-sm">
                    Position for all
                  </label>
                  <Select id={fid('all-position')} value="" onChange={(e) => e.target.value && setRows((all) => all.map((r) => ({ ...r, position: e.target.value })))} className="input min-w-36">
                    <option value="">Choose…</option>
                    <PositionOptions groups={positions} />
                  </Select>
                </>
              )}
            </div>
          </div>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>CV</th>
                  <th>Full name</th>
                  <th>Email</th>
                  <th>Mobile</th>
                  <th>Source</th>
                  {general && <th>Position</th>}
                  <th>Save</th>
                  <th className="sr-only">Remove</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dup = repeats.has(r.id) ? 'The same email is earlier in this batch: it will be skipped.' : r.duplicate && !r.duplicate.inBatch ? duplicateText(r.duplicate, target) : null;
                  const reason = reasons[r.id];
                  return (
                    <tr key={r.id} className={r.skip ? 'opacity-60' : undefined}>
                      <td className="max-w-48 text-sm">
                        <span className="block truncate font-semibold" title={r.fileName}>
                          {r.fileName}
                        </span>
                        {r.reading ? (
                          <span role="status" className="badge mt-1 bg-accent-soft text-accent">
                            {polls >= READING_POLLS ? 'Still reading: refresh later, or fill it in' : 'Reading…'}
                          </span>
                        ) : (
                          !r.textFound && <span className="badge mt-1 bg-warn-soft text-warn">No text found: fill it in</span>
                        )}
                        {dup && <span className="mt-1 block text-xs text-warn">{dup}</span>}
                        {reason && <span className="mt-1 block text-xs text-danger">{reason}</span>}
                      </td>
                      <td>
                        <input aria-label={`Full name, ${r.fileName}`} value={r.fullName} maxLength={L.name} onChange={(e) => edit(r.id, { fullName: e.target.value })} className="input min-w-44" />
                      </td>
                      <td>
                        <input aria-label={`Email, ${r.fileName}`} type="email" value={r.email} maxLength={L.email} onChange={(e) => edit(r.id, { email: e.target.value })} className="input min-w-52" />
                      </td>
                      <td>
                        <input aria-label={`Mobile, ${r.fileName}`} type="tel" value={r.mobile} maxLength={L.mobile} onChange={(e) => edit(r.id, { mobile: e.target.value })} className="input min-w-40" />
                      </td>
                      <td>
                        <Select aria-label={`Source, ${r.fileName}`} value={r.source} onChange={(e) => edit(r.id, { source: e.target.value })} className="input min-w-36">
                          {sources.map((s) => (
                            <option key={s} value={s}>
                              {sourceLabel(target, s)}
                            </option>
                          ))}
                        </Select>
                        {general && r.source === 'referral' && (
                          <input
                            aria-label={`Referred by, ${r.fileName}`}
                            placeholder="Referred by"
                            value={r.referrer}
                            maxLength={GENERAL_CV_LIMITS.referrer}
                            onChange={(e) => edit(r.id, { referrer: e.target.value })}
                            className="input mt-2 min-w-36"
                          />
                        )}
                      </td>
                      {general && (
                        <td>
                          <Select aria-label={`Position, ${r.fileName}`} value={r.position} onChange={(e) => edit(r.id, { position: e.target.value })} className="input min-w-36">
                            <option value="">Choose…</option>
                            <PositionOptions groups={positions} />
                            <option value={OTHER_POSITION}>Other (write it)</option>
                          </Select>
                          {r.position === OTHER_POSITION && (
                            <input
                              aria-label={`Which position, ${r.fileName}`}
                              placeholder="Which position"
                              value={r.positionOther}
                              maxLength={GENERAL_CV_LIMITS.positionOther}
                              onChange={(e) => edit(r.id, { positionOther: e.target.value })}
                              className="input mt-2 min-w-36"
                            />
                          )}
                        </td>
                      )}
                      <td className="text-sm">
                        <label className="flex items-center gap-2 whitespace-nowrap">
                          <input type="checkbox" checked={!r.skip} onChange={(e) => edit(r.id, { skip: !e.target.checked })} />
                          Save
                        </label>
                        {general && r.duplicate && !r.duplicate.inBatch && (
                          <label className="mt-1 flex items-center gap-2 whitespace-nowrap">
                            <input type="checkbox" checked={r.keep} onChange={(e) => edit(r.id, { keep: e.target.checked })} />
                            Keep
                          </label>
                        )}
                      </td>
                      <td>
                        <button type="button" onClick={() => void discard(r.id)} disabled={!!busy} className="btn btn-secondary min-h-9 px-3 text-sm">
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            {general
              ? 'Each is saved as a general CV, its consent recorded as yours (by HR).'
              : 'Each is saved as an application at Applied, its consent recorded as yours (by HR, LinkedIn Easy Apply for LinkedIn). The screening questions weren’t asked, so it has no match (—).'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={!!busy || !!progress || toSave === 0} className="btn btn-primary">
              {busy === 'save' ? 'Saving…' : `Save ${toSave} ${toSave === 1 ? 'CV' : 'CVs'}`}
            </button>
            <button type="button" onClick={() => void discard()} disabled={!!busy || !!progress} className="btn btn-secondary">
              {busy === 'discard' ? 'Discarding…' : 'Discard the batch'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
