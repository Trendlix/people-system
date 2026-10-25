'use client';

import { useState } from 'react';
import { kindsInWords, PORTFOLIO_FILE_FIELD, PORTFOLIO_KIND_EXAMPLES, PORTFOLIO_LIMITS, portfolioLinkField, RECRUITMENT_LIMITS, type PortfolioAsk, type PortfolioLinkKind } from '@trendlix/shared';
import { PORTFOLIO_BOXES } from './careers';
import { platformLabelOf, portfolioBoxesPatch } from './prefill';

// The portfolio on the careers forms (owner, 25 October 2026, on "Apply for This Job": "for creatives, they need to add
// their portfolios. so based on the positions i have, what kind of portfolios i might need to ask them for?"; asked,
// "Portfolio per position"; packages/shared portfolio.ts): as the position asks, nothing when Hidden; "(optional)"
// after its label when Optional; its hint and the platforms it takes under it; one link box to start with, more up to
// the links allowed (1 to 3), each saying the platform its link is on as it is typed (never fetched); a PDF case study
// when the position takes one (at most 5 MB). Required is checked before sending (careers.ts portfolioProblems), said
// under the group. A box the CV filled is marked "From your CV" until it is changed. In the careers look.

/**
 * A form's portfolio boxes: their links (from `initial`, the values shown again or kept while away at LinkedIn), the
 * boxes the CV filled, and what is wrong with them before sending. `fillFromCv` puts the CV's links in the empty boxes
 * of a kind the position takes (answering whether it filled any).
 */
export function usePortfolioBoxes(initial: (name: string) => string) {
  const [links, setLinks] = useState<string[]>(() => {
    const kept = PORTFOLIO_BOXES.map(initial);
    const last = kept.reduce((n, l, i) => (l ? i + 1 : n), 0);
    return kept.slice(0, last);
  });
  const [fromCv, setFromCv] = useState<ReadonlySet<number>>(new Set());
  const [said, setSaid] = useState<string[]>([]);

  function typed(i: number) {
    if (said.length) setSaid([]);
    setFromCv((s) => {
      if (i < 0) return s.size ? new Set() : s;
      if (!s.has(i)) return s;
      const next = new Set(s);
      next.delete(i);
      return next;
    });
  }

  function fillFromCv(found: Parameters<typeof portfolioBoxesPatch>[1], ask: PortfolioAsk): boolean {
    const { boxes, filled } = portfolioBoxesPatch(links, found, ask);
    if (!filled.length) return false;
    setLinks(boxes);
    setFromCv((s) => new Set([...s, ...filled]));
    return true;
  }

  return { links, setLinks, fromCv, typed, fillFromCv, said, setSaid };
}

export type PortfolioBoxes = ReturnType<typeof usePortfolioBoxes>;

export function PortfolioFields({
  fid,
  ask,
  links,
  onLinks,
  fromCv,
  onTyped,
  said,
}: {
  fid: (name: string) => string;
  ask: PortfolioAsk;
  /** The boxes' links, as typed or filled in. */
  links: readonly string[];
  onLinks: (links: string[]) => void;
  /** The boxes the CV filled, still as filled. */
  fromCv: ReadonlySet<number>;
  /** A box changed (its CV mark goes); -1: the boxes moved (every mark goes). */
  onTyped: (index: number) => void;
  /** What is wrong with it, said under it before sending. */
  said: readonly string[];
}) {
  if (ask.mode === 'hidden') return null;
  const linkKinds = ask.kinds.filter((k): k is PortfolioLinkKind => k !== 'pdf');
  const takesFile = ask.kinds.includes('pdf');
  const max = Math.min(Math.max(ask.maxLinks, PORTFOLIO_LIMITS.linksMin), PORTFOLIO_LIMITS.links);
  const boxes = linkKinds.length ? (links.length ? links.slice(0, max) : ['']) : [];
  const example = linkKinds.find((k) => k !== 'website') ?? linkKinds[0];
  const placeholder = example ? PORTFOLIO_KIND_EXAMPLES[example] : undefined;
  const takes = linkKinds.length ? `On ${kindsInWords(linkKinds)}${takesFile ? ', or a PDF case study' : ''}` : takesFile ? 'A PDF case study' : '';
  const hint = [ask.hint?.trim().replace(/[.\s]+$/, ''), takes].filter(Boolean).join('. ');
  const problemId = fid('portfolio-problem');
  const hintId = fid('portfolio-hint');
  const describedBy = [hint ? hintId : null, said.length ? problemId : null].filter(Boolean).join(' ') || undefined;

  const set = (i: number, value: string) => {
    const next = [...boxes];
    next[i] = value;
    onLinks(next);
    onTyped(i);
  };

  return (
    <fieldset className="space-y-3 border-t border-line pt-8" aria-describedby={describedBy}>
      <legend className="label">
        Portfolio {ask.mode === 'optional' && <span className="font-normal text-muted">(optional)</span>}
      </legend>
      {hint && (
        <p id={hintId} className="hint mt-0">
          {hint}.
        </p>
      )}
      {boxes.map((value, i) => {
        const platform = platformLabelOf(value);
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-end gap-3">
              <input
                id={fid(`portfolio-${i}`)}
                name={portfolioLinkField(i)}
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoComplete="url"
                spellCheck={false}
                maxLength={RECRUITMENT_LIMITS.link}
                placeholder={placeholder}
                aria-label={boxes.length > 1 ? `Portfolio link ${i + 1}` : 'Portfolio link'}
                aria-invalid={said.length ? true : undefined}
                aria-describedby={describedBy}
                value={value}
                onChange={(e) => set(i, e.target.value)}
                className="input min-w-0 flex-1"
              />
              {boxes.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    onLinks(boxes.filter((_, j) => j !== i));
                    // the boxes after it move up: their marks go
                    onTyped(-1);
                  }}
                  className="careers-hint-use shrink-0 pb-3 text-[13px]"
                  aria-label={`Remove portfolio link ${i + 1}`}
                >
                  Remove
                </button>
              )}
            </div>
            {(platform || fromCv.has(i)) && (
              <p className="flex flex-wrap items-center gap-2">
                {platform && <span className="careers-platform">{platform}</span>}
                {fromCv.has(i) && <span className="careers-from">From your CV</span>}
              </p>
            )}
          </div>
        );
      })}
      {boxes.length > 0 && boxes.length < max && (
        <button type="button" onClick={() => onLinks([...boxes, ''])} className="careers-hint-use text-[13px]">
          Add another link
        </button>
      )}
      {takesFile && (
        <div className="pt-2">
          <label htmlFor={fid('portfolioFile')} className="label">
            {linkKinds.length ? 'Or a PDF case study' : 'PDF case study'}
          </label>
          <input id={fid('portfolioFile')} name={PORTFOLIO_FILE_FIELD} type="file" accept=".pdf,application/pdf" aria-describedby={fid('portfolioFile-hint')} className="input" />
          <p id={fid('portfolioFile-hint')} className="hint">
            A PDF, at most {PORTFOLIO_LIMITS.fileMb} MB.
          </p>
        </div>
      )}
      {said.length > 0 && (
        <div id={problemId}>
          {said.map((p) => (
            <p key={p} className="careers-problem">
              {p}
            </p>
          ))}
        </div>
      )}
    </fieldset>
  );
}
