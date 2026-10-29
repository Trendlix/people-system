import {
  CV_FACTS_VERSION,
  cvFacts,
  cvFactsOf,
  cvMonthsAtLeast,
  cvSkillsIn,
  cvYears,
  DICTIONARY_SKILL_NAMES,
  experienceOf,
  experienceSortMonths,
  isDictionarySkill,
  meetsMinYears,
  MIN_YEARS_CHOICES,
  SKILLS_DICTIONARY,
} from '@trendlix/shared';

// More from each CV by the same simple rules (owner, 24 October 2026: "why isn't the experience pulled off the CV? is
// the pulled data all what can be pulled from the uploaded cv?"; chose "CV years in list + more rules", still no AI;
// packages/shared cv-analysis.ts): the work history with the latest title and company, the education details, the
// dictionary's skills, the certifications and the city; and the years as the lists show and filter them. On English,
// Arabic and mixed CVs, a two-column one as pdf.js gives it, a LinkedIn export and a scan's messy OCR text; a fact the
// rules aren't sure of stays empty. Every person, company and CV here is invented.

const NOW = new Date(Date.UTC(2026, 9, 22)); // October 2026

const ENGLISH = `Mona Adel Hassan
Video Editor · mona.adel@mail.test · +20 100 123 4567 · linkedin.com/in/mona-adel
Nasr City, Cairo

Summary
Editor with a love for short-form content.

Experience
Senior Video Editor, Bright Studio — Jan 2022 – Present
Video Editor, Nile Media — March 2019 - Dec 2021
Freelance editor 2020 – 2021

Education
Bachelor of Fine Arts, Helwan University, 2014 – 2018

Certifications
Color Grading Masterclass – Online, 2021
Google Ads Search Certification

Skills
Adobe Premiere Pro, After-Effects, DaVinci Resolve, color grading, MS Office (Word, Excel, PowerPoint)

Languages
English (fluent), Arabic (native)`;

const ARABIC = `منى عادل حسن
البريد: mona.ar@mail.test — الهاتف: ٠١٠٠١٢٣٤٥٦٧
المعادي، القاهرة

الخبرات العملية
مونتير أول، استوديو برايت — يناير ٢٠٢٢ - الآن
مصمم جرافيك في شركة النيل للإعلان ٢٠١٨ - ٢٠٢١

التعليم
بكالوريوس الفنون الجميلة، جامعة حلوان ٢٠١٤ - ٢٠١٨

الدورات
دورة التلوين الاحترافي
دورة الموشن جرافيك

المهارات
بريمير برو، أفتر إفكتس، فوتوشوب

اللغات
العربية، الإنجليزية`;

/** Two columns as pdf.js reads them: the sidebar (contact, skills, languages) first, then the main column. */
const TWO_COLUMNS = `KARIM NABIL
Motion Designer
CONTACT
+20 111 222 3344
karim.nabil@mail.test
Sheikh Zayed, Giza
SKILLS
After Effects
Cinema 4D
Blender
LANGUAGES
Arabic
English
PROFILE
Motion designer making brand films for agencies.
WORK EXPERIENCE
Orbit Creative Agency
Senior Motion Designer
Feb 2023 – Present
• Led the motion team on brand campaigns
Pixel Box
Motion Graphics Designer
Jul 2020 – Jan 2023
• Built templates
EDUCATION
Faculty of Applied Arts
Helwan University
Bachelor of Applied Arts
2016 – 2020
COURSES
School of Motion: Animation Bootcamp
Cinema 4D Basecamp (2021)`;

/** Mixed: English headings, Arabic and English entries, a city with its country. */
const MIXED = `Sara Fathy
Dubai, UAE · sara.f@mail.test
Work Experience
Social Media Specialist – Bright Studio (Remote) Jan 2023 – Present
Account Manager, Orbit Agency, Dubai, UAE, 2021 – 2022
Bright Studio | Content Writer | 2019 – 2020
Education
كلية الإعلام - جامعة القاهرة (2015 - 2019)
Licenses & Certifications
Meta Blueprint certification in social media
advertising, 2022`;

/** A LinkedIn profile saved as a PDF: the company, the title, the dates and the place, each on its own line. */
const LINKEDIN = `Contact
www.linkedin.com/in/sara-test
Laila Test
Content Creator at Bright Studio
Experience
Bright Studio
Content Creator
January 2024 - Present (2 years 10 months)
Giza, Egypt
Nile Media
Copywriter
March 2021 - December 2023 (2 years 10 months)
Education
Cairo University
Bachelor's degree, Mass Communication · (2016 - 2020)`;

/** A scan's OCR text: odd spacing, a pipe read as "l", a misspelled heading. */
const OCR = `KARlM  NABlL   |  Motion Desiqner
Cairo ,  Egypt     karim.ocr@mail.test
EXPERIENCE
Senior  Motion Designer  -  Orbit Creative Agency   Feb 2023 -Present
Motion Designer l Pixel Box   Jul2020 - Jan 2023
* animated  stuff for clients , 120+ videos
EDUCAT10N
Helwan Univers1ty 2016-2020`;

/** Two columns pdf.js read line by line, the columns' lines mixed: little is found, nothing wrong. */
const MIXED_COLUMNS = `RANA FAWZY Graphic Designer
WORK EXPERIENCE SKILLS
Senior Designer – Bright Studio Photoshop
Jan 2022 – Present Illustrator
EDUCATION LANGUAGES
Cairo University Arabic`;

describe('the work history and the latest role', () => {
  it('reads "Title, Company", "Title at Company" and the Arabic patterns, latest first', () => {
    const f = cvFacts(ENGLISH, NOW);
    expect(f.workHistory).toEqual([
      { pastTitle: 'Senior Video Editor', pastCompany: 'Bright Studio', from: '2022-01', to: null, current: true },
      // a year alone, its December to sort by (Dec 2021 too: the later start first)
      { pastTitle: 'Freelance editor', pastCompany: null, from: '2020', to: '2021', current: false },
      { pastTitle: 'Video Editor', pastCompany: 'Nile Media', from: '2019-03', to: '2021-12', current: false },
    ]);
    expect([f.latestTitle, f.latestCompany]).toEqual(['Senior Video Editor', 'Bright Studio']);
    const ar = cvFacts(ARABIC, NOW);
    expect(ar.workHistory.map((w) => [w.pastTitle, w.pastCompany, w.from, w.to, w.current])).toEqual([
      ['مونتير أول', 'استوديو برايت', '2022-01', null, true],
      ['مصمم جرافيك', 'شركة النيل للإعلان', '2018', '2021', false],
    ]);
  });

  // owner, 29 October 2026, on a CV whose first job lost its company: "there is missing data for example in the work history"
  it('reads two roles before the company, "Role | Role — Company (dates)", and two roles with the company on the next line', () => {
    const f = cvFacts(
      [
        'Experience',
        'Media Buyer | Content Creator — Orbit Agency (Mar 2026 – Present)',
        '• Ran paid campaigns on Meta Ads and TikTok Ads.',
        'Media Buyer — Nile Holdings (Aug 2025 – Jan 2026)',
        'Senior Designer | Art Director',
        'Bright Studio',
        'Jan 2020 – Dec 2022',
      ].join('\n'),
      NOW,
    );
    expect(f.workHistory.map((w) => [w.pastTitle, w.pastCompany, w.from, w.to, w.current])).toEqual([
      ['Media Buyer | Content Creator', 'Orbit Agency', '2026-03', null, true],
      ['Media Buyer', 'Nile Holdings', '2025-08', '2026-01', false],
      ['Senior Designer | Art Director', 'Bright Studio', '2020-01', '2022-12', false],
    ]);
  });

  it('reads "Company | Title", a place or "(Remote)" left out', () => {
    const f = cvFacts(MIXED, NOW);
    expect(f.workHistory.map((w) => [w.pastTitle, w.pastCompany])).toEqual([
      ['Social Media Specialist', 'Bright Studio'],
      ['Account Manager', 'Orbit Agency'],
      ['Content Writer', 'Bright Studio'],
    ]);
    expect(f.latestTitle).toBe('Social Media Specialist');
  });

  it('reads the title and company on the lines before the dates: two columns, a LinkedIn export', () => {
    expect(cvFacts(TWO_COLUMNS, NOW).workHistory).toEqual([
      { pastTitle: 'Senior Motion Designer', pastCompany: 'Orbit Creative Agency', from: '2023-02', to: null, current: true },
      { pastTitle: 'Motion Graphics Designer', pastCompany: 'Pixel Box', from: '2020-07', to: '2023-01', current: false },
    ]);
    const li = cvFacts(LINKEDIN, NOW);
    expect(li.workHistory.map((w) => [w.pastTitle, w.pastCompany, w.from, w.to])).toEqual([
      ['Content Creator', 'Bright Studio', '2024-01', null],
      ['Copywriter', 'Nile Media', '2021-03', '2023-12'],
    ]);
  });

  it('reads a line after the dates, and the dates before the job', () => {
    const after = cvFacts('Experience\nSenior Video Editor        Jan 2022 – Present\nBright Studio, Cairo\n• Edited 300 videos', NOW);
    expect(after.workHistory.map((w) => [w.pastTitle, w.pastCompany])).toEqual([['Senior Video Editor', 'Bright Studio']]);
    const before = cvFacts('Experience\n2019 – 2021  Video Editor, Nile Media\n2021 – Present  Senior Video Editor @ Bright Studio, Giza', NOW);
    expect(before.workHistory.map((w) => [w.pastTitle, w.pastCompany])).toEqual([
      ['Senior Video Editor', 'Bright Studio'],
      ['Video Editor', 'Nile Media'],
    ]);
  });

  it('reads a scan’s messy text: spacing, a pipe read as "l"', () => {
    const f = cvFacts(OCR, NOW);
    expect(f.workHistory.map((w) => [w.pastTitle, w.pastCompany, w.from])).toEqual([
      ['Senior Motion Designer', 'Orbit Creative Agency', '2023-02'],
      ['Motion Designer', 'Pixel Box', '2020-07'],
    ]);
    // the misspelled heading hides its section: nothing rather than a guess
    expect(f.educationDetails).toEqual([]);
  });

  it('leaves out what it isn’t sure of: description bullets, columns mixed, no heading, two lines neither naming', () => {
    const bullets = cvFacts('Experience\nGraphic Designer | Bright Studio | 2021 – Present\n• Ran a campaign from Jan 2023 – Mar 2023 for a big client', NOW);
    expect(bullets.workHistory.map((w) => w.pastTitle)).toEqual(['Graphic Designer']);
    expect(cvFacts(MIXED_COLUMNS, NOW)).toMatchObject({ workHistory: [], latestTitle: null, latestCompany: null, educationDetails: [] });
    // no experience heading: no history (the years still count, as before)
    const bare = cvFacts('Video Editor at Bright Studio 2020 - 2023', NOW);
    expect(bare.workHistory).toEqual([]);
    expect(bare.experienceMonths).toBe(36);
    // neither line has a title's or a company's word: which is which is unknown
    expect(cvFacts('Experience\nOrbit\nNile\n2019 - 2021', NOW).workHistory).toEqual([]);
    // one says it ("Colorist" is a title's word): the other line is the company
    expect(cvFacts('Experience\nBright Studio\nColorist\n2019 - 2021', NOW).workHistory.map((w) => [w.pastTitle, w.pastCompany])).toEqual([['Colorist', 'Bright Studio']]);
    // the line after a job is a description or a skill, not its company; one written as a name is
    const after = (line: string) => cvFacts(`Experience\nDesigner 2018 - 2020\n${line}`, NOW).workHistory.map((w) => [w.pastTitle, w.pastCompany]);
    expect(after('Worked on social media posts')).toEqual([['Designer', null]]);
    expect(after('Photoshop')).toEqual([['Designer', null]]);
    expect(after('عملت على تصميم المنشورات')).toEqual([['Designer', null]]);
    expect(after('Nile Media')).toEqual([['Designer', 'Nile Media']]);
    expect(after('Pixel Box')).toEqual([['Designer', 'Pixel Box']]);
  });

  it('keeps at most 10 jobs, the latest', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Designer, Studio ${String.fromCharCode(65 + i)}, ${2000 + i} - ${2001 + i}`);
    const f = cvFacts(`Experience\n${lines.join('\n')}`, NOW);
    expect(f.workHistory).toHaveLength(10);
    expect(f.workHistory[0]).toMatchObject({ pastCompany: 'Studio L', from: '2011', to: '2012' });
    expect(f.latestCompany).toBe('Studio L');
  });
});

describe('the education details', () => {
  it('reads the institution, the degree as written and the graduation year, in English and Arabic', () => {
    expect(cvFacts(ENGLISH, NOW).educationDetails).toEqual([{ institution: 'Helwan University', degree: 'Bachelor of Fine Arts', graduationYear: 2018 }]);
    expect(cvFacts(ARABIC, NOW).educationDetails).toEqual([{ institution: 'جامعة حلوان', degree: 'بكالوريوس الفنون الجميلة', graduationYear: 2018 }]);
    // a faculty and its university on two lines: one; the degree and the years on the next lines
    expect(cvFacts(TWO_COLUMNS, NOW).educationDetails).toEqual([{ institution: 'Faculty of Applied Arts, Helwan University', degree: 'Bachelor of Applied Arts', graduationYear: 2020 }]);
    expect(cvFacts(MIXED, NOW).educationDetails).toEqual([{ institution: 'كلية الإعلام، جامعة القاهرة', degree: null, graduationYear: 2019 }]);
    // the degree's subject after it
    expect(cvFacts(LINKEDIN, NOW).educationDetails).toEqual([{ institution: 'Cairo University', degree: "Bachelor's degree, Mass Communication", graduationYear: 2020 }]);
  });

  it('tells the schools apart, drops labels and grades, and has no year while studying', () => {
    const text = `Education
High School: El Orman Language School, 2012
University: Cairo University
Degree: Bachelor of Commerce (GPA: 3.4)
Graduation year: 2016
Master of Business Administration (MBA) from The American University in Cairo, 2024 - Present
بكالوريوس تجارة من جامعة عين شمس ٢٠١٧`;
    expect(cvFacts(text, NOW).educationDetails).toEqual([
      { institution: 'El Orman Language School', degree: 'High School', graduationYear: 2012 },
      { institution: 'Cairo University', degree: 'Bachelor of Commerce', graduationYear: 2016 },
      { institution: 'The American University in Cairo', degree: 'Master of Business Administration (MBA)', graduationYear: null },
      { institution: 'جامعة عين شمس', degree: 'بكالوريوس تجارة', graduationYear: 2017 },
    ]);
  });
});

describe('the skills from the dictionary', () => {
  it('finds them as whole words, any case, under their other names too, in the order found', () => {
    expect(cvSkillsIn(ENGLISH)).toEqual(['Google Ads', 'Premiere Pro', 'After Effects', 'DaVinci Resolve', 'Word', 'Excel', 'PowerPoint']);
    expect(cvSkillsIn(ARABIC)).toEqual(['Premiere Pro', 'After Effects', 'Photoshop']);
    expect(cvFacts(TWO_COLUMNS, NOW).cvSkills).toEqual(['After Effects', 'Cinema 4D', 'Blender', 'Motion graphics']);
    expect(cvSkillsIn('figma, CANVA and wordpress; Facebook Ads Manager')).toEqual(['Figma', 'Canva', 'WordPress', 'Meta Ads']);
  });

  it('counts "Word" only beside the office’s other programs, and no word inside another', () => {
    expect(cvSkillsIn('A way with words, word of mouth')).toEqual([]);
    expect(cvSkillsIn('Microsoft Office: Word, Excel')).toEqual(['Word', 'Excel']);
    expect(cvSkillsIn('Wordsmith, Photoshopped, Reactive')).toEqual([]);
    expect(cvSkillsIn('UI/UX, 3D, SEO and SEM')).toEqual(['UI/UX', '3D', 'SEO', 'SEM']);
  });

  it('lists at most 30; the dictionary names each once, the lists filter by those names', () => {
    expect(cvSkillsIn(DICTIONARY_SKILL_NAMES.join(', '))).toHaveLength(30);
    expect(new Set(DICTIONARY_SKILL_NAMES).size).toBe(SKILLS_DICTIONARY.length);
    expect(isDictionarySkill('Figma')).toBe(true);
    expect(isDictionarySkill('figma')).toBe(false);
    expect(isDictionarySkill(3)).toBe(false);
  });
});

describe('the certifications and the city', () => {
  it('lists the lines under a certifications or courses heading, a wrapped line joined', () => {
    expect(cvFacts(ENGLISH, NOW).certifications).toEqual(['Color Grading Masterclass – Online, 2021', 'Google Ads Search Certification']);
    expect(cvFacts(ARABIC, NOW).certifications).toEqual(['دورة التلوين الاحترافي', 'دورة الموشن جرافيك']);
    expect(cvFacts(MIXED, NOW).certifications).toEqual(['Meta Blueprint certification in social media advertising, 2022']);
    expect(cvFacts(`Courses\n${Array.from({ length: 12 }, (_, i) => `• Course number ${i + 1}`).join('\n')}`, NOW).certifications).toHaveLength(10);
  });

  it('finds the first Egyptian city or governorate near the top, or a city with its country', () => {
    expect(cvFacts(ENGLISH, NOW).city).toBe('Nasr City');
    expect(cvFacts(ARABIC, NOW).city).toBe('Maadi');
    // in the contact section, read before the main column
    expect(cvFacts(TWO_COLUMNS, NOW).city).toBe('Sheikh Zayed');
    expect(cvFacts(MIXED, NOW).city).toBe('Dubai, UAE');
    expect(cvFacts(OCR, NOW).city).toBe('Cairo');
    expect(cvFacts('سارة\nمقيمة بالقاهرة الجديدة', NOW).city).toBe('New Cairo');
    expect(cvFacts('Omar\n6th of October City, Giza', NOW).city).toBe('6th of October');
  });

  it('never takes a university’s name, a first name, an email or the work history’s places', () => {
    expect(cvFacts('Mohamed Test\nGraduate of Cairo University\nalex.cairo@mail.test', NOW).city).toBeNull();
    expect(cvFacts('Alex Morgan\nFaisal Kamal\nRehab Street 5', NOW).city).toBeNull();
    expect(cvFacts('Omar Test\nExperience\nVideo Editor, Nile Media, Cairo, 2019 - 2021', NOW).city).toBeNull();
  });
});

describe('the facts as kept', () => {
  it('carry their version, and read back as they were', () => {
    const f = cvFacts(TWO_COLUMNS, NOW);
    expect(f.version).toBe(CV_FACTS_VERSION);
    expect(cvFactsOf(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });

  it('kept before the new rules (version 1): read with the new facts empty', () => {
    const old = { emails: ['mona@mail.test'], phones: [], linkedin: null, links: [], experienceMonths: 50, education: 'bachelor', languages: ['English'] };
    expect(cvFactsOf(old)).toEqual({
      ...old,
      version: 1,
      latestTitle: null,
      latestCompany: null,
      workHistory: [],
      educationDetails: [],
      cvSkills: [],
      certifications: [],
      city: null,
    });
  });

  it('drop what is broken: a job without a title or company, a bad date, a year that isn’t one', () => {
    const f = cvFactsOf({
      version: 2,
      workHistory: [{ pastTitle: 'Editor', pastCompany: 7, from: 'Jan 2020', to: '2021-13', current: false }, { pastTitle: '', pastCompany: null }, 'x'],
      educationDetails: [{ institution: 'Helwan University', degree: null, graduationYear: '2018' }, {}],
      cvSkills: ['Figma', 3],
      city: '',
    });
    expect(f).toMatchObject({
      workHistory: [{ pastTitle: 'Editor', pastCompany: null, from: null, to: null, current: false }],
      educationDetails: [{ institution: 'Helwan University', degree: null, graduationYear: null }],
      cvSkills: ['Figma'],
      city: null,
    });
  });
});

describe('the years in the lists', () => {
  it('rounds the CV’s months to whole years, under a year 0', () => {
    expect([0, 5, 11, 12, 17, 18, 29, 30, 47, 48].map(cvYears)).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 4, 4]);
  });

  it('shows the years typed when given, else the CV’s, else none', () => {
    expect(experienceOf(3, 70)).toEqual({ years: 3, fromCv: false });
    expect(experienceOf(0, 70)).toEqual({ years: 0, fromCv: false });
    expect(experienceOf(null, 47)).toEqual({ years: 4, fromCv: true });
    expect(experienceOf(null, 8)).toEqual({ years: 0, fromCv: true });
    expect(experienceOf(null, null)).toBeNull();
    expect(experienceSortMonths(2.5, 99)).toBe(30);
    expect(experienceSortMonths(null, 99)).toBe(99);
    expect(experienceSortMonths(null, null)).toBeNull();
  });

  it('filters by the same rule: the typed years, else the CV’s as rounded', () => {
    expect(MIN_YEARS_CHOICES).toEqual([1, 2, 3, 5, 8, 10]);
    expect([1, 2, 3, 5, 8, 10].map(cvMonthsAtLeast)).toEqual([12, 18, 30, 54, 90, 114]);
    expect(cvMonthsAtLeast(0)).toBe(0);
    expect(cvMonthsAtLeast(2.5)).toBe(30);
    // typed wins, even when the CV says more
    expect(meetsMinYears(2, 120, 3)).toBe(false);
    expect(meetsMinYears(3, null, 3)).toBe(true);
    // "≈ 3 y" (30 months) is 3+; 29 months ("≈ 2 y") isn't; under a year isn't 1+
    expect(meetsMinYears(null, 30, 3)).toBe(true);
    expect(meetsMinYears(null, 29, 3)).toBe(false);
    expect(meetsMinYears(null, 11, 1)).toBe(false);
    expect(meetsMinYears(null, null, 1)).toBe(false);
    // the column and the filter agree, month by month
    for (let m = 0; m <= 200; m++) for (const min of MIN_YEARS_CHOICES) expect(meetsMinYears(null, m, min)).toBe(cvYears(m) >= min);
  });
});
