import {
  APPLICATION_CHANNELS,
  APPLICATION_SOURCE_LABELS,
  applicationSourceText,
  careersIpToken,
  cvGuesses,
  emailIn,
  GENERAL_CV_IP_TOKEN,
  generalAreas,
  generalCvProblems,
  looksLikeName,
  mobileIn,
  moveProblem,
  movedSourceText,
  nameFromFile,
  sourceLine,
  sourceOf,
  withinDays,
} from '@trendlix/shared';

// General CVs, the applicants by posted job and the bulk upload's reading of a CV (owner, 22 October 2026: "i want a
// proper viweing, what came out of the posted jobs and what cam on randomly", "Both"; "is there a way to easy apply from
// linkedin?" … "why not"; packages/shared general-cvs.ts). Every CV here is made up.

const good = { fullName: 'Mona Adel', email: 'Mona.Adel@Mail.test', mobile: '+20 100 123 4567', consent: true, positionKey: '00000000-0000-4000-8000-000000000001:video editor' };

describe('a general CV’s rules', () => {
  // owner, 25 October 2026: "Position, grouped by team"; an older page's area still taken for one release
  it('takes the careers page’s form with a position (or Other in words, or an older page’s area) and the consent', () => {
    expect(generalCvProblems(good, { byHr: false })).toEqual([]);
    expect(generalCvProblems({ ...good, positionKey: null, positionOther: 'Photographer' }, { byHr: false })).toEqual([]);
    expect(generalCvProblems({ ...good, positionKey: null, departmentId: '00000000-0000-4000-8000-000000000001' }, { byHr: false })).toEqual([]);
    expect(generalCvProblems({ ...good, positionKey: null, areaOther: 'Photography' }, { byHr: false })).toEqual([]);
    expect(generalCvProblems({ ...good, linkedin: 'linkedin.com/in/mona' }, { byHr: false })).toEqual([]);
  });

  it('names every problem: the details, the position, the consent', () => {
    expect(generalCvProblems({ fullName: 'M', email: 'x', mobile: '1', consent: false }, { byHr: false })).toEqual([
      'Write your full name.',
      'Write a full email address, e.g. name@example.com.',
      'Write the mobile number without the 0 in front, after choosing the country code.',
      'Choose the position you would like, or Other and write it.',
      'Tick that we may keep your details and CV to consider you for jobs.',
    ]);
    expect(generalCvProblems({ ...good, positionKey: '  ', positionOther: ' ' }, { byHr: false })).toEqual(['Choose the position you would like, or Other and write it.']);
    expect(generalCvProblems({ ...good, positionKey: null, positionOther: 'x'.repeat(81) }, { byHr: false })).toEqual(['Keep the position to 80 characters or fewer.']);
    expect(generalCvProblems({ ...good, positionKey: null, areaOther: 'x'.repeat(81) }, { byHr: false })).toEqual(['Keep the area to 80 characters or fewer.']);
  });

  it('HR’s Add a CV: how it came, who referred them, the person’s agreement', () => {
    expect(generalCvProblems({ ...good, source: 'email' }, { byHr: true })).toEqual([]);
    expect(generalCvProblems({ ...good, source: 'careers', consent: false }, { byHr: true })).toEqual([
      'Choose how the CV came: email, WhatsApp, LinkedIn, in person, referral or other.',
      'Tick that the person agreed to be considered.',
    ]);
    expect(generalCvProblems({ ...good, source: 'referral' }, { byHr: true })).toEqual(['Write who referred them.']);
    expect(generalCvProblems({ ...good, source: 'referral', referrer: 'Omar Khaled' }, { byHr: true })).toEqual([]);
    expect(generalCvProblems({ ...good, positionKey: null, source: 'email' }, { byHr: true })).toEqual(['Choose the position they would like, or Other and write it.']);
  });

  it('moves a new or reviewed one only', () => {
    expect(moveProblem('new')).toBeNull();
    expect(moveProblem('reviewed')).toBeNull();
    expect(moveProblem('moved')).toBe('It was moved to a vacancy already.');
    expect(moveProblem('archived')).toBe('It is archived: restore it first.');
  });

  it('counts 30 days from the moment it came', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(withinDays(new Date('2026-09-23T12:00:01Z'), 30, now)).toBe(true);
    expect(withinDays(new Date('2026-09-22T12:00:00Z'), 30, now)).toBe(false);
  });

  it('signs the general form’s address for itself, as a job’s for its own', () => {
    expect(GENERAL_CV_IP_TOKEN).toBe(careersIpToken('general'));
  });
});

// owner, 22 October 2026: "from my POV, it should be related to teams not departments"; "C Level isn't an option for any
// user or even HR"; then "remove the department from the dropdown menu, area you would like to work in"
describe('the areas a CV may be for', () => {
  const team = (id: string, name: string, cLevel = false) => ({ id, name, cLevel });

  it('offers the teams by their own names, a department only without teams, never a C-level one, in the given order', () => {
    const areas = generalAreas([
      { id: 'prod', name: 'Production', cLevel: false, teams: [team('video', 'Video'), team('photo', 'Photography')] },
      { id: 'finance', name: 'Finance', cLevel: false, teams: [] },
      { id: 'board', name: 'Board', cLevel: true, teams: [] },
      { id: 'mgmt', name: 'Management', cLevel: false, teams: [team('exec', 'Executive', true), team('ops', 'Operations')] },
    ]);
    expect(areas).toEqual([
      { id: 'video', name: 'Video', hrName: 'Video · Production' },
      { id: 'photo', name: 'Photography', hrName: 'Photography · Production' },
      { id: 'finance', name: 'Finance', hrName: 'Finance' },
      { id: 'ops', name: 'Operations', hrName: 'Operations · Management' },
    ]);
    expect(areas.map((a) => a.id)).not.toContain('prod');
  });

  it('tells apart only the teams that share a name, by their department in brackets', () => {
    const areas = generalAreas([
      { id: 'mkt', name: 'Marketing', cLevel: false, teams: [team('mkt-content', 'Content'), team('social', 'Social media')] },
      { id: 'prod', name: 'Production', cLevel: false, teams: [team('prod-content', ' content '), team('video', 'Video')] },
      { id: 'video-dept', name: 'Sales', cLevel: false, teams: [] },
    ]);
    expect(areas.map((a) => a.name)).toEqual(['Content (Marketing)', 'Social media', 'content (Production)', 'Video', 'Sales']);
    // a department without teams keeps its own name even when a team is called the same
    expect(generalAreas([{ id: 'v', name: 'Video', cLevel: false, teams: [] }, { id: 'p', name: 'Production', cLevel: false, teams: [team('pv', 'Video')] }]).map((a) => a.name)).toEqual([
      'Video',
      'Video (Production)',
    ]);
  });
});

describe('the sources', () => {
  it('says the careers page came without a posted link, and a moved CV where it came from', () => {
    expect(APPLICATION_SOURCE_LABELS.careers).toBe('Careers page (direct)');
    expect(applicationSourceText({ source: 'linkedin' })).toBe('LinkedIn');
    expect(applicationSourceText({ source: 'general', generalSource: 'email' })).toBe('General CV (Email)');
    expect(applicationSourceText({ source: 'general', generalSource: null })).toBe('General CV');
    expect(movedSourceText('walk_in')).toBe('General CV (In person)');
  });

  it('never takes a general CV’s source from a link', () => {
    expect(APPLICATION_CHANNELS).not.toContain('general');
    expect(sourceOf('general')).toBe('other');
    expect(sourceOf('linkedin')).toBe('linkedin');
    expect(sourceOf('')).toBe('careers');
  });

  it('puts a vacancy’s sources in a line, in order, those with none left out', () => {
    expect(sourceLine({ careers: 3, linkedin: 4, job_board: 1, facebook: 0, general: 2 })).toEqual([
      { source: 'careers', label: 'Careers page (direct, no link)', count: 3 },
      { source: 'linkedin', label: 'LinkedIn', count: 4 },
      { source: 'job_board', label: 'Job boards', count: 1 },
      { source: 'general', label: 'General CV', count: 2 },
    ]);
    expect(sourceLine({})).toEqual([]);
  });
});

describe('reading a CV', () => {
  it('finds an Egyptian mobile however it is written, kept with +20', () => {
    expect(mobileIn('Mobile: 0100 123 4567')).toBe('+201001234567');
    expect(mobileIn('Tel +20 112-345-6789')).toBe('+201123456789');
    expect(mobileIn('call 00201551234567')).toBe('+201551234567');
    expect(mobileIn('هاتف: ٠١٢٣٤٥٦٧٨٩٠')).toBe('+201234567890');
    expect(mobileIn('2015 – 2019, 120 hours')).toBeNull();
  });

  it('finds an international one with its country code', () => {
    expect(mobileIn('Phone: +971 50 123 4567')).toBe('+971501234567');
    expect(mobileIn('+44 7700 900123')).toBe('+447700900123');
  });

  it('finds the email, in lower case', () => {
    expect(emailIn('Contact: Mona.Adel@Mail.TEST | Cairo')).toBe('mona.adel@mail.test');
    expect(emailIn('no address here')).toBeNull();
  });

  it('tells a name from a heading, a title or a contact line', () => {
    expect(looksLikeName('Mona Adel Hassan')).toBe(true);
    expect(looksLikeName('منى عادل حسن')).toBe(true);
    expect(looksLikeName("Sara O'Brien")).toBe(true);
    expect(looksLikeName('Curriculum Vitae')).toBe(false);
    expect(looksLikeName('السيرة الذاتية')).toBe(false);
    expect(looksLikeName('mona@mail.test')).toBe(false);
    expect(looksLikeName('Cairo, Egypt')).toBe(false);
    expect(looksLikeName('Senior Video Editor at Studio One Productions Cairo')).toBe(false);
    expect(looksLikeName('Mona')).toBe(false);
  });

  it('makes a name of a file’s name when the text has none', () => {
    expect(nameFromFile('mona_adel-CV (1).pdf')).toBe('Mona Adel');
    expect(nameFromFile('Resume_Omar.Khaled_2026.docx')).toBe('Omar Khaled');
    expect(nameFromFile('scan0001.pdf')).toBe('Scan');
    expect(nameFromFile('123.pdf')).toBeNull();
  });

  it('guesses the person from a CV’s text', () => {
    const text = ['CURRICULUM VITAE', 'Mona Adel Hassan', 'Video Editor', 'Cairo, Egypt | mona.adel@mail.test | 0100 123 4567', 'Experience', '2019 – 2026 Studio'].join('\n');
    expect(cvGuesses(text, 'cv.pdf')).toEqual({ fullName: 'Mona Adel Hassan', email: 'mona.adel@mail.test', mobile: '+201001234567' });
  });

  it('falls back on the file’s name for a scanned CV, with nothing else', () => {
    expect(cvGuesses('', 'Omar_Khaled_CV.pdf')).toEqual({ fullName: 'Omar Khaled', email: null, mobile: null });
  });
});
