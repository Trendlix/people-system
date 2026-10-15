// Nationalities in Arabic, for the Arabic documents (owner, 16 October 2026: Form 1 printed "Egyptian" on an Arabic
// form). The profile keeps the nationality as typed, usually in English ("Egyptian", as the ID card scan sets it); an
// Arabic document prints it in Arabic, in the person's gender. The common ones only: anything else prints as typed.

/** [masculine, feminine], by the English name in lower case without spaces. */
const NATIONALITIES_AR: Readonly<Record<string, readonly [string, string]>> = {
  egyptian: ['مصري', 'مصرية'],
  saudi: ['سعودي', 'سعودية'],
  emirati: ['إماراتي', 'إماراتية'],
  kuwaiti: ['كويتي', 'كويتية'],
  qatari: ['قطري', 'قطرية'],
  bahraini: ['بحريني', 'بحرينية'],
  omani: ['عماني', 'عمانية'],
  yemeni: ['يمني', 'يمنية'],
  jordanian: ['أردني', 'أردنية'],
  lebanese: ['لبناني', 'لبنانية'],
  syrian: ['سوري', 'سورية'],
  palestinian: ['فلسطيني', 'فلسطينية'],
  iraqi: ['عراقي', 'عراقية'],
  sudanese: ['سوداني', 'سودانية'],
  libyan: ['ليبي', 'ليبية'],
  tunisian: ['تونسي', 'تونسية'],
  algerian: ['جزائري', 'جزائرية'],
  moroccan: ['مغربي', 'مغربية'],
  turkish: ['تركي', 'تركية'],
  american: ['أمريكي', 'أمريكية'],
  british: ['بريطاني', 'بريطانية'],
  canadian: ['كندي', 'كندية'],
  french: ['فرنسي', 'فرنسية'],
  german: ['ألماني', 'ألمانية'],
  italian: ['إيطالي', 'إيطالية'],
  spanish: ['إسباني', 'إسبانية'],
  russian: ['روسي', 'روسية'],
  chinese: ['صيني', 'صينية'],
  indian: ['هندي', 'هندية'],
  pakistani: ['باكستاني', 'باكستانية'],
  filipino: ['فلبيني', 'فلبينية'],
  nigerian: ['نيجيري', 'نيجيرية'],
  ethiopian: ['إثيوبي', 'إثيوبية'],
};

/**
 * A nationality in Arabic, in the person's gender (masculine when it isn't known): "Egyptian" → مصري, or مصرية for a
 * woman; matched in any capitals and ignoring spaces ("  EGYPTIAN "). One already in Arabic, or not in the table, is
 * given back as it is (trimmed); none gives ''.
 */
export function nationalityAr(value: string | null | undefined, gender: string | null | undefined): string {
  const typed = (value ?? '').trim();
  const forms = NATIONALITIES_AR[typed.toLowerCase().replace(/\s+/g, '')];
  if (!forms) return typed;
  return gender === 'female' ? forms[1] : forms[0];
}
