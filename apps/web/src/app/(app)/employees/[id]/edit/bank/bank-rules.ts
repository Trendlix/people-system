import { accountLengthOk, accountLengthText, bankNamed, type Bank } from '@trendlix/shared';

// The account number's rule for a bank on the EG-ACH banks list (packages/shared banks.ts), as the bank details form
// shows it: a hint with the length the bank uses and how its numbers are made up, and a count of the digits typed. The
// API keeps the number without spaces or dashes and refuses a length the bank doesn't use, so the form only warns. Also
// the bank as the profile shows it.

/** The account number as the API keeps it: Arabic-Indic digits (٠-٩) as 0-9, without spaces or dashes. */
export function accountKept(typed: string): string {
  return typed.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s-]+/g, '');
}

/** "Branch code (3), …" as "branch code (3), …"; a first word in capitals (CIF) stays as it is. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * "National Bank of Egypt account numbers have 19 digits: branch code (3), product type (3), CIF ID (8), sequence (5)."
 * Without the part after the colon when the list doesn't say how the numbers are made up; null when it gives no length.
 */
export function accountHint(bank: Bank): string | null {
  const length = accountLengthText(bank);
  if (!length) return null;
  const rule = `${bank.name} account numbers have ${length}`;
  if (!bank.parts) return `${rule}.`;
  const start = /^starts with (.+)$/i.exec(bank.parts); // "Starts with 00": read as one sentence
  return start ? `${rule} and start with ${start[1]}.` : `${rule}: ${lowerFirst(bank.parts)}.`;
}

export interface AccountCount {
  /** "12 of 19 digits", "14 digits (13 or 16)", "15 digits (up to 10)", or, for a bank with no length, "12 digits". */
  text: string;
  /** The bank uses this length (and the number is digits only). */
  fits: boolean;
  /** Wrong whatever is typed next: more digits than the bank uses, or something that isn't a digit. */
  over: boolean;
}

const digits = (n: number) => `${n} digit${n === 1 ? '' : 's'}`;
/** [13, 16] as "13 or 16"; [10, 11, 13] as "10, 11 or 13". */
const either = (l: readonly number[]) => (l.length === 1 ? String(l[0]) : `${l.slice(0, -1).join(', ')} or ${l[l.length - 1]}`);

/** The count shown under the account number while it is typed; null while it is empty. */
export function accountCount(bank: Bank, typed: string): AccountCount | null {
  const kept = accountKept(typed);
  if (!kept) return null;
  const n = kept.replace(/\D/g, '').length;
  const notDigits = /\D/.test(kept);

  // no length on the list: any number is taken, so this is only a count
  if (!bank.upTo && !bank.lengths.length) return { text: notDigits ? `${kept.length} characters` : digits(n), fits: true, over: false };

  const text = bank.upTo
    ? `${digits(n)} (up to ${bank.upTo})`
    : bank.lengths.length === 1
      ? `${n} of ${digits(bank.lengths[0])}`
      : `${digits(n)} (${either(bank.lengths)})`;
  const longest = bank.upTo ?? Math.max(...bank.lengths);
  return {
    text: notDigits ? `${text}. Only digits, spaces and dashes.` : text,
    fits: accountLengthOk(bank, kept),
    over: notDigits || n > longest,
  };
}

/** The bank as saved, with its abbreviation when it is on the list: "National Bank of Egypt (NBE)". */
export function bankShown(name: string | null | undefined): string | null | undefined {
  const bank = bankNamed(name);
  if (!name || !bank || bank.short.toLowerCase() === name.trim().toLowerCase()) return name;
  return `${name} (${bank.short})`;
}
