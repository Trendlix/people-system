import { FACULTIES, UNIVERSITIES } from '@trendlix/shared';

// The qualification as contracts print it (in Arabic), proposed from the education fields: Bachelor's, Commerce,
// Accounting and Ain Shams University give "بكالوريوس التجارة - شعبة المحاسبة - جامعة عين شمس". HR checks it and may
// change it; what can't be put in Arabic (a major or a university typed in English) is left out and named.

export interface Education {
  degree: string;
  faculty: string;
  major: string;
  university: string;
}

export interface Proposal {
  /** The proposed text; empty until the degree is chosen. */
  text: string;
  /** What was left out because it is not in Arabic: 'major', 'faculty', 'university'. */
  left: ('major' | 'faculty' | 'university')[];
}

const ARABIC = /[؀-ۿ]/;

/** Faculties of the humanities, law and religion award a licence (ليسانس); the others a bachelor's (بكالوريوس). */
const LICENCE = new Set([
  'Al-Alsun',
  'Arabic Language',
  'Archaeology',
  'Arts',
  'Dar Al-Uloom',
  'Holy Quran for Quranic Readings and Its Sciences',
  'Human Studies',
  'Islamic and Arabic Studies',
  'Islamic Dawah',
  'Languages and Translation',
  'Law',
  'Sharia and Law',
  'Usul Al-Din (Fundamentals of Religion)',
]);

/** Where the degree is named otherwise than after its faculty, e.g. بكالوريوس العلوم الصيدلية, not بكالوريوس الصيدلة. */
const DEGREE_NAME: Record<string, string> = {
  Dentistry: 'طب وجراحة الفم والأسنان',
  Medicine: 'الطب والجراحة',
  Nursing: 'علوم التمريض',
  Pharmacy: 'العلوم الصيدلية',
  'Veterinary Medicine': 'العلوم الطبية البيطرية',
};

/** Common majors typed in English, in Arabic as they follow شعبة or قسم. */
const MAJORS: Record<string, string> = {
  accounting: 'المحاسبة',
  architecture: 'الهندسة المعمارية',
  arabic: 'اللغة العربية',
  'arabic language': 'اللغة العربية',
  'artificial intelligence': 'الذكاء الاصطناعي',
  'business administration': 'إدارة الأعمال',
  'business information systems': 'نظم معلومات الأعمال',
  'chemical engineering': 'الهندسة الكيميائية',
  chemistry: 'الكيمياء',
  civil: 'الهندسة المدنية',
  'civil engineering': 'الهندسة المدنية',
  communications: 'هندسة الإلكترونيات والاتصالات',
  'computer engineering': 'هندسة الحاسبات',
  'computer science': 'علوم الحاسب',
  'data science': 'علوم البيانات',
  economics: 'الاقتصاد',
  electrical: 'الهندسة الكهربائية',
  'electrical engineering': 'الهندسة الكهربائية',
  'electronics and communications': 'هندسة الإلكترونيات والاتصالات',
  english: 'اللغة الإنجليزية',
  'english language': 'اللغة الإنجليزية',
  finance: 'التمويل',
  french: 'اللغة الفرنسية',
  'french language': 'اللغة الفرنسية',
  geography: 'الجغرافيا',
  german: 'اللغة الألمانية',
  'german language': 'اللغة الألمانية',
  'graphic design': 'التصميم الجرافيكي',
  history: 'التاريخ',
  'information systems': 'نظم المعلومات',
  'information technology': 'تكنولوجيا المعلومات',
  insurance: 'التأمين',
  'interior design': 'التصميم الداخلي',
  journalism: 'الصحافة',
  management: 'الإدارة',
  'management information systems': 'نظم المعلومات الإدارية',
  marketing: 'التسويق',
  mathematics: 'الرياضيات',
  mechanical: 'الهندسة الميكانيكية',
  'mechanical engineering': 'الهندسة الميكانيكية',
  mechatronics: 'هندسة الميكاترونكس',
  philosophy: 'الفلسفة',
  physics: 'الفيزياء',
  'political science': 'العلوم السياسية',
  psychology: 'علم النفس',
  'public relations': 'العلاقات العامة والإعلان',
  'public relations and advertising': 'العلاقات العامة والإعلان',
  'radio and television': 'الإذاعة والتليفزيون',
  sociology: 'علم الاجتماع',
  'software engineering': 'هندسة البرمجيات',
  statistics: 'الإحصاء',
};

const facultyByEn = new Map(FACULTIES.map((f) => [f.en, f.ar]));
const facultyByAr = new Map(FACULTIES.map((f) => [f.ar, f.en]));
const universityByEn = new Map(UNIVERSITIES.map((u) => [u.en, u.ar]));

/** A name in Arabic: from the list, or as typed when typed in Arabic; null when it is only in English. */
function inArabic(value: string, list: ReadonlyMap<string, string>): string | null {
  const v = value.trim();
  return list.get(v) ?? (ARABIC.test(v) ? v : null);
}

export function proposeQualification(e: Education): Proposal {
  const left: Proposal['left'] = [];
  if (!e.degree) return { text: '', left };
  if (e.degree === 'high_school') return { text: 'شهادة الثانوية العامة', left };

  // a faculty typed in Arabic under Other, e.g. كلية الآداب, counts as the one on the list it names
  const typed = e.faculty.trim().replace(/^كلية\s+/, '');
  const facultyEn = facultyByAr.get(typed) ?? typed;
  const faculty = facultyEn ? inArabic(facultyEn, facultyByEn) : null;
  if (facultyEn && !faculty) left.push('faculty');
  const major = e.major.trim() ? (ARABIC.test(e.major) ? e.major.trim() : (MAJORS[e.major.trim().toLowerCase()] ?? null)) : null;
  if (e.major.trim() && !major) left.push('major');
  const university = e.university.trim() ? inArabic(e.university, universityByEn) : null;
  if (e.university.trim() && !university) left.push('university');

  const parts: string[] = [];
  if (e.degree === 'master' || e.degree === 'doctorate') {
    // ماجستير في المحاسبة - كلية التجارة - جامعة عين شمس
    parts.push(`${e.degree === 'master' ? 'ماجستير' : 'دكتوراه'}${major ? ` في ${major}` : ''}`);
    if (faculty) parts.push(`كلية ${faculty}`);
  } else {
    // بكالوريوس التجارة - شعبة المحاسبة, ليسانس الآداب - قسم اللغة الإنجليزية, دبلوم …
    const word = e.degree === 'diploma' ? 'دبلوم' : LICENCE.has(facultyEn) ? 'ليسانس' : 'بكالوريوس';
    const subject = faculty ? (DEGREE_NAME[facultyEn] ?? faculty) : null;
    parts.push(subject ? `${word} ${subject}` : word);
    if (major) parts.push(`${facultyEn === 'Commerce' ? 'شعبة' : 'قسم'} ${major}`);
  }
  if (university) parts.push(university);
  return { text: parts.join(' - '), left };
}
