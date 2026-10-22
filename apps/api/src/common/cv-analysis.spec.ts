import {
  cvFacts,
  cvFactsOf,
  cvMatchPercent,
  cvSkillsFound,
  educationLevel,
  experienceMonths,
  experienceText,
  keySkillsOf,
  keySkillsProblems,
  languagesOf,
  mostlyArabic,
  textAmount,
} from '@trendlix/shared';

// A CV read and analysed by simple rules (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it",
// "Built-in rules only"; packages/shared cv-analysis.ts). Every person and CV here is invented.

const NOW = new Date(Date.UTC(2026, 9, 22)); // October 2026

const ENGLISH = `Mona Adel Hassan
Video Editor · mona.adel@mail.test · +20 100 123 4567 · linkedin.com/in/mona-adel · behance.net/monaadel

Summary
Editor with a love for short-form content.

Experience
Senior Video Editor, Bright Studio — Jan 2022 – Present
Video Editor, Nile Media — March 2019 - Dec 2021
Freelance editor 2020 – 2021

Education
Bachelor of Fine Arts, Helwan University, 2014 – 2018

Skills
Adobe Premiere Pro, After-Effects, DaVinci Resolve, color grading

Languages
English (fluent), Arabic (native), French (basic)`;

const ARABIC = `منى عادل حسن
البريد: mona.ar@mail.test — الهاتف: ٠١٠٠١٢٣٤٥٦٧

الخبرات العملية
مونتير أول، استوديو برايت — يناير ٢٠٢٢ - الآن
مونتير، نايل ميديا — مارس ٢٠١٩ - ديسمبر ٢٠٢١

التعليم
بكالوريوس الفنون الجميلة، جامعة حلوان ٢٠١٤ - ٢٠١٨

المهارات
بريمير برو، أفتر إفكتس

اللغات
العربية، الإنجليزية`;

describe('the years of experience, from the dates', () => {
  it('adds up the work ranges, overlaps merged, the education left out, "present" as this month', () => {
    // Mar 2019 – Oct 2026 (merged: Mar 2019–Dec 2021 and Jan 2022–Oct 2026 touch; 2020–2021 inside)
    expect(experienceMonths(ENGLISH, NOW)).toBe(2026 * 12 + 9 - (2019 * 12 + 2) - 1);
    expect(experienceText(experienceMonths(ENGLISH, NOW))).toBe('About 8 years (from the dates in the CV)');
  });

  it('reads Arabic months, Arabic-Indic digits and الآن', () => {
    expect(experienceMonths(ARABIC, NOW)).toBe(2026 * 12 + 9 - (2019 * 12 + 2) - 1);
  });

  it('a year alone counts from its start; months as numbers; nothing without ranges', () => {
    expect(experienceMonths('Experience\nDesigner 2018 - 2020', NOW)).toBe(24);
    expect(experienceMonths('Experience\nDesigner 01/2020 – 07/2020', NOW)).toBe(6);
    expect(experienceMonths('Experience\nDesigner 2020/01 to 2020/04', NOW)).toBe(3);
    expect(experienceMonths('No dates here at all', NOW)).toBeNull();
    expect(experienceText(null)).toBeNull();
    expect(experienceText(5)).toBe('Less than a year (from the dates in the CV)');
    expect(experienceText(13)).toBe('About 1 year (from the dates in the CV)');
  });

  it('ignores impossible ranges: backwards, in the future, before 1960', () => {
    expect(experienceMonths('Experience\nJob 2021 - 2019', NOW)).toBeNull();
    expect(experienceMonths('Experience\nJob 2030 - 2032', NOW)).toBeNull();
    expect(experienceMonths('Experience\nJob 1950 - 1955', NOW)).toBeNull();
  });
});

describe('education and languages', () => {
  it('names the highest education level, in English or Arabic', () => {
    expect(educationLevel(ENGLISH)).toBe('bachelor');
    expect(educationLevel(ARABIC)).toBe('bachelor');
    expect(educationLevel('MBA, AUC 2023\nBachelor of Commerce')).toBe('master');
    expect(educationLevel('PhD in Media Studies')).toBe('doctorate');
    expect(educationLevel('دكتوراه في الإعلام')).toBe('doctorate');
    expect(educationLevel('دبلوم فني تجاري')).toBe('diploma');
    expect(educationLevel('High school certificate')).toBe('high_school');
    expect(educationLevel('Nothing about schooling')).toBeNull();
  });

  it('names the languages of the Languages section, else anywhere', () => {
    expect(languagesOf(ENGLISH)).toEqual(['English', 'Arabic', 'French']);
    expect(languagesOf(ARABIC)).toEqual(['English', 'Arabic']);
    // no section: anywhere
    expect(languagesOf('Fluent in German and Spanish')).toEqual(['German', 'Spanish']);
    // the heading's own line
    expect(languagesOf('Languages: English, Italian')).toEqual(['English', 'Italian']);
  });
});

describe('the contacts', () => {
  it('finds emails, phones as +20…, the LinkedIn profile and the portfolio links', () => {
    const facts = cvFacts(ENGLISH, NOW);
    expect(facts.emails).toEqual(['mona.adel@mail.test']);
    expect(facts.phones).toEqual(['+201001234567']);
    expect(facts.linkedin).toBe('https://linkedin.com/in/mona-adel');
    expect(facts.links).toEqual(['https://behance.net/monaadel']);
    expect(cvFacts(ARABIC, NOW).phones).toEqual(['+201001234567']);
  });

  it('takes international numbers with a +, never a date range or an ID as a phone', () => {
    expect(cvFacts('Call +44 7700 900123 or 0020 122 333 4444', NOW).phones).toEqual(['+447700900123', '+201223334444']);
    expect(cvFacts('2019 - 2021, ID 29503121234567', NOW).phones).toEqual([]);
  });

  it('reads kept facts back safely', () => {
    expect(cvFactsOf(cvFacts(ENGLISH, NOW))).toEqual(cvFacts(ENGLISH, NOW));
    expect(cvFactsOf({ education: 'wizard', languages: [1, 'English'] })).toMatchObject({ education: null, languages: ['English'], emails: [] });
    expect(cvFactsOf(null)).toBeNull();
    expect(cvFactsOf([1])).toBeNull();
  });
});

describe('a vacancy’s key skills', () => {
  it('are found as whole words, any case and punctuation, in English and Arabic', () => {
    const { found, missing } = cvSkillsFound(ENGLISH, ['Premiere Pro', 'after effects', 'Final Cut Pro', 'Color Grading', 'Edit']);
    expect(found).toEqual(['Premiere Pro', 'after effects', 'Color Grading']);
    // "Edit" is no whole word in "Editor"
    expect(missing).toEqual(['Final Cut Pro', 'Edit']);
    expect(cvSkillsFound(ARABIC, ['بريمير برو', 'أفتر إفكتس', 'فوتوشوب'])).toEqual({ found: ['بريمير برو', 'أفتر إفكتس'], missing: ['فوتوشوب'] });
  });

  it('tells C++, C# and .NET from a lone letter', () => {
    expect(cvSkillsFound('Skills: C++, .NET Core', ['C++', 'C#', '.NET', 'C'])).toEqual({ found: ['C++', '.NET'], missing: ['C#', 'C'] });
  });

  it('the match %: those found ÷ those listed; none listed: none', () => {
    expect(cvMatchPercent(3, 5)).toBe(60);
    expect(cvMatchPercent(2, 3)).toBe(67);
    expect(cvMatchPercent(0, 0)).toBeNull();
  });

  it('are typed as a list or with commas, each once, at most 20 of at most 60 characters', () => {
    expect(keySkillsOf(' Premiere Pro, after  effects,premiere pro ,, ')).toEqual(['Premiere Pro', 'after effects']);
    expect(keySkillsOf(['Excel', 'excel', ' SQL '])).toEqual(['Excel', 'SQL']);
    expect(keySkillsOf('بريمير، فوتوشوب')).toEqual(['بريمير', 'فوتوشوب']);
    expect(keySkillsOf(null)).toEqual([]);
    expect(keySkillsProblems(keySkillsOf(Array.from({ length: 21 }, (_, i) => `Skill ${i}`)))).toEqual(['List at most 20 key skills.']);
    expect(keySkillsProblems(['x'.repeat(61)])[0]).toMatch(/^Keep each key skill to 60 characters or fewer/);
    expect(keySkillsProblems(['---'])).toEqual(['Each key skill needs letters or digits.']);
    expect(keySkillsProblems(['Excel', 'SQL'])).toEqual([]);
  });
});

describe('the text', () => {
  it('tells a mostly Arabic text, and how much text a PDF holds', () => {
    expect(mostlyArabic(ARABIC)).toBe(true);
    expect(mostlyArabic(ENGLISH)).toBe(false);
    expect(mostlyArabic('')).toBe(false);
    expect(textAmount('  \n ... ')).toBe(0);
    expect(textAmount('ab ١٢')).toBe(4);
  });
});
