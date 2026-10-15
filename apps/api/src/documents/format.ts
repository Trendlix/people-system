import { phoneSplit, type EmploymentType, type Governorate, type TemplateLanguage } from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';
import { arabicDayName, arabicMonths } from './engine/index.js';

// How values are written on a printed document (owner's request, 15 October 2026): dates as DD/MM/YYYY, money as
// 15,000, an Egyptian mobile as it is dialled in Egypt, the address in Arabic with its city and governorate. Pure: no
// database, no templates.

/** A date (YYYY-MM-DD) as printed: DD/MM/YYYY; empty for none. */
export const printedDate = (ymd: string | null): string => (ymd ? shownDate(ymd) : '');

/** The national ID card's issue date as the card prints it: MM/YYYY; empty for none. */
export const printedMonth = (ymd: string | null): string => (ymd ? `${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '');

/** An amount of money as printed: 15,000, or 15,000.50 when there are piastres; empty for none. */
export function printedMoney(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '';
  const cents = Math.round(amount * 100);
  const pounds = Math.trunc(cents / 100).toLocaleString('en-US');
  const piastres = Math.abs(cents % 100);
  return piastres ? `${pounds}.${String(piastres).padStart(2, '0')}` : pounds;
}

/**
 * A phone number as printed: an Egyptian one as it is dialled in Egypt (+201012345678 → 01012345678), one from
 * another country as it is kept (+447700900123).
 */
export function printedPhone(kept: string | null): string {
  if (!kept) return '';
  const { cc, n } = phoneSplit(kept);
  return cc === '20' && n ? `0${n}` : kept;
}

/** The governorates in Arabic, as the address prints them (the profile keeps them in English). */
export const GOVERNORATES_AR: Record<Governorate, string> = {
  Alexandria: 'الإسكندرية',
  Aswan: 'أسوان',
  Asyut: 'أسيوط',
  Beheira: 'البحيرة',
  'Beni Suef': 'بني سويف',
  Cairo: 'القاهرة',
  Dakahlia: 'الدقهلية',
  Damietta: 'دمياط',
  Faiyum: 'الفيوم',
  Gharbia: 'الغربية',
  Giza: 'الجيزة',
  Ismailia: 'الإسماعيلية',
  'Kafr El Sheikh': 'كفر الشيخ',
  Luxor: 'الأقصر',
  Matrouh: 'مطروح',
  Minya: 'المنيا',
  Monufia: 'المنوفية',
  'New Valley': 'الوادي الجديد',
  'North Sinai': 'شمال سيناء',
  'Port Said': 'بورسعيد',
  Qalyubia: 'القليوبية',
  Qena: 'قنا',
  'Red Sea': 'البحر الأحمر',
  Sharqia: 'الشرقية',
  Sohag: 'سوهاج',
  'South Sinai': 'جنوب سيناء',
  Suez: 'السويس',
};

/** Arabic letters lose their hamza and taa marbuta forms, so "الاسكندرية" is found in "الإسكندرية". */
const comparable = (s: string) =>
  s
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ْـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The address as printed: the Arabic address, then the city and the governorate (in Arabic), joined with Arabic commas
 * ("15 شارع عباس العقاد، مدينة نصر، القاهرة"). A part the address already says is not repeated, nor a city that is the
 * governorate's name. Empty without the Arabic address itself: a city alone is no address.
 */
export function printedAddress(addressAr: string | null, city: string | null, governorate: string | null): string {
  const address = addressAr?.trim().replace(/[،,\s]+$/, '');
  if (!address) return '';
  const parts = [address];
  const said = () => comparable(parts.join(' '));
  const governorateAr = governorate ? (GOVERNORATES_AR[governorate as Governorate] ?? governorate) : null;
  for (const part of [city?.trim(), governorateAr]) {
    if (part && !said().includes(comparable(part))) parts.push(part);
  }
  return parts.join('، ');
}

/** The employment types in Arabic, for Arabic templates (the screens' English labels are LABELS.employmentType). */
export const EMPLOYMENT_TYPES_AR: Record<EmploymentType, string> = {
  full_time: 'دوام كامل',
  part_time: 'دوام جزئي',
  internship: 'تدريب',
  freelance: 'عمل حر',
  sales: 'مبيعات',
};

/** A name in the template's language: the Arabic one on an Arabic template when there is one, else the English. */
export const inLanguage = (language: TemplateLanguage, en: string | null | undefined, ar: string | null | undefined): string =>
  (language === 'en' ? en?.trim() || ar?.trim() : ar?.trim() || en?.trim()) ?? '';

/** The language a value is written in (a bilingual template's tags that depend on it print in Arabic). */
export type PrintedLanguage = 'ar' | 'en';

/**
 * A time of day (HH:mm, as a shift keeps it) on the 12-hour clock, as the screens show it (the web's formatTime):
 * "09:00" → "9:00 AM", in Arabic "9:00 ص"; "17:30" → "5:30 PM" / "5:30 م".
 */
export function printedTime(hhmm: string, language: PrintedLanguage): string {
  const [h, m] = hhmm.split(':').map(Number);
  const half = h < 12 ? (language === 'ar' ? 'ص' : 'AM') : language === 'ar' ? 'م' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${half}`;
}

const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A shift's working days (0 = Sunday … 6 = Saturday), in week order (owner's request, 15 October 2026): three or more
 * that follow each other as a range, across the weekend too ("Sunday to Thursday", "من الأحد إلى الخميس"; "Saturday
 * to Thursday"); otherwise listed ("Sunday, Tuesday and Thursday", "أيام الأحد والثلاثاء والخميس"; "Friday and
 * Saturday", "يومي الجمعة والسبت"; "Friday", "يوم الجمعة"). Empty for none.
 */
export function printedDays(workingDays: readonly number[], language: PrintedLanguage): string {
  const days = [...new Set(workingDays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!days.length) return '';
  const name = (d: number) => (language === 'ar' ? arabicDayName(d) : DAY_NAMES_EN[d]);
  // one run of days when a single day starts one (its day before isn't worked), or all seven are worked; then in order
  // from its first day (from Sunday for the whole week), else from Sunday
  const starts = days.filter((d) => !days.includes((d + 6) % 7));
  const oneRun = days.length === 7 || starts.length === 1;
  const first = days.length === 7 ? 0 : starts[0];
  const ordered = oneRun ? days.map((_, i) => (first + i) % 7) : days;
  if (oneRun && ordered.length >= 3) {
    const [from, to] = [name(ordered[0]), name(ordered[ordered.length - 1])];
    return language === 'ar' ? `من ${from} إلى ${to}` : `${from} to ${to}`;
  }
  const names = ordered.map(name);
  if (language === 'ar') return `${['يوم', 'يومي', 'أيام'][Math.min(names.length, 3) - 1]} ${names.join(' و')}`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A shift as printed: its times, then its working days (owner's request, 15 October 2026): "9:00 AM – 5:00 PM, Sunday
 * to Thursday"; in Arabic "من 9:00 ص إلى 5:00 م، من الأحد إلى الخميس". The times alone when it has no working days.
 */
export function printedShift(shift: { startTime: string; endTime: string; workingDays: readonly number[] }, language: PrintedLanguage): string {
  const [start, end] = [printedTime(shift.startTime, language), printedTime(shift.endTime, language)];
  const days = printedDays(shift.workingDays, language);
  const times = language === 'ar' ? `من ${start} إلى ${end}` : `${start} – ${end}`;
  return days ? `${times}${language === 'ar' ? '،' : ','} ${days}` : times;
}

/**
 * A probation period in months as printed (owner's request, 15 October 2026): "3 months", "1 month", "No probation";
 * in Arabic "ثلاثة أشهر", "شهر واحد", "شهران", "لا توجد فترة اختبار". None is a value too.
 */
export function printedProbation(months: number, language: PrintedLanguage): string {
  if (months <= 0) return language === 'ar' ? 'لا توجد فترة اختبار' : 'No probation';
  return language === 'ar' ? arabicMonths(months) : `${months} ${months === 1 ? 'month' : 'months'}`;
}

/** Digits written as Arabic-Indic digits ٠-٩ (owner, 15 October 2026: the national ID on the Arabic side). */
export const arabicDigits = (s: string): string => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));

/** Whether text has Arabic letters in it. */
export const hasArabic = (s: string | null | undefined): boolean => !!s && /[؀-ۿ]/.test(s);

/**
 * A document's file name: "<slot name> - <employee code> - <full name>.docx", cleaned as uploaded templates' names are
 * (Arabic kept; no folders, control characters or < > : " | ? *).
 */
export function documentStem(slotName: string, employeeCode: string, fullNameEn: string): string {
  return [slotName, employeeCode, fullNameEn]
    .map((s) => s.replace(/[\\/]+/g, '-').trim())
    .filter(Boolean)
    .join(' - ');
}
