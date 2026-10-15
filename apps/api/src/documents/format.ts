import { phoneSplit, type EmploymentType, type Governorate, type TemplateLanguage } from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';

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
  (language === 'ar' ? ar?.trim() || en?.trim() : en?.trim() || ar?.trim()) ?? '';

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
