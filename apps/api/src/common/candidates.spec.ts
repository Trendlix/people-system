import {
  ALREADY_APPLIED,
  applicationsBadge,
  candidateCode,
  candidateDecision,
  candidateEmail,
  candidateEmployeeText,
  candidateKeys,
  candidateMobile,
  candidateNameKey,
  DEVELOPER_CODE_SEARCH,
  developerPeople,
  developerQuery,
  emailFixed,
  emailLocal,
  employeeBadge,
  isCandidateCode,
  isWeakMatch,
  keySetOf,
  linkedinKey,
  maskForDeveloper,
  matchKindOf,
  matchReasons,
  matchScore,
  matchSignals,
  mobileTail,
  portfolioKey,
  rankMatches,
  type CandidateEmployeeLink,
  type CandidateFacts,
  type MatchSignal,
} from '@trendlix/shared';

// Candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and prevent
// duplication? even if the same candidate applied for 2 jobs"; "Email or mobile"; "Link and show rehire"; "and their is a
// possible match from other fields, HR decides from suggested match"): the normalizing, the joining decision (the email
// wins, the possible duplicate pair), the suggestions' signs and their ranking, the badges and the employee's line, and
// the Developer's "Candidate CAN-0001". Every name is invented.

const facts = (f: Partial<CandidateFacts>): CandidateFacts => ({ emails: [], mobiles: [], linkedins: [], portfolios: [], names: [], cvHashes: [], cvEmails: [], cvPhones: [], ...f });
const keys = (f: Partial<CandidateFacts>) => keySetOf(candidateKeys(facts(f)));

describe('candidate profiles: normalizing what people type', () => {
  it('codes: CAN-0001 in their own series', () => {
    expect(candidateCode(1)).toBe('CAN-0001');
    expect(candidateCode(12345)).toBe('CAN-12345');
    expect(isCandidateCode('CAN-0042')).toBe(true);
    expect(isCandidateCode('APP-2026-0042')).toBe(false);
  });

  it('emails: trimmed and in lower case; one that is not an email is nothing', () => {
    expect(candidateEmail('  Mona.Ali@Gmail.COM ')).toBe('mona.ali@gmail.com');
    expect(candidateEmail('mona at gmail')).toBe('');
    expect(candidateEmail(undefined)).toBe('');
  });

  it('mobiles: the system’s phone rule (+20…), an old 01… taken as Egyptian; one that can’t be dialled is nothing', () => {
    expect(candidateMobile('01012345678')).toBe('+201012345678');
    expect(candidateMobile('+20 101 234 5678')).toBe('+201012345678');
    expect(candidateMobile('0020 101 234 5678')).toBe('+201012345678');
    expect(candidateMobile('+966 50 123 4567')).toBe('+966501234567');
    expect(candidateMobile('call me')).toBeNull();
    expect(candidateMobile('123')).toBeNull();
    expect(candidateMobile(null)).toBeNull();
  });

  it('LinkedIn: linkedin.com/in/<slug>, whatever the subdomain, protocol, query, slash or case', () => {
    const key = 'linkedin.com/in/mona-ali-123';
    expect(linkedinKey('https://www.linkedin.com/in/Mona-Ali-123/?originalSubdomain=eg')).toBe(key);
    expect(linkedinKey('eg.linkedin.com/in/mona-ali-123')).toBe(key);
    expect(linkedinKey('http://linkedin.com/in/mona-ali-123#about')).toBe(key);
    expect(linkedinKey('linkedin.com/in/mona%20ali')).toBe('linkedin.com/in/mona ali');
    expect(linkedinKey('https://www.linkedin.com/company/trendlix')).toBeNull();
    expect(linkedinKey('')).toBeNull();
  });

  it('portfolios: the host without www and the path without its slash, no query; a site’s bare address names nobody', () => {
    expect(portfolioKey('https://www.Behance.net/Mona/?tab=1')).toBe('behance.net/mona');
    expect(portfolioKey('behance.net/mona#work')).toBe('behance.net/mona');
    expect(portfolioKey('https://mona-ali.com/')).toBe('mona-ali.com');
    expect(portfolioKey('https://behance.net')).toBeNull();
    expect(portfolioKey('not a link')).toBeNull();
  });

  it('names: case, spaces, diacritics and the Arabic letter forms written either way', () => {
    expect(candidateNameKey('  Mona   ALI ')).toBe('mona ali');
    expect(candidateNameKey('José Müller')).toBe('jose muller');
    expect(candidateNameKey('Mona-Ali')).toBe('mona ali');
    expect(candidateNameKey('أحمد إبراهيم')).toBe(candidateNameKey('احمد ابراهيم'));
    expect(candidateNameKey('آية')).toBe(candidateNameKey('ايه'));
    expect(candidateNameKey('مُنى')).toBe(candidateNameKey('منى'));
    expect(candidateNameKey('منى')).toBe('مني');
    expect(candidateNameKey('مـــنى')).toBe('مني');
  });

  it('emails nearly the same: a common typo put right, Gmail’s dots and +tags; the local part on its own', () => {
    expect(emailFixed('mona.ali@gmial.com')).toBe('monaali@gmail.com');
    expect(emailFixed('mona.ali+jobs@gmail.com')).toBe('monaali@gmail.com');
    expect(emailFixed('mona@hotmial.com')).toBe('mona@hotmail.com');
    expect(emailLocal('ahmed.ali@yahoo.com')).toBe('ahmed.ali');
    expect(emailLocal('info@company.com')).toBeNull();
    expect(emailLocal('ali@x.com')).toBeNull();
  });

  it('mobiles’ last 9 digits, for the same number with another country code', () => {
    expect(mobileTail('+201012345678')).toBe('012345678');
    expect(mobileTail('+9661012345678')).toBe(mobileTail('+201012345678'));
    expect(mobileTail('nothing')).toBeNull();
  });
});

describe('candidate profiles: joining one (the owner’s "Email or mobile")', () => {
  it('the email’s candidate, else the mobile’s, else a new one', () => {
    expect(candidateDecision({ byEmail: 'a', byMobile: null })).toEqual({ join: 'a', possibleDuplicateOf: null });
    expect(candidateDecision({ byEmail: null, byMobile: 'b' })).toEqual({ join: 'b', possibleDuplicateOf: null });
    expect(candidateDecision({ byEmail: null, byMobile: null })).toEqual({ join: null, possibleDuplicateOf: null });
    expect(candidateDecision({ byEmail: 'a', byMobile: 'a' })).toEqual({ join: 'a', possibleDuplicateOf: null });
  });

  it('the email of one and the mobile of another: the email’s, never merged, the mobile’s a possible duplicate', () => {
    expect(candidateDecision({ byEmail: 'a', byMobile: 'b' })).toEqual({ join: 'a', possibleDuplicateOf: 'b' });
  });

  it('the careers page’s refusal of the same job twice', () => {
    expect(ALREADY_APPLIED).toBe("You've already applied for this job. We'll be in touch.");
  });
});

describe('candidate profiles: the suggested matches (the owner’s "HR decides from suggested match")', () => {
  it('a candidate’s keys: normalized, each once', () => {
    const k = candidateKeys(
      facts({ emails: ['Mona@Gmail.com', 'mona@gmail.com'], mobiles: ['01012345678', '+201012345678', 'none'], names: ['Mona Ali', 'Mona'], linkedins: ['linkedin.com/in/mona'] }),
    );
    const by = (kind: string) =>
      k
        .filter((x) => x.kind === kind)
        .map((x) => x.value)
        .sort();
    expect(by('email')).toEqual(['mona@gmail.com']);
    expect(by('mobile')).toEqual(['+201012345678']);
    expect(by('mobile_tail')).toEqual(['012345678']);
    // a single word names too many people
    expect(by('name')).toEqual(['mona ali']);
    expect(by('linkedin')).toEqual(['linkedin.com/in/mona']);
  });

  it('each sign, with its reason', () => {
    const base = keys({ emails: ['mona.ali@gmail.com'], mobiles: ['+201012345678'], names: ['Mona Ali'] });
    expect(matchSignals(base, keys({ emails: ['other@mail.test'], mobiles: ['+201012345678'] }))).toEqual(['same_mobile']);
    expect(matchSignals(base, keys({ emails: ['mona.ali@gmail.com'] }))).toEqual(['same_email']);
    expect(matchSignals(keys({ linkedins: ['https://www.linkedin.com/in/Mona-A/'] }), keys({ linkedins: ['eg.linkedin.com/in/mona-a'] }))).toEqual(['same_linkedin']);
    expect(matchSignals(keys({ portfolios: ['behance.net/mona'] }), keys({ portfolios: ['https://www.behance.net/Mona/'] }))).toEqual(['same_portfolio']);
    const hash = 'a'.repeat(64);
    expect(matchSignals(keys({ cvHashes: [hash] }), keys({ cvHashes: [hash] }))).toEqual(['same_cv']);
    expect(matchSignals(base, keys({ names: ['MONA  ALI'] }))).toEqual(['same_name']);
    // a typo in the domain: nearly the same, not the "same local part on another domain"
    expect(matchSignals(base, keys({ emails: ['mona.ali@gmial.com'] }))).toEqual(['email_typo']);
    expect(matchSignals(base, keys({ emails: ['mona.ali@yahoo.com'] }))).toEqual(['email_domain']);
    expect(matchSignals(base, keys({ mobiles: ['+9661012345678'] }))).toEqual(['mobile_country']);
    // the CV's contacts: an email or a phone found in one CV that is the other's
    expect(matchSignals(base, keys({ cvEmails: ['mona.ali@gmail.com'] }))).toEqual(['cv_contact']);
    expect(matchSignals(keys({ cvPhones: ['010 1234 5678'] }), base)).toEqual(['cv_contact']);
    expect(matchSignals(base, keys({ emails: ['nobody@mail.test'], names: ['Sara Omar'] }))).toEqual([]);
  });

  it('the kind: a possible duplicate by the same email or mobile, else a suggestion', () => {
    expect(matchKindOf(['same_mobile', 'same_name'])).toBe('duplicate');
    expect(matchKindOf(['same_linkedin', 'same_name'])).toBe('suggested');
  });

  it('scores and reasons, strongest first: "Same LinkedIn · Same name"; a name alone ranked last', () => {
    expect(matchReasons(['same_name', 'same_linkedin'])).toBe('Same LinkedIn · Same name');
    expect(matchScore(['same_linkedin', 'same_name'])).toBe(95);
    expect(matchScore(['same_email', 'same_mobile'])).toBe(100);
    expect(isWeakMatch(['same_name'])).toBe(true);
    expect(isWeakMatch(['same_name', 'email_domain'])).toBe(false);
    const row = (id: string, signals: MatchSignal[], updatedAt = '2026-10-22T10:00:00Z') => ({ id, signals, score: matchScore(signals), updatedAt });
    const ranked = rankMatches([row('name', ['same_name'], '2026-10-22T12:00:00Z'), row('domain', ['email_domain']), row('linkedin', ['same_linkedin', 'same_name']), row('cv', ['same_cv'])]);
    expect(ranked.map((r) => r.id)).toEqual(['linkedin', 'cv', 'domain', 'name']);
  });
});

describe('candidate profiles: the badges and the employee', () => {
  it('"2 applications", "Applied before", or nothing the first time', () => {
    expect(applicationsBadge({ applications: 1, generalCvs: 0 })).toBeNull();
    expect(applicationsBadge({ applications: 2, generalCvs: 0 })).toBe('2 applications');
    expect(applicationsBadge({ applications: 3, generalCvs: 1 })).toBe('3 applications');
    expect(applicationsBadge({ applications: 1, generalCvs: 1 })).toBe('Applied before');
    expect(employeeBadge('former')).toBe('Former employee');
    expect(employeeBadge('restricted')).toBe('Employee record');
    expect(employeeBadge(null)).toBeNull();
  });

  it('"Former employee EMP-0182: left 2025-03 (Resigned) · Rehire: Yes"; a C-level person only "Linked to an employee record"', () => {
    const former: CandidateEmployeeLink = {
      restricted: false,
      employee: { id: 'e', employeeCode: 'EMP-0182', fullNameEn: 'Omar Invented' },
      state: 'former',
      leftOn: '2025-03-31',
      endReason: 'resigned',
      endReasonLabel: 'Resigned',
      rehire: 'eligible',
      rehireReason: null,
    };
    expect(candidateEmployeeText(former)).toBe('Former employee EMP-0182: left 2025-03 (Resigned) · Rehire: Yes');
    expect(candidateEmployeeText({ ...former, rehire: 'not_eligible' })).toBe('Former employee EMP-0182: left 2025-03 (Resigned) · Rehire: No');
    expect(candidateEmployeeText({ ...former, rehire: 'conditional' })).toBe('Former employee EMP-0182: left 2025-03 (Resigned) · Rehire: With conditions');
    expect(candidateEmployeeText({ ...former, rehire: null })).toBe('Former employee EMP-0182: left 2025-03 (Resigned) · Rehire: Not decided');
    expect(candidateEmployeeText({ ...former, state: 'current', leftOn: null })).toBe('Current employee EMP-0182');
    expect(candidateEmployeeText({ ...former, restricted: true, employee: null })).toBe('Linked to an employee record');
  });
});

describe('candidate profiles: the Developer role', () => {
  it('a candidate is "Candidate CAN-0001", their name scrubbed; a search by the code is kept, by a name not', () => {
    const people = developerPeople({ employees: [], users: [], applicants: [], offers: [], candidates: [{ id: 'c1', code: 'CAN-0001', fullName: 'Mona Invented' }] });
    const masked = maskForDeveloper(
      { id: 'c1', code: 'CAN-0001', fullName: 'Mona Invented', emailContacts: [{ email: 'mona@mail.test' }], mobileContacts: [{ mobile: '+201012345678' }], cvs: [{ cvFileName: 'Mona Invented CV.pdf' }], timeline: [{ text: 'Mona Invented applied' }] },
      '/api/recruitment/candidates/c1',
      people,
    ) as Record<string, unknown>;
    expect(masked.fullName).toBe('Candidate CAN-0001');
    expect(JSON.stringify(masked)).not.toContain('Mona Invented');
    expect(JSON.stringify(masked)).not.toContain('mona@mail.test');
    expect(JSON.stringify(masked)).not.toContain('1012345678');
    expect(DEVELOPER_CODE_SEARCH.test('CAN-0001')).toBe(true);
    expect(developerQuery({ q: 'CAN-0001' })).toBeNull();
    expect(developerQuery({ q: 'Mona' })).not.toBeNull();
  });
});
