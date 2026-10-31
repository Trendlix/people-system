import { colleagueNameSwap, displayNamesOf, seesFullNames, shortName, withColleagueNames, type NamedPerson } from '@trendlix/shared';

// Colleagues by their display names (owner, 31 October 2026: "for employees, make them see their coleagues display names,
// not full names - in any part or process in app and website"): packages/shared colleague-names.ts. Every name here is
// invented.

const MOHAMED: NamedPerson = { id: 'e1', fullNameEn: 'Mohamed Hassan Mohamed Hassan Elagah', fullNameAr: 'محمد حسن محمد حسن العجه', displayName: null };
const HAZEM: NamedPerson = { id: 'e2', fullNameEn: 'Hazem Magdy Abdel Hay Soliman', fullNameAr: 'حازم مجدي عبد الحي سليمان', displayName: 'Hazem Soliman' };
const ARABY: NamedPerson = { id: 'e3', fullNameEn: 'Mohamed Al Araby Mohamed Ali Mrykhh', fullNameAr: null };
const SALMA: NamedPerson = { id: 'e4', fullNameEn: 'Salma Ahmed Abdel Aziz Mohamed', fullNameAr: 'سلمى أحمد عبد العزيز محمد' };

describe('who sees full names', () => {
  it('HR, Finance, the CEO, Admin and the Super Admin; an employee, a manager and a developer not', () => {
    for (const role of ['hr', 'finance', 'ceo', 'admin', 'super_admin']) expect(seesFullNames(['employee', role])).toBe(true);
    expect(seesFullNames(['employee'])).toBe(false);
    expect(seesFullNames(['employee', 'manager'])).toBe(false);
    expect(seesFullNames([])).toBe(false);
  });
});

describe('a display name', () => {
  it('is the first two names, a particle kept with the name after it', () => {
    expect(shortName('Mohamed Hassan Mohamed Hassan Elagah')).toBe('Mohamed Hassan');
    expect(shortName('Mohamed Al Araby Mohamed Ali Mrykhh')).toBe('Mohamed Al Araby');
    expect(shortName('Abdel Rahman Ali Saad')).toBe('Abdel Rahman Ali');
    expect(shortName('Abd El Rahman Mostafa Kamel')).toBe('Abd El Rahman Mostafa');
    expect(shortName('سلمى أحمد عبد العزيز محمد')).toBe('سلمى أحمد');
    expect(shortName('عبد الرحمن محمد علي')).toBe('عبد الرحمن محمد');
    expect(shortName('  Lina   Said ')).toBe('Lina Said');
    // "El Din" and "Allah" stay with the name before them
    expect(shortName('Nour El Din Samir Adel')).toBe('Nour El Din Samir');
    expect(shortName('Gamal Eldin Hassan Ali')).toBe('Gamal Eldin Hassan');
    expect(shortName('Abd Allah Mohamed Ali')).toBe('Abd Allah Mohamed');
    expect(shortName('صلاح الدين محمد علي')).toBe('صلاح الدين محمد');
    expect(shortName('Mohamed El Sayed Ali Hassan')).toBe('Mohamed El Sayed');
    expect(shortName('Nour')).toBe('Nour');
  });

  it('is the profile’s Display name when HR set one, the Arabic one from the Arabic full name', () => {
    expect(displayNamesOf(HAZEM)).toEqual({ en: 'Hazem Soliman', ar: 'حازم مجدي' });
    expect(displayNamesOf(MOHAMED)).toEqual({ en: 'Mohamed Hassan', ar: 'محمد حسن' });
    expect(displayNamesOf({ ...ARABY, displayName: '  ' })).toEqual({ en: 'Mohamed Al Araby', ar: null });
  });
});

describe('the swap in an employee’s answers', () => {
  const people = [MOHAMED, HAZEM, ARABY, SALMA];

  it('swaps every colleague’s full name, in English and Arabic, wherever it is in a text; their own stays', () => {
    const swap = colleagueNameSwap(people, SALMA.id);
    expect(swap('Mohamed Hassan Mohamed Hassan Elagah')).toBe('Mohamed Hassan');
    expect(swap('Leave request from Hazem Magdy Abdel Hay Soliman, approved by Mohamed Al Araby Mohamed Ali Mrykhh.')).toBe(
      'Leave request from Hazem Soliman, approved by Mohamed Al Araby.',
    );
    expect(swap('طلب إجازة من حازم مجدي عبد الحي سليمان')).toBe('طلب إجازة من حازم مجدي');
    // their own name, and anything that isn't a whole full name, as it is
    expect(swap('Salma Ahmed Abdel Aziz Mohamed')).toBe('Salma Ahmed Abdel Aziz Mohamed');
    expect(swap('Mohamed Hassan Mohamed Hassan Elagahs')).toBe('Mohamed Hassan Mohamed Hassan Elagahs');
    expect(swap('Mohamed Hassan')).toBe('Mohamed Hassan');
  });

  it('swaps the longest full name first, so one that begins another isn’t swapped inside it', () => {
    const short: NamedPerson = { id: 'e5', fullNameEn: 'Ali Hassan Mahmoud', displayName: 'Ali H.' };
    const long: NamedPerson = { id: 'e6', fullNameEn: 'Ali Hassan Mahmoud Fathy Saleh', displayName: null };
    const swap = colleagueNameSwap([short, long], null);
    expect(swap('Ali Hassan Mahmoud Fathy Saleh and Ali Hassan Mahmoud')).toBe('Ali Hassan and Ali H.');
  });

  it('walks a whole answer: names in fields, lists and texts, at any depth; numbers, dates and the rest as they are', () => {
    const swap = colleagueNameSwap(people, null);
    const at = new Date('2026-10-31T10:00:00Z');
    const body = {
      items: [
        { employee: { id: 'e1', fullNameEn: MOHAMED.fullNameEn, fullNameAr: MOHAMED.fullNameAr, employeeCode: 'EMP-0027' }, days: 3, at },
        { title: `Approved by ${HAZEM.fullNameEn}`, tags: [SALMA.fullNameEn, 'urgent'], done: true, note: null },
      ],
      total: 2,
    };
    expect(withColleagueNames(body, swap)).toEqual({
      items: [
        { employee: { id: 'e1', fullNameEn: 'Mohamed Hassan', fullNameAr: 'محمد حسن', employeeCode: 'EMP-0027' }, days: 3, at },
        { title: 'Approved by Hazem Soliman', tags: ['Salma Ahmed', 'urgent'], done: true, note: null },
      ],
      total: 2,
    });
    // the answer itself isn't changed
    expect(body.items[0].employee!.fullNameEn).toBe(MOHAMED.fullNameEn);
    expect(withColleagueNames('Mohamed Hassan Mohamed Hassan Elagah', swap)).toBe('Mohamed Hassan');
  });

  it('changes nothing when nobody has a shorter name', () => {
    const swap = colleagueNameSwap([{ id: 'e7', fullNameEn: 'Nour Said' }], null);
    expect(swap('Nour Said')).toBe('Nour Said');
  });
});
