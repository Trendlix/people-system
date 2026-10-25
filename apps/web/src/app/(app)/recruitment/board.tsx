'use client';

import { Select } from '@/components/select';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { APPLICATION_SOURCE_LABELS, APPLICATION_STAGE_LABELS, HIRING_SUGGESTION_LABELS, RECRUITMENT_LIMITS, type ApplicationStage, type BoardCard, type VacancyBoard } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { candidateBadges } from './candidates';
import { BetterFitLink, FitPercent, MatchValue } from './cv-fit-ui';
import { DeleteApplicantButton } from './delete-ui';
import { daysText, dropOn } from './hiring';
import { applicantHref, makeOfferHref, STAGE_STYLE } from './recruitment';
import { CvUpdatedBadge, VerdictBadge } from './ui';

// A vacancy's pipeline board (Phase 2, owner, 22 October 2026; the brief: "a board with a column per stage, and cards with
// name, match %, source and days in stage"; "drag between columns (keyboard-accessible too), with the same rules as the
// stage actions: Reject asks for a reason; Offer goes through Make offer; Hired only by an accepted offer"). HR drags a
// card, or picks its column in the card's "Move to"; the hiring manager and the CEO read it.

type Move = (id: string, to: 'shortlisted' | 'interview' | 'rejected', reason: string | null, email: boolean) => Promise<FormState>;

/** The reason to reject, asked before a card goes to Rejected, with the "Email the candidate" tick. */
function RejectPrompt({ card, onSend, onCancel, pending }: { card: BoardCard; onSend: (reason: string, email: boolean) => void; onCancel: () => void; pending: boolean }) {
  const fid = useFieldIds();
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState(false);
  return (
    <div role="dialog" aria-labelledby={fid('title')} className="space-y-2 rounded-lg border border-danger/40 bg-white p-4">
      <p id={fid('title')} className="font-semibold">
        Reject {card.fullName}
      </p>
      <label htmlFor={fid('reason')} className="label">
        Why (kept with the application, never sent)
      </label>
      <textarea id={fid('reason')} rows={2} maxLength={RECRUITMENT_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} className="input" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        Email the candidate
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !reason.trim()} onClick={() => onSend(reason.trim(), email)} className="btn btn-danger">
          {pending ? 'Rejecting…' : 'Reject'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** `deletes`: a Super Admin's Delete applicant on each card (owner, 25 October 2026: "applicant alone - superadmin only"). */
export function PipelineBoard({ board, move, deletes = false }: { board: VacancyBoard; move: Move; deletes?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ApplicationStage | null>(null);
  const [rejecting, setRejecting] = useState<BoardCard | null>(null);
  const cards = board.columns.flatMap((c) => c.cards);

  function drop(card: BoardCard, to: ApplicationStage) {
    const what = dropOn(card, to);
    if (what.kind === 'refused') return setState({ errors: [what.reason] });
    if (what.kind === 'offer') return router.push(makeOfferHref(card.id));
    if (what.needsReason) return setRejecting(card);
    start(async () => setState(await move(card.id, what.to as 'shortlisted' | 'interview', null, false)));
  }

  return (
    <div className="space-y-3">
      <FormErrors errors={state.errors} />
      {state.message && !state.errors && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
      {rejecting && (
        <RejectPrompt
          card={rejecting}
          pending={pending}
          onCancel={() => setRejecting(null)}
          onSend={(reason, email) =>
            start(async () => {
              setState(await move(rejecting.id, 'rejected', reason, email));
              setRejecting(null);
            })
          }
        />
      )}
      {board.canMove && <p className="text-xs text-muted">Drag a card to another column, or choose its column under Move to.</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {board.columns.map((col) => (
          <section
            key={col.stage}
            aria-labelledby={`col-${col.stage}`}
            onDragOver={(e) => {
              if (!board.canMove || !dragging) return;
              e.preventDefault();
              setOver(col.stage);
            }}
            onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const card = cards.find((c) => c.id === dragging);
              setDragging(null);
              if (card) drop(card, col.stage);
            }}
            className={`w-64 shrink-0 space-y-2 rounded-lg border p-2 ${over === col.stage ? 'border-accent bg-accent-soft' : 'border-line bg-canvas'}`}
          >
            <h3 id={`col-${col.stage}`} className="flex items-center justify-between px-1 text-sm font-semibold">
              <span>{APPLICATION_STAGE_LABELS[col.stage]}</span>
              <span className="tabular-nums text-muted">{col.cards.length}</span>
            </h3>
            {col.cards.length === 0 && <p className="px-1 py-2 text-xs text-muted">Nobody</p>}
            <ul className="space-y-2">
              {col.cards.map((card) => (
                <li
                  key={card.id}
                  draggable={board.canMove}
                  onDragStart={(e) => {
                    setDragging(card.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`space-y-1 rounded-md border border-line bg-white p-2 text-sm shadow-sm ${board.canMove ? 'cursor-grab' : ''}`}
                >
                  <Link href={applicantHref(card.id)} className="block font-semibold">
                    {card.fullName}
                  </Link>
                  <p className="text-xs text-muted">
                    {/* not asked the screening questions: the CV fit, "72% · CV" (owner, 25 October 2026: "Full CV fit score") */}
                    Match <MatchValue a={card} className="" /> · {APPLICATION_SOURCE_LABELS[card.source]} · {daysText(card.daysInStage)}
                  </p>
                  {typeof card.cvMatchPercent === 'number' && (
                    <div className="text-xs text-muted">
                      CV match <FitPercent percent={card.cvMatchPercent} fit={card.cvFit} className="text-ink" />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {/* another open vacancy the CV fits better (25 October 2026: "and if it recomended to another position based on the CV") */}
                    {card.betterFit && <BetterFitLink badge={card.betterFit} />}
                    {card.upcomingInterviews > 0 && <span className={`badge ${STAGE_STYLE.interview}`}>Interview booked</span>}
                    {card.openOffer && <span className={`badge ${STAGE_STYLE.offer}`}>Offer open</span>}
                    {card.suggestion && <span className="badge bg-warn-soft text-warn">Suggested: {HIRING_SUGGESTION_LABELS[card.suggestion]}</span>}
                    {/* the latest screening verdict (24 October 2026: "Yes: Good fit / Maybe / Not a fit") */}
                    <VerdictBadge verdict={card.verdict} />
                    {/* they applied again with a new CV in the last 7 days (25 October 2026: "Update their application") */}
                    <CvUpdatedBadge shown={card.cvUpdated} />
                    {/* their candidate profile (22 October 2026): "2 applications", "Former employee"; HR, the CEO and a Super Admin only */}
                    {candidateBadges(card.candidate).map((b) => (
                      <span key={b} className={`badge ${b === 'Former employee' || b.startsWith('Employee') ? 'bg-warn-soft text-warn' : 'bg-canvas text-ink'}`}>
                        {b}
                      </span>
                    ))}
                  </div>
                  {board.canMove && (
                    <label className="block text-xs">
                      <span className="sr-only">Move {card.fullName} to</span>
                      <Select
                        value=""
                        disabled={pending}
                        onChange={(e) => {
                          const to = e.target.value as ApplicationStage;
                          if (to) drop(card, to);
                        }}
                        className="input min-h-8 py-1 text-xs"
                      >
                        <option value="">Move to…</option>
                        {board.columns
                          .filter((c) => c.stage !== card.stage)
                          .map((c) => (
                            <option key={c.stage} value={c.stage}>
                              {APPLICATION_STAGE_LABELS[c.stage]}
                            </option>
                          ))}
                      </Select>
                    </label>
                  )}
                  {deletes && <DeleteApplicantButton id={card.id} number={card.number} compact />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {board.filteredOut > 0 && <p className="text-xs text-muted">{board.filteredOut} filtered out by a must-have question are kept off the board: see them in the list.</p>}
    </div>
  );
}
