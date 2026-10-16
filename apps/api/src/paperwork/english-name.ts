import { normalizeArabic } from './arabic-text.js';

// The ID card is in Arabic only, so the English name HR needs (fullNameEn) is spelled from the Arabic name the card
// gives, part by part, in this order: the spelling the employees already on file use most for that part (what HR saved
// teaches the next card), a list of common names, and failing both a rough letter-by-letter spelling, which is counted so
// that HR is told to check it. Compound names (عبد الله, أبو بكر, جمال الدين) are one part. Nothing is stored for it:
// the employees on file are read each time (from Prime ERP's reader, owner's request of 16 October 2026).

/** How the employees on file spell each part of their names: normalised Arabic part → English spelling → how many. */
export type SpellingsOnFile = Map<string, Map<string, number>>;

/** The English name spelled from the Arabic one, and how many of its parts were spelled only letter by letter. */
export interface SpelledName {
  name: string;
  rough: number;
}

// Common names as they are usually written in English in Egypt (normalised Arabic, see arabic-text.ts).
const COMMON: Record<string, string> = Object.fromEntries(
  [
    'محمد Mohamed|احمد Ahmed|محمود Mahmoud|مصطفي Mostafa|علي Ali|حسن Hassan|حسين Hussein|ابراهيم Ibrahim|اسماعيل Ismail|يوسف Youssef',
    'خالد Khaled|عمر Omar|عمرو Amr|كريم Karim|طارق Tarek|هشام Hesham|سيد Sayed|السيد El Sayed|سعيد Said|سعد Saad|سامي Samy|سامح Sameh',
    'سمير Samir|عادل Adel|مجدي Magdy|حازم Hazem|حاتم Hatem|وليد Walid|ياسر Yasser|اشرف Ashraf|شريف Sherif|تامر Tamer|هاني Hany',
    'اسلام Islam|ايهاب Ehab|ايمن Ayman|نبيل Nabil|جمال Gamal|صلاح Salah|فتحي Fathy|رمضان Ramadan|شعبان Shaaban|رجب Ragab|سليمان Soliman',
    'عثمان Osman|عباس Abbas|حمدي Hamdy|حسام Hossam|عصام Essam|عماد Emad|علاء Alaa|مدحت Medhat|ماهر Maher|منير Mounir|فؤاد Fouad',
    'فاروق Farouk|زكي Zaki|رضا Reda|رافت Raafat|عزت Ezzat|شوقي Shawky|صبري Sabry|فوزي Fawzy|لطفي Lotfy|مراد Mourad|انور Anwar',
    'باسم Bassem|مروان Marwan|زياد Ziad|ادم Adam|يحيي Yehia|عيسي Eissa|موسي Moussa|جورج George|مينا Mina|جرجس Gerges|حنا Hanna',
    'بطرس Boutros|عبد الله Abdallah|عبد الرحمن Abdelrahman|عبد العزيز Abdelaziz|عبد الحميد Abdelhamid|عبد الفتاح Abdelfattah',
    'عبد المنعم Abdelmoneim|عبد الرحيم Abdelrehim|عبد السلام Abdelsalam|عبد الناصر Abdelnasser|عبد الحليم Abdelhalim|عبد اللطيف Abdellatif',
    'فاطمه Fatma|مريم Mariam|مني Mona|نهي Noha|هبه Heba|ساره Sara|نور Nour|ياسمين Yasmin|اميره Amira|دينا Dina|رانيا Rania|ايمان Eman',
    'امل Amal|سلمي Salma|ليلي Laila|زينب Zeinab|عائشه Aisha|خديجه Khadija|ناديه Nadia|سعاد Soad|هدي Hoda|نجلاء Naglaa|مها Maha|ريم Reem',
    'نادين Nadine|جيهان Gehan|سميره Samira|سهير Soheir|عزه Azza|هاله Hala|شيماء Shaimaa|اسماء Asmaa|دعاء Doaa|ولاء Walaa|مروه Marwa',
    'نرمين Nermin|غاده Ghada|داليا Dalia|هند Hend|رشا Rasha|نهله Nahla|مي Mai',
  ]
    .join('|')
    .split('|')
    .map((pair) => {
      const at = pair.search(/ [A-Z]/);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
);

// Each Arabic letter as it is roughly written in English, for a part nobody on file has and the list does not know.
const LETTERS: Record<string, string> = {
  ا: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd',
  ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'o', ي: 'y', ء: '', ؤ: 'o', ئ: 'e',
};

const ARABIC_PART = /^[ء-ي]+$/;
const ENGLISH_WORD = /^[A-Za-z][A-Za-z'-]*$/;

/**
 * A name split into parts that line up between Arabic and English: عبد and أبو (Abd, Abdel, Abu, El …) join the word
 * after them, and الدين (El Din) the word before, so "عبد الرحمن" and "Abdelrahman", "السيد" and "El Sayed", "جمال الدين"
 * and "Gamal El Din" are one part each. Arabic is normalised first.
 */
export function nameParts(name: string, arabic: boolean): string[] {
  const words = (arabic ? normalizeArabic(name) : name.trim()).split(/\s+/).filter(Boolean);
  const joinsNext = arabic ? /^(عبد|ابو)$/ : /^(abd|abdel|abdul|abdal|abu|abou|el|al)$/i;
  const joinsPrevious = arabic ? /^الدين$/ : /^(el|al|ed)[ -]?din$/i;
  const parts: string[] = [];
  let glue = false;
  for (const word of words) {
    if (glue && parts.length) parts[parts.length - 1] += ` ${word}`;
    else parts.push(word);
    glue = joinsNext.test(word);
  }
  return parts.reduce<string[]>((out, part) => {
    if (out.length && joinsPrevious.test(part)) out[out.length - 1] += ` ${part}`;
    else out.push(part);
    return out;
  }, []);
}

/** "MOHAMED" or "mohamed" → "Mohamed"; a name that already mixes capitals (McAdam) keeps them. */
function properWord(word: string): string {
  if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word;
  return word.toLowerCase().replace(/(^|[-'])([a-z])/g, (_m, before: string, letter: string) => before + letter.toUpperCase());
}

/**
 * How the employees on file spell each part of their names, from their Arabic and English names. An employee counts
 * only when both names have as many parts, the Arabic is in Arabic letters, and the English is made of Latin letters
 * (no digits), so that the parts line up one to one.
 */
export function spellingsOnFile(employees: { fullNameAr: string; fullNameEn: string }[]): SpellingsOnFile {
  const seen: SpellingsOnFile = new Map();
  for (const { fullNameAr, fullNameEn } of employees) {
    const ar = nameParts(fullNameAr, true);
    const en = nameParts(fullNameEn, false);
    if (!ar.length || ar.length !== en.length) continue;
    if (!ar.every((p) => p.split(' ').every((w) => ARABIC_PART.test(w)))) continue;
    if (!en.every((p) => p.split(' ').every((w) => ENGLISH_WORD.test(w)))) continue;
    ar.forEach((part, i) => {
      const spelled = en[i].split(' ').map(properWord).join(' ');
      const counts = seen.get(part) ?? new Map<string, number>();
      counts.set(spelled, (counts.get(spelled) ?? 0) + 1);
      seen.set(part, counts);
    });
  }
  return seen;
}

/** The spelling most employees on file use for a part; between equally used ones, the first in alphabetical order. */
function mostUsed(counts: Map<string, number> | undefined): string | undefined {
  if (!counts) return undefined;
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0];
}

/** A part spelled letter by letter: "الشربيني" → "El Shrbyny". */
function rough(part: string): string {
  return part
    .split(' ')
    .map((word) => {
      const article = word.startsWith('ال') && word.length > 3;
      const letters = (article ? word.slice(2) : word).split('').map((c) => LETTERS[c] ?? '').join(''); // Arabic letters are one UTF-16 unit each
      return letters && (article ? `El ${capital(letters)}` : capital(letters));
    })
    .filter(Boolean)
    .join(' ');
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The English name spelled from the Arabic one, part by part: as the employees on file spell that part most, else as
 * the list of common names does, else letter by letter (counted in `rough`). Nothing when the Arabic name has a part
 * that is not Arabic letters, or that cannot be spelled at all.
 */
export function spellName(fullNameAr: string, onFile: SpellingsOnFile): SpelledName | undefined {
  const parts = nameParts(fullNameAr, true);
  if (!parts.length || !parts.every((p) => p.split(' ').every((w) => ARABIC_PART.test(w)))) return undefined;
  let roughly = 0;
  const spelled: string[] = [];
  for (const part of parts) {
    const known = mostUsed(onFile.get(part)) ?? COMMON[part];
    if (known) {
      spelled.push(known);
      continue;
    }
    const guess = rough(part);
    if (!guess) return undefined;
    spelled.push(guess);
    roughly++;
  }
  return { name: spelled.join(' '), rough: roughly };
}

/** The note for HR when parts of the English name were spelled only letter by letter. */
export function roughNote(rough: number): string {
  const parts = rough === 1 ? 'one part of it' : `${rough} parts of it`;
  return `The English name is spelled from the Arabic name, ${parts} only roughly, letter by letter. Check its spelling before saving.`;
}
