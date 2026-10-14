import { datesIn, nationalIdsIn, readIdCard } from './egyptian-id.js';

// Synthetic OCR text, laid out as the OCR service returns real cards: one line per printed line, in reading order,
// digits as printed (Arabic-Indic), with the noise OCR adds (stray marks, split digit groups, tatweel, Persian forms).
const TODAY = '2026-10-14';

const FRONT = `جمهورية مصر العربية
بطاقة تحقيق الشخصية
محمد
أحمد محمود عبد الله
١٥ شارع مكرم عبيد
أول مدينة نصر - القاهرة
٢٩٥٠٣١٢٠١٢٣٤٥٦
FA1234567`;

const BACK = `٢٩٥٠٣١٢٠١٢٣٤٥٦   ٢٠٢٠/٠٧
سجل مدني مدينة نصر
مهندس برمجيات
ذكر     مسلم     أعزب
البطاقة سارية حتى ٢٠٢٧/٠٧/١١`;

// A noisier card: misread header, tatweel, a Persian yeh, the ID in groups, the expiry date on its own line.
const NOISY_FRONT = `| جمهوريه مصر العربيه
بطاقـة تحقيق الشخصيه .
ســارة
محمود علی حسن
٣ ش الجمهورية - عمارة ٧ ،
مركز طنطا - الغربية
.
٣٠١٠ ٢٢٨١ ٦٠٤٥ ٦٢`;

const NOISY_BACK = `٣٠١٠٢٢٨١٦٠٤٥٦٢
طالبة
أنثى  مسلمة  آنسة
٠٥ / ٢٠١٩
سجل مدنى طنطا أول
البطاقة ســارية حتى
١٤/٠٥/٢٠٢٦`;

describe('Egyptian ID card reader', () => {
  it('reads every field of a clean front and back', () => {
    expect(readIdCard(FRONT, BACK, TODAY)).toEqual({
      nationalId: '29503120123456',
      dateOfBirth: '1995-03-12',
      fullNameAr: 'محمد أحمد محمود عبد الله',
      addressAr: '١٥ شارع مكرم عبيد، أول مدينة نصر - القاهرة',
      gender: 'male',
      issueDate: '2020-07-01',
      expiryDate: '2027-07-11',
      issuingOffice: 'سجل مدني مدينة نصر',
      printedNo: 'FA1234567',
    });
  });

  it('reads through OCR noise: split digit groups, tatweel, Persian letters, dates on their own lines', () => {
    expect(readIdCard(NOISY_FRONT, NOISY_BACK, TODAY)).toEqual({
      nationalId: '30102281604562',
      dateOfBirth: '2001-02-28',
      fullNameAr: 'سارة محمود علي حسن',
      addressAr: '٣ ش الجمهورية - عمارة ٧، مركز طنطا - الغربية',
      gender: 'female',
      issueDate: '2019-05-01',
      expiryDate: '2026-05-14',
      issuingOffice: 'سجل مدنى طنطا أول',
    });
  });

  it('reads one side alone', () => {
    const front = readIdCard(FRONT, null, TODAY);
    expect(front).toMatchObject({ nationalId: '29503120123456', fullNameAr: 'محمد أحمد محمود عبد الله' });
    expect(front).not.toHaveProperty('gender');
    expect(front).not.toHaveProperty('expiryDate');

    const back = readIdCard(null, BACK, TODAY);
    expect(back).toMatchObject({ nationalId: '29503120123456', dateOfBirth: '1995-03-12', gender: 'male', expiryDate: '2027-07-11' });
    expect(back).not.toHaveProperty('fullNameAr');
    expect(readIdCard(null, null, TODAY)).toEqual({});
  });

  it('suggests no national ID when the two sides disagree', () => {
    const back = BACK.replace('٢٩٥٠٣١٢٠١٢٣٤٥٦', '٢٩٥٠٣١٢٠١٢٣٤٥٧');
    const read = readIdCard(FRONT, back, TODAY);
    expect(read).not.toHaveProperty('nationalId');
    expect(read).not.toHaveProperty('dateOfBirth');
    expect(read.fullNameAr).toBe('محمد أحمد محمود عبد الله'); // the rest is still read
  });

  it('takes the ID both sides agree on when one side has a misread copy', () => {
    const front = FRONT.replace('FA1234567', '٢٩٥٠٣١٢٠١٢٣٤٤٤'); // a second, misread number
    expect(readIdCard(front, BACK, TODAY).nationalId).toBe('29503120123456');
  });

  it('ignores numbers that are not national IDs', () => {
    const invalid = (id: string) => readIdCard(FRONT.replace('٢٩٥٠٣١٢٠١٢٣٤٥٦', id), null, TODAY);
    expect(invalid('٢٩٥٠٢٣٠٠١٢٣٤٥٦')).not.toHaveProperty('nationalId'); // 30 February
    expect(invalid('١٩٥٠٣١٢٠١٢٣٤٥٦')).not.toHaveProperty('nationalId'); // no such century
    expect(invalid('٣٣٠٠١٠١٠١٠٠٠١١')).not.toHaveProperty('nationalId'); // born in 2030
    expect(invalid('٢٩٥٠٣١٢٠١٢٣٤٥')).not.toHaveProperty('nationalId'); // 13 digits
  });

  it('skips a header OCR split or misread, but not an address on Gomhoreya Street', () => {
    const front = FRONT.replace('جمهورية مصر العربية\nبطاقة تحقيق الشخصية', 'جمهوريـة مصر\nالعربية\nبطاقه\nتحقيق الشخصيه');
    expect(readIdCard(front, null, TODAY).fullNameAr).toBe('محمد أحمد محمود عبد الله');
    const street = readIdCard(FRONT.replace('١٥ شارع مكرم عبيد', '١٥ شارع الجمهورية'), null, TODAY);
    expect(street.addressAr).toBe('١٥ شارع الجمهورية، أول مدينة نصر - القاهرة');
  });

  it('keeps the name but not the address when the ID line is missing', () => {
    const front = FRONT.replace('٢٩٥٠٣١٢٠١٢٣٤٥٦\n', '');
    const read = readIdCard(front, null, TODAY);
    expect(read.fullNameAr).toBe('محمد أحمد محمود عبد الله');
    expect(read).not.toHaveProperty('addressAr');
  });

  it('suggests no name when the name lines hold digits or Latin letters', () => {
    expect(readIdCard(FRONT.replace('محمد\n', 'محمد ١٢\n'), null, TODAY)).not.toHaveProperty('fullNameAr');
    expect(readIdCard(FRONT.replace('محمد\n', 'Mohamed\n'), null, TODAY)).not.toHaveProperty('fullNameAr');
  });

  it('reads the gender from the words only, and not when both appear', () => {
    expect(readIdCard(null, BACK.replace('ذكر', 'انثى'), TODAY).gender).toBe('female');
    expect(readIdCard(null, BACK.replace('ذكر', 'أنثي'), TODAY).gender).toBe('female');
    expect(readIdCard(null, BACK.replace('ذكر', 'ذكر أنثى'), TODAY)).not.toHaveProperty('gender');
    expect(readIdCard(null, BACK.replace('ذكر', 'تذكرة'), TODAY)).not.toHaveProperty('gender');
  });

  it('suggests no issue date when there are several candidates', () => {
    const back = `${BACK}\n٢٠٢١/٠٣`;
    const read = readIdCard(null, back, TODAY);
    expect(read).not.toHaveProperty('issueDate');
    expect(read.expiryDate).toBe('2027-07-11');
  });

  it('suggests no issuing office without a name after "سجل مدني"', () => {
    expect(readIdCard(null, BACK.replace('سجل مدني مدينة نصر', 'سجل مدني'), TODAY)).not.toHaveProperty('issuingOffice');
  });

  it('reads the printed code in Latin or Arabic-Indic digits', () => {
    expect(readIdCard(FRONT.replace('FA1234567', 'FA ١٢٣٤٥٦٧'), null, TODAY).printedNo).toBe('FA1234567');
    expect(readIdCard(FRONT.replace('FA1234567', 'FA12345'), null, TODAY)).not.toHaveProperty('printedNo');
  });

  describe('national IDs in a line', () => {
    it('joins digit groups split by spaces or dashes, in any digits', () => {
      expect(nationalIdsIn('٢٩٥٠ ٣١٢٠ ١٢٣٤ ٥٦', TODAY)).toEqual(['29503120123456']);
      expect(nationalIdsIn('2950-3120-1234-56', TODAY)).toEqual(['29503120123456']);
      expect(nationalIdsIn('٢ ٢٩٥٠٣١٢٠١٢٣٤٥٦', TODAY)).toEqual(['29503120123456']); // a stray digit before it
      expect(nationalIdsIn('الرقم: 29503120123456 / 2020', TODAY)).toEqual(['29503120123456']);
      expect(nationalIdsIn('2950312012345678', TODAY)).toEqual([]); // 16 digits in one run
    });
  });

  describe('dates', () => {
    it('reads YYYY/MM/DD, DD/MM/YYYY, YYYY/MM and MM/YYYY', () => {
      expect(datesIn('سارية حتى ٢٠٢٧/٠٧/١١')).toEqual([{ ymd: '2027-07-11', monthOnly: false }]);
      expect(datesIn('11-7-2027')).toEqual([{ ymd: '2027-07-11', monthOnly: false }]);
      expect(datesIn('2027.07.11')).toEqual([{ ymd: '2027-07-11', monthOnly: false }]);
      expect(datesIn('٢٠٢٠ / ٧')).toEqual([{ ymd: '2020-07-01', monthOnly: true }]);
      expect(datesIn('07/2020')).toEqual([{ ymd: '2020-07-01', monthOnly: true }]);
    });

    it('refuses dates that do not exist or numbers that are not dates', () => {
      expect(datesIn('2027/02/30')).toEqual([]);
      expect(datesIn('2027/13')).toEqual([]);
      expect(datesIn('12/34')).toEqual([]);
      expect(datesIn('29503120123456')).toEqual([]);
    });
  });
});
