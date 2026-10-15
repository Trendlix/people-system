// The banks of Egypt as the EG-ACH banks list gives them (the owner's file "BankAccountLengthFile", 15 October 2026):
// each bank's abbreviation, BIC code and the length of its account numbers, for the employee's bank details. Salaries
// are sent through EG-ACH, so the bank is picked from this list and its account number has the length the bank uses.
// `parts`: how the bank's account numbers are made up, as the file describes them; where the parts the file gives don't
// add up to the length it gives, only their names are kept, and the length is the rule.

export interface Bank {
  name: string;
  short: string;
  bic: string;
  /** The lengths its account numbers may have; empty when the list gives none (N/A). */
  lengths: readonly number[];
  /** Instead of exact lengths: at most this many digits. */
  upTo?: number;
  parts?: string;
}

export const BANKS: readonly Bank[] = [
  { name: 'Arab African International Bank', short: 'AAIB', bic: 'ARAIEGCXXXX', lengths: [13, 16], parts: 'Account number (6), account type (4), suffix (3); 16 digits when written without the branch' },
  { name: 'Arab Banking Corporation', short: 'ABC', bic: 'EAABEGCXXXX', lengths: [16], parts: 'Customer ID (6), account type (4), currency (2), suffix (3), check digit (1)' },
  { name: 'Al Ahli Bank of Kuwait – Egypt', short: 'ABK', bic: 'ECBAEGCAXXX', lengths: [], upTo: 10 },
  { name: 'Abu Dhabi Islamic Bank – Egypt', short: 'ADIB', bic: 'ABDIEGCAXXX', lengths: [12] },
  { name: 'Al Baraka Bank Egypt', short: 'ABRK', bic: 'ABRKEGCAXXX', lengths: [13], parts: 'Branch code (4), account number (6), suffix (3)' },
  { name: 'Arab Investment Bank', short: 'AIB', bic: 'AINBEGCAXXX', lengths: [6], parts: 'The customer ID' },
  { name: 'Arab Bank', short: 'ARAB', bic: 'ARABEGCXXXX', lengths: [13], parts: 'Branch code (4), account number (6), suffix (3)' },
  { name: 'Arab International Bank', short: 'ARIB', bic: 'ARIBEGCXXXX', lengths: [13] },
  { name: 'Ahly United Bank', short: 'AUB', bic: 'DEIBEGCXXXX', lengths: [13], parts: 'Branch code (4), account number (6), suffix (3)' },
  { name: 'Audi Bank', short: 'AUDI', bic: 'AUDBEGCAXXX', lengths: [12, 16], parts: 'Starts with 00' },
  { name: 'Attijariwafa Bank Egypt', short: 'BBE', bic: 'BCBIEGCXXXX', lengths: [11] },
  { name: 'Banque Du Caire', short: 'BDC', bic: 'BCAIEGCXXXX', lengths: [14], parts: 'Branch code (4), account type (3), account number (7)' },
  { name: 'Blom Bank Egypt', short: 'BLOM', bic: 'MRBAEGCXXXX', lengths: [12] },
  { name: 'Bank of Alexandria', short: 'BOA', bic: 'ALEXEGCXXXX', lengths: [12], parts: 'Branch code (3), 000, account number (6)' },
  { name: 'Credit Agricole Egypt', short: 'CAE', bic: 'AGRIEGCXXXX', lengths: [14], parts: 'Branch code, account type, account number' },
  { name: 'Central Bank of Egypt', short: 'CBE', bic: 'CBEGEGCXXXX', lengths: [] },
  { name: 'Commercial International Bank', short: 'CIB', bic: 'CIBEEGCXXXX', lengths: [12] },
  { name: 'Citibank', short: 'CITI', bic: 'CITIEGCXXXX', lengths: [10], parts: 'Customer category (1), CIF (6), serial (3)' },
  { name: 'Egyptian Arab Land Bank', short: 'EALB', bic: 'ARLBEGCAXXX', lengths: [20], parts: 'Branch code, account number' },
  { name: 'Export Development Bank of Egypt', short: 'EDBE', bic: 'EXDEEGCXXXX', lengths: [16] },
  { name: 'Egyptian Gulf Bank', short: 'EGB', bic: 'EGGBEGCAXXX', lengths: [13], parts: 'Branch code (4), account number (6), suffix (3)' },
  { name: 'Emirates National Bank of Dubai', short: 'ENBD', bic: 'EBILEGCXXXX', lengths: [13], parts: 'Branch code, account number, account type, currency' },
  { name: 'First Abu Dhabi Bank', short: 'FAB', bic: 'NBADEGCAXXX', lengths: [10, 11, 13], parts: 'Currency (2), account type (3), account number (6), suffix (2)' },
  { name: 'Faisal Islamic Bank of Egypt', short: 'FAIB', bic: 'FIEGEGCXXXX', lengths: [9, 12], parts: '12 digits written without the branch, 9 with it' },
  { name: 'Housing And Development Bank', short: 'HDB', bic: 'HDBKEGCAXXX', lengths: [13], parts: 'Account number, general ledger, account type, currency' },
  { name: 'HSBC', short: 'HSBC', bic: 'EBBKEGCXXXX', lengths: [12], parts: 'Branch code (3), account number (6), suffix (3)' },
  { name: 'Industrial Development Bank of Egypt', short: 'IDB', bic: 'DIBBEGCAXXX', lengths: [19], parts: 'Sequence, ledger, currency, account number, branch code' },
  { name: 'Mashreq Bank', short: 'MASH', bic: 'MSHQEGCAXXX', lengths: [12] },
  { name: 'Misr Iran Development Bank', short: 'MIDB', bic: 'MIDBEGCXXXX', lengths: [13], parts: 'Branch code, account number, currency, account type, check digit' },
  { name: 'Banque Misr', short: 'MISR', bic: 'BMISEGCXXXX', lengths: [16], parts: 'Branch code, account type, account number' },
  { name: 'National Bank of Egypt', short: 'NBE', bic: 'NBEGEGCXXXX', lengths: [19], parts: 'Branch code (3), product type (3), CIF ID (8), sequence (5)' },
  { name: 'National Bank of Greece', short: 'NBG', bic: 'ETHNEGCAXXX', lengths: [14], parts: 'Account number (6), account category (2), currency (3), account selection (2), check digit (1)' },
  { name: 'National Bank of Kuwait', short: 'NBK', bic: 'WABAEGCXXXX', lengths: [16], parts: 'Branch code (2), currency (2), account number (7), suffix (4), account selection (1)' },
  { name: 'Nasser Social Bank', short: 'NSB', bic: 'NSOBEGC1XXX', lengths: [14] },
  { name: 'The Principal Bank for Development and Agricultural Credit', short: 'PDAC', bic: 'BDACEGCAXXX', lengths: [] },
  { name: 'Egypt Post', short: 'POST', bic: 'PSTEEGCXXXX', lengths: [16] },
  { name: 'Qatar National Bank Alahli', short: 'QNB', bic: 'QNBAEGCXXXX', lengths: [11] },
  { name: 'Societe Arabe Internationale De Banque', short: 'SAIB', bic: 'SBNKEGCXXXX', lengths: [16], parts: 'Branch code, currency, account number, account type' },
  { name: 'Suez Canal Bank', short: 'SCB', bic: 'SUCAEGCXXXX', lengths: [16], parts: 'Customer ID (8), currency (2), account type (4), suffix (2)' },
  { name: 'The United Bank', short: 'UB', bic: 'UBOEEGCXXXX', lengths: [13], parts: 'Branch code (4), account number (6), suffix (3)' },
  { name: 'Union National Bank', short: 'UNB', bic: 'UNBEEGCXXXX', lengths: [16], parts: 'Type (1), account number (7), account type (4), currency (2), serial (2)' },
];

const byKey = new Map(BANKS.flatMap((b) => [[b.name.toLowerCase(), b], [b.short.toLowerCase(), b]] as const));

/** The bank of that name or abbreviation (any capitals), or undefined for a bank not on the list. */
export function bankNamed(name: string | null | undefined): Bank | undefined {
  return name ? byKey.get(name.trim().toLowerCase()) : undefined;
}

/** "19 digits", "12 or 16 digits", "10, 11 or 13 digits", "up to 10 digits"; null when the list gives no length. */
export function accountLengthText(bank: Bank): string | null {
  if (bank.upTo) return `up to ${bank.upTo} digits`;
  const l = bank.lengths;
  if (!l.length) return null;
  return `${l.length === 1 ? l[0] : `${l.slice(0, -1).join(', ')} or ${l[l.length - 1]}`} digits`;
}

/** Whether an account number (as kept: no spaces) has a length the bank uses. A bank with no length takes any. */
export function accountLengthOk(bank: Bank, account: string): boolean {
  if (bank.upTo) return /^\d+$/.test(account) && account.length <= bank.upTo;
  if (!bank.lengths.length) return true;
  return /^\d+$/.test(account) && bank.lengths.includes(account.length);
}
