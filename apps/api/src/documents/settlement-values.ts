import { ADVANCE_KIND_LABELS, type AdvanceKind } from '@trendlix/shared';
import { printedMoney, type PrintedLanguage } from './format.js';

// What the clearance and dues document (إقرار إخلاء طرف واستلام مستحقات) prints of the final settlement (20 October 2026:
// the owner unsure, Claude recommended listing them; until then {{deductions}} was always empty): one line for each
// advance or loan still owed on leaving, deducted from the final settlement (owner, 18 October 2026: "taken from the
// final settlement, unless waived") or waived; the unused annual leave paid with it (Labour Law 14/2025 Art. 125); and
// the total deducted. Money as the documents print it (15,000, or 15,000.50 with piastres). A recurring deduction (a
// monthly share) just stops on leaving, so it has nothing to deduct here. Pure: DocumentsService reads the settlement.

/** An ending's final settlement, as a document prints it. */
export interface SettlementSource {
  /** The advances and loans still owed, the earliest given first; `waived` when HR waived it, else it is deducted. */
  owed: readonly { kind: string; reason: string; outstanding: number; waived: boolean }[];
  /** The annual leave unused on the last working day and paid for; null when there is none, or it isn't known yet (not ended). */
  unusedLeave: { days: number; dayRate: number; amount: number } | null;
}

/** An advance or a loan in Arabic, and whether the word is feminine (سلفة) or not (قرض). */
const KIND_AR: Record<AdvanceKind, { word: string; feminine: boolean }> = { advance: { word: 'سلفة', feminine: true }, loan: { word: 'قرض', feminine: false } };

const egp = (amount: number, language: PrintedLanguage) => (language === 'ar' ? `${printedMoney(amount)} جنيه` : `EGP ${printedMoney(amount)}`);

/** Days as counted: "1 day", "5 days", "2.5 days"; in Arabic "يوم واحد", "يومان", "5 أيام", "12 يومًا", "2.5 يوم". */
export function printedDayCount(days: number, language: PrintedLanguage): string {
  const n = String(days);
  if (language === 'en') return `${n} ${days === 1 ? 'day' : 'days'}`;
  if (!Number.isInteger(days)) return `${n} يوم`;
  if (days === 1) return 'يوم واحد';
  if (days === 2) return 'يومان';
  return days <= 10 ? `${n} أيام` : `${n} يومًا`;
}

/** The total deducted, to the piastre: what is still owed of each advance or loan not waived. */
export function deductedTotal(s: SettlementSource): number {
  return s.owed.filter((o) => !o.waived).reduce((cents, o) => cents + Math.round(o.outstanding * 100), 0) / 100;
}

/**
 * The final settlement's lines (`{{deductions}}` and its _ar and _en forms), joined by line breaks:
 * "Loan (Laptop): EGP 3,000 still owed, deducted", "Advance (Rent): EGP 1,000 still owed, waived",
 * "Unused leave: 5 days × EGP 300 = EGP 1,500" and, after any advance or loan, "Total deducted: EGP 3,000"; in Arabic
 * "قرض (Laptop): المتبقي 3,000 جنيه، مخصوم من المستحقات" … "إجمالي المخصوم: 3,000 جنيه". "None" / "لا يوجد" when there is
 * nothing: none is a value too. Empty without a settlement (no ending recorded), which is then missing.
 */
export function printedDeductions(s: SettlementSource | null | undefined, language: PrintedLanguage): string {
  if (!s) return '';
  const lines = s.owed.map((o) => {
    const kind = o.kind as AdvanceKind;
    const reason = o.reason.trim();
    if (language === 'ar') {
      const { word, feminine } = KIND_AR[kind] ?? { word: o.kind, feminine: false };
      const how = o.waived ? `تم التنازل ${feminine ? 'عنها' : 'عنه'}` : 'مخصوم من المستحقات';
      return `${word}${reason ? ` (${reason})` : ''}: المتبقي ${egp(o.outstanding, 'ar')}، ${how}`;
    }
    return `${ADVANCE_KIND_LABELS[kind] ?? o.kind}${reason ? ` (${reason})` : ''}: ${egp(o.outstanding, 'en')} still owed, ${o.waived ? 'waived' : 'deducted'}`;
  });
  const leave = s.unusedLeave;
  if (leave && leave.days > 0 && leave.dayRate > 0) {
    const sum = `${printedDayCount(leave.days, language)} × ${egp(leave.dayRate, language)} = ${egp(leave.amount, language)}`;
    lines.push(language === 'ar' ? `رصيد الإجازة السنوية غير المستنفد: ${sum}` : `Unused leave: ${sum}`);
  }
  if (s.owed.length) lines.push(language === 'ar' ? `إجمالي المخصوم: ${egp(deductedTotal(s), 'ar')}` : `Total deducted: ${egp(deductedTotal(s), 'en')}`);
  if (!lines.length) return language === 'ar' ? 'لا يوجد' : 'None';
  return lines.join('\n');
}
