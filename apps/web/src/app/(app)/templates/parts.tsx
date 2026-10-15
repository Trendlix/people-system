import type { EmploymentType, TemplateLanguage, TemplateSigners, TemplateTrigger } from '@trendlix/shared';
import { appliesToLabel, languageLabel, SIGNER_LABELS, triggersLabel, type StatusLine, type StatusTone } from './wording';

// Building blocks shared by the library and a template's page.

/** What a slot is: its language, who it applies to, when it's offered and who signs it. */
export function SlotDetails({
  slot,
  className = '',
}: {
  slot: { language: TemplateLanguage | null; appliesTo: readonly EmploymentType[]; triggers: readonly TemplateTrigger[]; signers: TemplateSigners };
  className?: string;
}) {
  const items: [string, string][] = [
    ['Language', languageLabel(slot.language)],
    ['Applies to', appliesToLabel(slot.appliesTo)],
    ['Offered', triggersLabel(slot.triggers)],
    ['Signed by', SIGNER_LABELS[slot.signers] ?? slot.signers],
  ];
  return (
    <dl className={`grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 ${className}`}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="mt-0.5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TONE: Record<StatusTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-muted',
};

const DOT: Record<StatusTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  muted: 'border border-muted',
};

/** Where a slot stands, line by line (from statusLines). */
export function StatusLines({ lines }: { lines: StatusLine[] }) {
  return (
    <ul className="space-y-1">
      {lines.map((line) => (
        <li key={line.text} className={`flex items-baseline gap-2 text-sm font-medium ${TONE[line.tone]}`}>
          <span aria-hidden="true" className={`inline-block size-2 shrink-0 translate-y-[-1px] rounded-full ${DOT[line.tone]}`} />
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/** A merge tag as written in Word: {{tag}}, in monospace. */
export function Tag({ tag, tone = 'accent' }: { tag: string; tone?: 'accent' | 'danger' }) {
  const colours = tone === 'danger' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-accent/20 bg-accent-soft text-accent';
  return (
    <code dir="ltr" className={`rounded-md border px-1.5 py-0.5 font-mono text-xs break-all ${colours}`}>
      {`{{${tag}}}`}
    </code>
  );
}
