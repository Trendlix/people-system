import { TEMPLATE_TAG_NAMES, type TemplateLanguage } from '@trendlix/shared';

// What Map Fields offers to put where (owner's request, 15 October 2026: "I want a manual mapping fix"). Templates
// come from Word files typed for printing and filling in by hand: a label ("الاسم:", "National ID:") followed by a
// blank of dots, dashes or underscores. Each line is offered:
// - its blanks: runs of 3 or more of . … _ ـ - (an ellipsis counting 2, so "……" is one and a sentence's "…" isn't),
//   with spaces or slashes between them, that a tag may replace. A tatweel stretching a word ("عقــــد") is not a blank, nor the full stop of an abbreviation
//   before one ("Mr. ……");
// - suggestions: a recognised label (FIELD_LABELS) with no tag right after it gets the tag it stands for, in the blank
//   right after it (past a colon, a slash, "(Arabic)" or "in English", and a title such as "السيد/" or "Mr."), or, with
//   no blank, inserted just after it (" {{tag}}", or "{{tag}}" after the space already there) when a colon leads to
//   the end of the line or to the next label, or the label stands alone on its line ("الطرف الأول"). A label
//   followed by other words is prose ("the start date of this contract"), so it gets nothing. Labels are matched
//   whatever their case, spacing, colon or Arabic letter forms (أ إ آ ا, ى ي, ة ه, diacritics and tatweel left out).
//   An English label must start its field (after the line's start, punctuation or "the"): "Company Name:" is not the
//   employee's name. An Arabic one may take the conjunction و ("والجنسية").
// HR checks every suggestion before saving; nothing is put in by itself.

export interface FieldLabels {
  /** The tag; with `perLanguage`, its stem, to which _en or _ar is added by the label's language. */
  tag: string;
  /**
   * 'always': _en for an English label, _ar for an Arabic one ({{full_name_en}} / {{full_name_ar}}).
   * 'bilingual': so on a bilingual template only; on another, the tag itself, printed in the template's language.
   */
  perLanguage?: 'always' | 'bilingual';
  en: readonly string[];
  ar: readonly string[];
}

/** The labels Map Fields recognises (owner's list, 15 October 2026, with a few spellings of the same labels). */
export const FIELD_LABELS: readonly FieldLabels[] = [
  {
    tag: 'full_name',
    perLanguage: 'always',
    en: ['name', 'full name', 'employee name', "employee's name", 'employee full name', 'second party'],
    ar: ['الاسم', 'الاسم بالكامل', 'الاسم الكامل', 'اسم الموظف', 'الطرف الثاني'],
  },
  { tag: 'national_id', en: ['national id', 'national id number', 'id number', 'id no'], ar: ['الرقم القومي', 'رقم قومي', 'رقم البطاقة'] },
  { tag: 'address', en: ['address', 'home address'], ar: ['العنوان', 'عنوانه', 'وعنوانه', 'المقيم في'] },
  { tag: 'job_title', perLanguage: 'bilingual', en: ['job title', 'position'], ar: ['الوظيفة', 'المسمى الوظيفي'] },
  { tag: 'department', perLanguage: 'bilingual', en: ['department'], ar: ['الإدارة', 'القسم'] },
  { tag: 'date', en: ['date'], ar: ['التاريخ', 'الموافق', 'تحريرا في'] },
  {
    tag: 'phone',
    en: ['mobile', 'mobile number', 'phone', 'phone number', 'telephone', 'tel'],
    ar: ['تليفون', 'التليفون', 'رقم التليفون', 'الموبايل', 'رقم الموبايل', 'المحمول', 'رقم المحمول', 'الهاتف', 'رقم الهاتف'],
  },
  { tag: 'join_date', en: ['join date', 'joining date', 'date of joining', 'start date', 'hire date'], ar: ['تاريخ التعيين', 'تاريخ الالتحاق'] },
  { tag: 'gross_salary', en: ['salary', 'gross salary'], ar: ['الراتب', 'الراتب الشامل', 'الأجر الشامل'] },
  { tag: 'insurance_no', en: ['insurance number', 'insurance no', 'social insurance number'], ar: ['الرقم التأميني', 'رقم التأمين'] },
  { tag: 'nationality', en: ['nationality'], ar: ['الجنسية'] },
  { tag: 'date_of_birth', en: ['date of birth', 'birth date'], ar: ['تاريخ الميلاد'] },
  { tag: 'qualification', en: ['qualification'], ar: ['المؤهل', 'المؤهل العلمي'] },
  { tag: 'work_email', en: ['email', 'e-mail', 'email address', 'work email'], ar: ['البريد الإلكتروني'] },
  { tag: 'company_rep_name', en: ['represented by'], ar: ['ويمثلها', 'ممثل الشركة'] },
  // the company's address is kept in Arabic only, so only Arabic labels suggest it
  { tag: 'company_address_ar', en: [], ar: ['ومقرها', 'مقرها', 'مقر الشركة'] },
  { tag: 'company_name', perLanguage: 'always', en: ['first party'], ar: ['الطرف الأول'] },
  { tag: 'employee_code', en: ['employee code'], ar: ['كود الموظف'] },
];

type LabelLanguage = 'en' | 'ar';

/** The tag a label stands for, by its language and the template's. */
export function tagFor(entry: FieldLabels, language: LabelLanguage, template: TemplateLanguage): string {
  const split = entry.perLanguage === 'always' || (entry.perLanguage === 'bilingual' && template === 'bilingual');
  return split ? `${entry.tag}_${language}` : entry.tag;
}

export interface TextRange {
  from: number;
  to: number;
}

export interface FieldSuggestion extends TextRange {
  tag: string;
  /** The label as written in the line, e.g. "الرقم القومي". */
  label: string;
  /** The edit's text: "{{tag}}" for a blank or after a space already there, else " {{tag}}" inserted after the label. */
  text: string;
}

// covers a tag, so nothing is read inside it; never in a Word file, as XML can't hold it
const MASK = '￿';
const TAG = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;
const masked = (text: string) => text.replace(TAG, (tag) => MASK.repeat(tag.length));

// ---------- blanks ----------

const BLANK_RUN = /[._…ـ-](?:[  /]*[._…ـ-])*/g;
const TATWEEL = 'ـ';
const ARABIC_LETTER = /[ء-ؿف-يٱ-ۓ]/;
const DIACRITIC = /[ً-ٰٟ]/;

/** The Arabic letter next to `at` going `step` (diacritics passed over); false when it isn't one. */
function arabicLetterBeside(text: string, at: number, step: 1 | -1): boolean {
  let i = at;
  while (i >= 0 && i < text.length && (DIACRITIC.test(text[i]) || text[i] === TATWEEL)) i += step;
  return i >= 0 && i < text.length && ARABIC_LETTER.test(text[i]);
}

/** Runs of dots, dashes, underscores or tatweel a tag may replace, in order (tags are never part of one). */
export function findBlanks(text: string): TextRange[] {
  const plain = masked(text);
  const out: TextRange[] = [];
  for (const m of plain.matchAll(BLANK_RUN)) {
    let from = m.index;
    const to = from + m[0].length;
    // an abbreviation's full stop ("Mr. ……", "No. ……") is not part of the blank after it
    if (plain[from] === '.' && /\p{L}/u.test(plain[from - 1] ?? '') && /[  ]/.test(plain[from + 1] ?? '')) {
      from++;
      while (from < to && /[  /]/.test(plain[from])) from++;
    }
    const run = plain.slice(from, to);
    let weight = 0;
    for (const ch of run) weight += ch === '…' ? 2 : /[._ـ-]/.test(ch) ? 1 : 0;
    if (weight < 3) continue;
    // a tatweel stretching a word is not a blank
    if (/^ـ+$/.test(run) && arabicLetterBeside(plain, from - 1, -1) && arabicLetterBeside(plain, to, 1)) continue;
    out.push({ from, to });
  }
  return out;
}

// ---------- matching labels ----------

const DROPPED = /[ً-ٰٟ­​-‏‪-‮⁦-⁩﻿]/;
const LETTER_FORMS: Record<string, string> = {
  'أ': 'ا',
  'إ': 'ا',
  'آ': 'ا',
  'ٱ': 'ا',
  'ى': 'ي',
  'ئ': 'ي',
  'ی': 'ي',
  'ة': 'ه',
  'ؤ': 'و',
  'ک': 'ك',
  '’': "'",
  '‘': "'",
  'ʼ': "'",
};

/**
 * The text as labels are matched: lower case, Arabic letter forms made one, diacritics and a word's tatweel left out,
 * spaces made one. `at[i]` is where the i-th character came from in the text.
 */
export function normalise(text: string): { text: string; at: number[] } {
  let out = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DROPPED.test(ch)) continue;
    if (ch === TATWEEL && arabicLetterBeside(text, i - 1, -1) && arabicLetterBeside(text, i + 1, 1)) continue;
    if (/[\s ]/.test(ch)) {
      if (!out.endsWith(' ')) {
        out += ' ';
        at.push(i);
      }
      continue;
    }
    const mapped = LETTER_FORMS[ch] ?? ch.toLowerCase();
    for (const c of mapped) {
      out += c;
      at.push(i);
    }
  }
  return { text: out, at };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Label {
  entry: FieldLabels;
  language: LabelLanguage;
  pattern: RegExp;
}

// Each label as a pattern on normalised text: its words with or without a space between them, standing alone.
const LABELS: readonly Label[] = FIELD_LABELS.flatMap((entry) =>
  (['en', 'ar'] as const).flatMap((language) =>
    entry[language].map((label) => {
      const words = normalise(label).text.trim().split(' ').map(escapeRegExp).join(' ?');
      const conjunction = language === 'ar' ? '(?:و)?' : '';
      return { entry, language, pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${conjunction}${words}(?![\\p{L}\\p{N}_])`, 'gu') };
    }),
  ),
);

interface Match {
  start: number;
  end: number;
  entry: FieldLabels;
  language: LabelLanguage;
}

// An English label starts its field: nothing before it on the line but punctuation, digits, a blank or "the".
function startsField(n: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0 && n[i] === ' ') i--;
  if (i < 0 || !/[a-z]/.test(n[i])) return true;
  let k = i;
  while (k >= 0 && /[a-z']/.test(n[k])) k--;
  return n.slice(k + 1, i + 1) === 'the';
}

/** The labels found, the longest first where they overlap; two overlapping labels of one field make one. */
function labelsIn(n: string): Match[] {
  const found: Match[] = [];
  for (const { entry, language, pattern } of LABELS) {
    for (const m of n.matchAll(pattern)) {
      if (language === 'en' && !startsField(n, m.index)) continue;
      found.push({ start: m.index, end: m.index + m[0].length, entry, language });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Match[] = [];
  for (const m of found) {
    const last = kept.at(-1);
    if (last && m.start < last.end) {
      if (m.entry === last.entry) last.end = Math.max(last.end, m.end); // "National ID Number": national id + id number
      continue;
    }
    kept.push({ ...m });
  }
  return kept;
}

// After a label: "(Arabic)", "in English" … say which language the field is in.
const QUALIFIER = /^(?:\(([^()]{1,40})\)|(in arabic|in english|بالعربيه|بالعربي|بالانجليزيه|بالانجليزي|باللغه العربيه|باللغه الانجليزيه)(?![\p{L}\p{N}]))/u;
const languageOf = (words: string): LabelLanguage | null => (/arabic|عربي/.test(words) ? 'ar' : /english|انجليزي|انكليزي/.test(words) ? 'en' : null);
// A title before the blank for a name: "السيد/", "السيد/ة", "Mr."
const TITLE = /^(?:السيد ?\/ ?ه|السيده|السيد|الساده|الاستاذه|الاستاذ|mrs|mr|ms|miss|dr)(?![\p{L}\p{N}])/u;
const SEPARATORS = new Set([':', '：', '/', '–', '—']);

/** The fields to suggest on a line, in order. */
export function suggestFields(text: string, template: TemplateLanguage, blanks: readonly TextRange[] = findBlanks(text)): FieldSuggestion[] {
  const { text: n, at } = normalise(masked(text));
  const blankAt = new Map(blanks.map((b) => [b.from, b]));
  const blankStarting = (i: number) => (i < n.length ? (blankAt.get(at[i]) ?? null) : null);
  const spaces = (i: number) => {
    while (i < n.length && n[i] === ' ') i++;
    return i;
  };
  /** Just after the i-th normalised character in the text, past any diacritic or mark left out. */
  const after = (i: number) => {
    let j = i > 0 ? at[i - 1] + 1 : 0;
    while (j < text.length && DROPPED.test(text[j])) j++;
    return j;
  };

  const matches = labelsIn(n);
  const starts = new Set(matches.map((m) => m.start));
  const out: FieldSuggestion[] = [];
  for (const m of matches) {
    let language = m.language;
    const place = (): TextRange | null => {
      let i = m.end;
      let end = m.end; // where an inserted tag goes
      const blank = blankStarting(i);
      if (blank) return blank; // "Name……"
      if (n[i] === '.' && m.language === 'en') end = ++i; // "No.", "Tel."
      const qualifier = QUALIFIER.exec(n.slice(spaces(i)));
      if (qualifier) {
        i = end = spaces(i) + qualifier[0].length;
        language = languageOf(qualifier[1] ?? qualifier[2]) ?? language;
      }
      let colon = false;
      for (;;) {
        const j = spaces(i);
        if (j < n.length && !blankStarting(j) && SEPARATORS.has(n[j])) {
          colon ||= n[j] === ':' || n[j] === '：';
          i = end = j + 1;
          continue;
        }
        i = j;
        break;
      }
      // the end of the line: after "Name:", or a label alone ("الطرف الأول"), not the last words of a sentence
      if (i >= n.length) return colon || !/\p{L}/u.test(n.slice(0, m.start)) ? { from: after(end), to: after(end) } : null;
      if (n[i] === MASK) return null; // a tag is there already
      const next = blankStarting(i);
      if (next) return next;
      if (colon && starts.has(i)) return { from: after(end), to: after(end) }; // "Name:<tab>Date:"
      const title = TITLE.exec(n.slice(i));
      if (!title) return null;
      i = end = i + title[0].length;
      for (;;) {
        const j = spaces(i);
        if (j < n.length && !blankStarting(j) && /[./:]/.test(n[j])) {
          i = end = j + 1;
          continue;
        }
        i = j;
        break;
      }
      if (i >= n.length) return { from: after(end), to: after(end) };
      return blankStarting(i);
    };
    let range = place();
    if (!range) continue;
    const tag = tagFor(m.entry, language, template);
    let edit = `{{${tag}}}`;
    if (range.from === range.to) {
      // inserted with a space before it, unless one is there already ("الاسم: " gets "{{tag}}" after its space)
      if (/[ \u00a0]/.test(text[range.from] ?? '')) range = { from: range.from + 1, to: range.from + 1 };
      else edit = ` ${edit}`;
    }
    if (!TEMPLATE_TAG_NAMES.has(tag) || out.some((s) => s.from === range.from && s.to === range.to)) continue;
    out.push({ tag, from: range.from, to: range.to, label: text.slice(at[m.start], after(m.end)), text: edit });
  }
  return out;
}
