import { describe, expect, it } from 'vitest';
import { proposeQualification } from './qualification';

const none = { degree: '', faculty: '', major: '', university: '' };

describe('the proposed qualification', () => {
  it('reads like a certificate: degree and faculty, the major, the university', () => {
    expect(proposeQualification({ degree: 'bachelor', faculty: 'Commerce', major: 'Accounting', university: 'Ain Shams University' })).toEqual({
      text: 'بكالوريوس التجارة - شعبة المحاسبة - جامعة عين شمس',
      left: [],
    });
  });

  it('gives a licence for the humanities and law, with the department as قسم', () => {
    expect(proposeQualification({ degree: 'bachelor', faculty: 'Arts', major: 'English', university: 'Cairo University' }).text).toBe(
      'ليسانس الآداب - قسم اللغة الإنجليزية - جامعة القاهرة',
    );
    expect(proposeQualification({ ...none, degree: 'bachelor', faculty: 'Law' }).text).toBe('ليسانس الحقوق');
  });

  it('names a degree the way it is awarded where that differs from the faculty', () => {
    expect(proposeQualification({ ...none, degree: 'bachelor', faculty: 'Pharmacy' }).text).toBe('بكالوريوس العلوم الصيدلية');
    expect(proposeQualification({ ...none, degree: 'bachelor', faculty: 'Medicine' }).text).toBe('بكالوريوس الطب والجراحة');
  });

  it('puts the major first for a master’s or a doctorate', () => {
    expect(proposeQualification({ degree: 'master', faculty: 'Commerce', major: 'accounting', university: 'Cairo University' }).text).toBe(
      'ماجستير في المحاسبة - كلية التجارة - جامعة القاهرة',
    );
    expect(proposeQualification({ ...none, degree: 'doctorate' }).text).toBe('دكتوراه');
  });

  it('takes what was typed in Arabic, and leaves out (and names) what is only in English', () => {
    expect(proposeQualification({ degree: 'bachelor', faculty: 'كلية الآداب', major: 'تاريخ', university: 'جامعة الأزهر فرع أسيوط' }).text).toBe(
      'ليسانس الآداب - قسم تاريخ - جامعة الأزهر فرع أسيوط',
    );
    expect(proposeQualification({ degree: 'bachelor', faculty: 'Commerce', major: 'Supply Chain', university: 'Some College Abroad' })).toEqual({
      text: 'بكالوريوس التجارة',
      left: ['major', 'university'],
    });
  });

  it('proposes nothing before the degree, and the secondary certificate alone', () => {
    expect(proposeQualification({ ...none, faculty: 'Commerce' }).text).toBe('');
    expect(proposeQualification({ ...none, degree: 'high_school', faculty: 'Commerce' }).text).toBe('شهادة الثانوية العامة');
  });
});
