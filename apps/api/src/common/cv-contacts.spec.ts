import { cvEmails, cvLinkedIn, cvName, cvPhoneOf, cvPhones, cvPortfolioLinks, cvPrefillOf, cvYearsOf, nameLike } from '@trendlix/shared';

// The careers forms filled in from the CV (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to
// complete the data?"; asked, "Fill the form from the CV"; packages/shared cv-contacts.ts): the name only when
// confident, the email, the mobile as the system keeps phones (Egypt's +20 by default, no extra zero, Arabic digits),
// the LinkedIn link, the portfolio links with their platform, and the years as the reading works them out, rounded
// down. Every person, address and CV here is made up.

const NOW = new Date('2026-10-25T10:00:00Z');

describe('emails', () => {
  it('finds each email once, in lower case, without a full stop after it', () => {
    expect(cvEmails('Email: Mona.Adel@Example.com. Or mona.adel@example.com')).toEqual(['mona.adel@example.com']);
    expect(cvEmails('first: a.b@mail.test, then c@site.org')).toEqual(['a.b@mail.test', 'c@site.org']);
  });

  it('finds none in a text without one', () => {
    expect(cvEmails('Video editor at a studio @ Cairo')).toEqual([]);
  });
});

describe('phones, as the system keeps them', () => {
  it('reads an Egyptian mobile as dialled, with its +20 put in front and the 0 dropped', () => {
    expect(cvPhoneOf('01012345678')).toEqual({ phone: '+201012345678', egyptMobile: true });
    expect(cvPhoneOf('010 1234 5678')).toEqual({ phone: '+201012345678', egyptMobile: true });
    expect(cvPhoneOf('0122-345-6789')).toEqual({ phone: '+201223456789', egyptMobile: true });
  });

  it('reads one written with +20 or 0020, an extra 0 after the code dropped', () => {
    expect(cvPhoneOf('+20 10 1234 5678')).toEqual({ phone: '+201012345678', egyptMobile: true });
    expect(cvPhoneOf('0020 101 234 5678')).toEqual({ phone: '+201012345678', egyptMobile: true });
    expect(cvPhoneOf('+20 0115 123 4567')).toEqual({ phone: '+201151234567', egyptMobile: true });
    expect(cvPhoneOf('(+20) 155-123-4567')).toEqual({ phone: '+201551234567', egyptMobile: true });
  });

  it('reads Arabic digits', () => {
    expect(cvPhones('موبايل: ٠١٠١٢٣٤٥٦٧٨')).toEqual(['+201012345678']);
    expect(cvPhones('+٢٠ ١٠٠ ٩٨٧ ٦٥٤٣')).toEqual(['+201009876543']);
  });

  it('reads an international one only with its code, never a year range or a link’s digits', () => {
    expect(cvPhoneOf('+971 50 123 4567')).toEqual({ phone: '+971501234567', egyptMobile: false });
    expect(cvPhones('Studio A 2019 - 2022, Studio B 2022 – 2024')).toEqual([]);
    expect(cvPhones('vimeo.com/123456789 and 0501234567')).toEqual([]);
  });

  it('puts an Egyptian mobile first', () => {
    expect(cvPhones('Phone: +971 50 123 4567 · Mobile: 0100 765 4321')).toEqual(['+201007654321', '+971501234567']);
  });
});

describe('LinkedIn links', () => {
  it('finds the profile’s link as https://www.linkedin.com/in/<name>', () => {
    expect(cvLinkedIn('linkedin.com/in/mona-adel-test')).toBe('https://www.linkedin.com/in/mona-adel-test');
    expect(cvLinkedIn('https://eg.linkedin.com/in/omar-k/')).toBe('https://www.linkedin.com/in/omar-k');
    expect(cvLinkedIn('www.linkedin.com/company/a-studio')).toBeNull();
  });

  it('joins a link LinkedIn’s own PDF wrapped over two lines', () => {
    expect(cvLinkedIn('www.linkedin.com/in/mona-adel-\n0a1b2c3 (LinkedIn)')).toBe('https://www.linkedin.com/in/mona-adel-0a1b2c3');
  });
});

describe('portfolio links, with their platform', () => {
  it('finds the platforms’ links, each once, never LinkedIn or an email’s site', () => {
    const text = ['Mona Adel', 'mona@mona-studio.test · linkedin.com/in/mona-adel', 'Showreel: vimeo.com/123456789', 'behance.net/mona-adel', 'https://vimeo.com/123456789'].join('\n');
    expect(cvPortfolioLinks(text)).toEqual([
      { url: 'https://vimeo.com/123456789', kind: 'vimeo' },
      { url: 'https://behance.net/mona-adel', kind: 'behance' },
    ]);
  });

  it('tells the platforms apart: GitHub, YouTube, TikTok, Dribbble, Instagram, Google Drive', () => {
    const text = 'github.com/omar-dev\nyoutu.be/dQw4w9WgXcQ\ntiktok.com/@omar.reels\ndribbble.com/omar\ninstagram.com/omar.pages\ndrive.google.com/drive/folders/abc';
    expect(cvPortfolioLinks(text).map((l) => l.kind)).toEqual(['github', 'youtube', 'tiktok']);
  });

  it('takes a website only when its line says so or it is in the header, never a past employer’s', () => {
    const lines = ['Omar Khaled', ...Array.from({ length: 12 }, (_, i) => `Line ${i}`), 'Worked at www.some-agency.test on campaigns', 'Portfolio: www.omar-builds.test'];
    expect(cvPortfolioLinks(lines.join('\n'))).toEqual([{ url: 'https://www.omar-builds.test', kind: 'website' }]);
  });

  it('leaves out a word with a dot (Node.js) and a file name', () => {
    expect(cvPortfolioLinks('Skills: Node.js, Vue.js\nfile.pdf')).toEqual([]);
  });

  it('takes an http:// address as https://', () => {
    expect(cvPortfolioLinks('http://behance.net/omar-k')).toEqual([{ url: 'https://behance.net/omar-k', kind: 'behance' }]);
  });
});

describe('the name, only when confident', () => {
  it('reads the first top line that is a name', () => {
    expect(cvName('Mona Adel Hassan\nVideo Editor\nCairo, Egypt')).toBe('Mona Adel Hassan');
    expect(cvName('محمد أحمد علي\nمصمم جرافيك')).toBe('محمد أحمد علي');
  });

  it('skips a heading like Curriculum Vitae, and makes a name in capitals Title Case', () => {
    expect(cvName('Curriculum Vitae\nOMAR KHALED\nomar@mail.test')).toBe('Omar Khaled');
    expect(cvName('RESUME\nSara El-Sayed')).toBe('Sara El-Sayed');
    expect(cvName('السيرة الذاتية\nسارة محمود')).toBe('سارة محمود');
  });

  it('reads none when the top line isn’t a name: a job title, a heading alone, contacts, one word', () => {
    expect(cvName('Senior Video Editor\nMona Adel')).toBeNull();
    expect(cvName('Curriculum Vitae')).toBeNull();
    expect(cvName('mona@mail.test | 01012345678')).toBeNull();
    expect(cvName('Mona\nVideo Editor')).toBeNull();
    expect(cvName('mona adel\nvideo editor')).toBeNull();
  });

  it('reads "Name: …" near the top', () => {
    expect(cvName('Personal Information\nAddress: Cairo\nName: Omar Khaled')).toBe('Omar Khaled');
  });

  it('reads a LinkedIn profile saved as a PDF: the line above its headline and location', () => {
    const linkedin = [
      'Contact',
      'mona@mail.test',
      'www.linkedin.com/in/mona-adel-test (LinkedIn)',
      'Top Skills',
      'Adobe Premiere Pro',
      'Color Grading',
      'Languages',
      'Arabic (Native or Bilingual)',
      'Mona Adel',
      'Senior Video Editor at A Studio',
      'Cairo, Egypt',
      'Summary',
      'I cut stories.',
      'Experience',
    ].join('\n');
    expect(cvName(linkedin)).toBe('Mona Adel');
    // without the location line
    expect(cvName(linkedin.replace('Cairo, Egypt\n', ''))).toBe('Mona Adel');
  });

  it('nameLike: two to five words of letters, capitals first, no digits, no job words', () => {
    expect(nameLike('Mona Adel')).toBe(true);
    expect(nameLike("Nour O'Brien-Hassan")).toBe(true);
    expect(nameLike('A. Mona Adel')).toBe(true);
    expect(nameLike('Mona')).toBe(false);
    expect(nameLike('Mona Adel 2026')).toBe(false);
    expect(nameLike('Graphic Designer')).toBe(false);
    expect(nameLike('Work Experience')).toBe(false);
  });
});

describe('the years, as the reading works them out, rounded down', () => {
  it('rounds down the months of the date ranges', () => {
    // Jan 2021 – Oct 2026: 5 years 9 months
    expect(cvYearsOf('Experience\nVideo Editor, A Studio, Jan 2021 - Present', NOW)).toBe(5);
    expect(cvYearsOf('Experience\nEditor 03/2025 - 09/2025', NOW)).toBe(0);
    expect(cvYearsOf('No dates here', NOW)).toBeNull();
  });
});

describe('all of it', () => {
  it('fills what a CV gives, and nothing from an empty text', () => {
    const cv = ['Curriculum Vitae', 'Mona Adel', 'mona.adel@mail.test · +20 100 123 4567', 'linkedin.com/in/mona-adel-test', 'Showreel: vimeo.com/123456789', 'Experience', 'Video Editor, A Studio, Jan 2020 - Present'].join('\n');
    expect(cvPrefillOf(cv, NOW)).toEqual({
      fullName: 'Mona Adel',
      email: 'mona.adel@mail.test',
      mobile: '+201001234567',
      linkedin: 'https://www.linkedin.com/in/mona-adel-test',
      portfolioLinks: [{ url: 'https://vimeo.com/123456789', kind: 'vimeo' }],
      yearsExperience: 6,
    });
    expect(cvPrefillOf('   ', NOW)).toEqual({ fullName: null, email: null, mobile: null, linkedin: null, portfolioLinks: [], yearsExperience: null });
  });
});
