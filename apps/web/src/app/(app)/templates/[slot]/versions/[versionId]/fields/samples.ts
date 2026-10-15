import {
  pdfBoxCharacters,
  TAG_GROUP_LABELS,
  TAG_GROUPS,
  TEMPLATE_TAGS,
  type PdfField,
  type PdfFieldAlign,
  type PdfFieldKind,
  type PdfRect,
  type TagGroup,
  type TemplateLanguage,
  type TemplateTag,
} from '@trendlix/shared';
import { boxCount, round2 } from './place';

// What Place Fields draws in each field so its place can be judged by eye (the tag's label, or sample characters in the
// boxes: no one's real data), the defaults of a new field of each kind, and the words that name a field. Pure code,
// tested; no "@/" imports.

const TAGS: ReadonlyMap<string, TemplateTag> = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));

/** A tag of the tag list, or undefined. */
export const tagInfo = (tag: string | null | undefined): TemplateTag | undefined => (tag ? TAGS.get(tag) : undefined);

/** The tags by group, in the tag list's order (the side panel's list). */
export const TAGS_BY_GROUP: readonly { group: TagGroup; label: string; tags: readonly TemplateTag[] }[] = TAG_GROUPS.map((group) => ({
  group,
  label: TAG_GROUP_LABELS[group],
  tags: TEMPLATE_TAGS.filter((t) => t.group === group),
})).filter((g) => g.tags.length > 0);

/** A date tag (DD/MM/YYYY), a month tag (MM/YYYY, the ID's issue date), or neither. */
export function dateKind(tag: string | null | undefined): 'date' | 'month' | null {
  const note = tagInfo(tag)?.note ?? '';
  if (note.includes('DD/MM/YYYY')) return 'date';
  if (note.includes('MM/YYYY')) return 'month';
  return null;
}

/** An amount of the Pay group (15,000.50), whose pounds or piastres alone can go in boxes; not its words or a share. */
export function isAmountTag(tag: string | null | undefined): boolean {
  const t = tagInfo(tag);
  return !!t && t.group === 'pay' && !/words|percent|^allowances(_ar|_en)?$/.test(t.tag);
}

const DIGITS = '1234567890';

/**
 * A plausible value of a tag, never anyone's data: a national ID 29001011234567, a date 15/10/2026 (a month 10/2026),
 * an amount 16,700.50, a mobile 01012345678; anything else as digits, `length` of them.
 */
export function sampleValue(tag: string | null | undefined, length = 10): string {
  if (tag?.includes('national_id')) return '29001011234567';
  const date = dateKind(tag);
  if (date === 'date') return '15/10/2026';
  if (date === 'month') return '10/2026';
  if (tag === 'basic_percent') return '80%';
  if (isAmountTag(tag)) return '16,700.50';
  if (tag === 'phone') return '01012345678';
  const n = Math.max(1, Math.min(60, Math.floor(length)));
  return DIGITS.repeat(Math.ceil(n / DIGITS.length)).slice(0, n);
}

/** The characters a boxes field shows in its boxes, from its tag's sample value, as the filled PDF would print them. */
export function boxSamples(field: PdfField): string[] {
  return pdfBoxCharacters(field, sampleValue(field.tag, boxCount(field)));
}

/** The mark a check field prints: ✓ unless it says another. */
export const checkMark = (field: Pick<PdfField, 'text'>) => field.text?.trim() || '✓';

/**
 * What a text, check or fixed field shows: the tag's label in the template's language (Arabic but for an English
 * template), the check's mark, or the fixed text.
 */
export function sampleText(field: PdfField, language: TemplateLanguage): string {
  if (field.kind === 'check') return checkMark(field);
  if (field.kind === 'fixed') return field.text ?? '';
  const t = tagInfo(field.tag);
  if (!t) return field.tag ?? '';
  return language === 'en' ? t.labelEn : t.labelAr;
}

export const KIND_LABELS: Record<PdfFieldKind, string> = { text: 'Text', boxes: 'Boxes', check: 'Check mark', fixed: 'Fixed text' };

/** A field in words, for the list of fields and screen readers: its tag's name, or what kind of field it is. */
export function fieldLabel(field: PdfField): string {
  const t = tagInfo(field.tag);
  if (field.kind === 'check') return t ? `Check mark: ${t.labelEn}${field.equals ? ` is ${field.equals}` : ''}` : 'Check mark';
  if (field.kind === 'fixed') return field.text?.trim() ? `Fixed text: ${field.text.trim()}` : 'Fixed text';
  return t?.labelEn ?? field.tag ?? 'No tag chosen';
}

/** How a text or fixed field lines up by default: to the right for Arabic, to the left for English. */
export const defaultAlign = (language: TemplateLanguage): PdfFieldAlign => (language === 'en' ? 'left' : 'right');

/** The font size of a new field, in points. */
export const DEFAULT_FONT_SIZE = 11;

/** What is picked in the side panel to place on the form: a tag (a text field, Boxes chosen after), a check mark, or fixed text. */
export type PaletteItem = { kind: 'tag'; tag: string } | { kind: 'check' } | { kind: 'fixed' };

/** The size a field of each kind takes when it is placed with a click, in points. */
export function defaultSize(kind: PdfFieldKind, boxes = 10): { width: number; height: number } {
  if (kind === 'check') return { width: 12, height: 12 };
  if (kind === 'boxes') return { width: boxes * 14, height: 16 };
  if (kind === 'fixed') return { width: 120, height: 16 };
  return { width: 150, height: 16 };
}

/**
 * How a tag's boxes start: a national ID's 14; a date's 8 split day, month, year (year first, the day in the right-most
 * boxes, on an Arabic form); a month's 6; an amount's pounds, ending in the right-most box; a mobile's 11; else 10.
 */
export function defaultBoxes(tag: string | null | undefined, language: TemplateLanguage): Pick<PdfField, 'boxes' | 'groups' | 'dateOrder' | 'amountPart' | 'boxAlign'> {
  const ymd = language !== 'en';
  const date = dateKind(tag);
  if (tag?.includes('national_id')) return { boxes: 14 };
  if (date === 'date') return { boxes: 8, groups: ymd ? [4, 2, 2] : [2, 2, 4], dateOrder: ymd ? 'YMD' : 'DMY' };
  if (date === 'month') return { boxes: 6, groups: ymd ? [4, 2] : [2, 4], dateOrder: ymd ? 'YMD' : 'DMY' };
  if (isAmountTag(tag)) return { boxes: 6, amountPart: 'pounds', boxAlign: 'right' };
  if (tag === 'phone') return { boxes: 11 };
  return { boxes: 10 };
}

/** A new field of what was picked, in `rect` on page `page`. */
export function newField(item: PaletteItem, id: string, page: number, rect: PdfRect, language: TemplateLanguage): PdfField {
  const base = { id, page, x: rect.x, y: rect.y, width: rect.width, height: rect.height, fontSize: DEFAULT_FONT_SIZE };
  if (item.kind === 'check') return { ...base, kind: 'check', tag: null };
  if (item.kind === 'fixed') return { ...base, kind: 'fixed', tag: null, text: '', align: defaultAlign(language) };
  return { ...base, kind: 'text', tag: item.tag, align: defaultAlign(language), shrinkToFit: true };
}

/** What every kind keeps: where the field is and its font. */
function common(field: PdfField): PdfField {
  const { id, page, x, y, width, height, fontSize, bold } = field;
  return { id, kind: field.kind, tag: field.tag, page, x, y, width, height, fontSize, bold };
}

/**
 * A field turned into another kind, with that kind's defaults: Boxes takes its tag's boxes (defaultBoxes); a check keeps
 * the tag, to compare with; fixed text drops it.
 */
export function changeKind(field: PdfField, kind: PdfFieldKind, language: TemplateLanguage): PdfField {
  if (kind === field.kind) return field;
  const base = { ...common(field), kind };
  if (kind === 'boxes') return { ...base, ...defaultBoxes(field.tag, language), boxGap: 0, groupGap: 0 };
  if (kind === 'check') return { ...base, equals: '' };
  if (kind === 'fixed') return { ...base, tag: null, text: '', align: field.align ?? defaultAlign(language) };
  return { ...base, align: field.align ?? defaultAlign(language), shrinkToFit: true };
}

/** A field given another tag: a boxes field takes the new tag's boxes, keeping its gaps and digits. */
export function changeTag(field: PdfField, tag: string | null, language: TemplateLanguage): PdfField {
  if (field.kind !== 'boxes') return { ...field, tag };
  return { ...field, tag, groups: undefined, dateOrder: undefined, amountPart: undefined, boxAlign: undefined, nudges: undefined, ...defaultBoxes(tag, language) };
}

/** A font size typed, kept within PDF_FONT_SIZE_MIN–MAX and to a hundredth. */
export const fontSizeOf = (value: number, min: number, max: number) => round2(Math.min(max, Math.max(min, value)));
