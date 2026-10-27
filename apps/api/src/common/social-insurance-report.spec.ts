import {
  lawRatesFor,
  siChecked,
  siForm1State,
  siForm6State,
  siFurthest,
  siInsured,
  siMarksText,
  siMissingCounts,
  siMissingItems,
  siMissingRow,
  siMonthMarks,
  siMonthRow,
  siMonthTotals,
  siOrder,
  siPercent,
  siPlaceParts,
  siPrintState,
  siRatesOf,
  siRegisterRow,
  siShares,
  siStatusMatches,
  siTotals,
  type SiSource,
} from '@trendlix/shared';

// The Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from the
// social insurance tab"; he chose all three: the register, the monthly contributions and the missing data): who is on
// each view, the insured wage and both shares as the tab and payroll work them out, where Forms 1 and 6 and the print
// stand, what is missing, the totals and the order. Everyone here is invented.

const LAW = lawRatesFor(2026);

const source = (over: { tab?: Partial<SiSource['tab']>; employment?: Partial<SiSource['employment']>; contractPay?: number | null; file?: SiSource['file']; name?: string } = {}): SiSource => ({
  employee: { id: `id-${over.name ?? 'rana'}`, employeeCode: 'EMP-0001', fullNameEn: over.name ?? 'Rana Insured', fullNameAr: 'رنا' },
  tab: {
    insuranceNo: '12345678',
    occupationCode: '194200',
    insuranceStartDate: '2026-02-01',
    insuranceBasicWage: null,
    insuranceComprehensiveWage: null,
    socialInsured: true,
    ...over.tab,
  },
  nationalId: '•••• 1234',
  employment: {
    id: 'employment-1',
    employmentType: 'full_time',
    standing: 'active',
    joinDate: '2026-02-01',
    leftOn: null,
    endingRecorded: false,
    department: { nameEn: 'Field', parent: { nameEn: 'Sales' } },
    ...over.employment,
  },
  contractPay: over.contractPay === undefined ? 12000 : over.contractPay,
  file: over.file === undefined ? { form1: ['printed'], form6: [], printReceivedOn: '2026-03-04' } : over.file,
});

describe('the Social Insurance report', () => {
  describe('who is on it', () => {
    it('the register and the contributions: registered, in an employment under the labour law', () => {
      expect(siInsured('full_time', true)).toBe(true);
      expect(siInsured('part_time', true)).toBe(true);
      expect(siInsured('full_time', false)).toBe(false);
      // freelancers and unpaid interns aren't insured, whatever the switch says
      expect(siInsured('freelance', true)).toBe(false);
      expect(siInsured('intern', true)).toBe(false);
    });

    it('the checklist: every full-time employee, registered or not, and the registered part-timers', () => {
      expect(siChecked('full_time', false)).toBe(true);
      expect(siChecked('part_time', true)).toBe(true);
      expect(siChecked('part_time', false)).toBe(false);
      expect(siChecked('freelance', true)).toBe(false);
    });

    it('the register’s status: current employees unless asked, one standing, the leavers, or everyone', () => {
      expect(siStatusMatches('current', 'active')).toBe(true);
      expect(siStatusMatches('current', 'notice_period')).toBe(true);
      expect(siStatusMatches('current', 'former')).toBe(false);
      expect(siStatusMatches('probation', 'probation')).toBe(true);
      expect(siStatusMatches('probation', 'active')).toBe(false);
      expect(siStatusMatches('former', 'former')).toBe(true);
      expect(siStatusMatches('all', 'former')).toBe(true);
    });
  });

  describe('the shares', () => {
    it('as payroll works them out: 11% and 18.75% of the insured wage in 2026, to the piaster', () => {
      expect(siShares(12000, LAW)).toEqual({ employeeInsurance: 1320, employerInsurance: 2250 });
      expect(siShares(2700.55, LAW)).toEqual({ employeeInsurance: 297.06, employerInsurance: 506.35 });
      expect(siPercent(LAW.employeeInsuranceRate)).toBe('11%');
      expect(siPercent(LAW.employerInsuranceRate)).toBe('18.75%');
      expect(siRatesOf(LAW)).toEqual({ year: 2026, employeeInsuranceRate: 0.11, employerInsuranceRate: 0.1875, insurableWageMin: 2700, insurableWageMax: 16700 });
    });
  });

  describe('Forms 1 and 6 and the print', () => {
    it('a form: the furthest along of its documents (one generated again keeps the one verified)', () => {
      expect(siFurthest([])).toBeNull();
      expect(siFurthest(['generated', 'verified', 'printed'])).toBe('verified');
      expect(siForm1State('full_time', [])).toBe('not_generated');
      expect(siForm1State('full_time', ['signed', 'generated'])).toBe('signed');
      // Forms 1 and 6 are for full-time employments
      expect(siForm1State('part_time', ['generated'])).toBe('not_applicable');
    });

    it('Form 6: not due before the employment has an ending, then not generated until it is', () => {
      expect(siForm6State('full_time', false, [])).toBe('not_due');
      expect(siForm6State('full_time', true, [])).toBe('not_generated');
      expect(siForm6State('full_time', true, ['generated'])).toBe('generated');
      expect(siForm6State('part_time', true, [])).toBe('not_applicable');
    });

    it('the print: received, or not received when the full-time file needs it', () => {
      expect(siPrintState('full_time', '2026-03-04')).toBe('received');
      expect(siPrintState('full_time', null)).toBe('not_received');
      expect(siPrintState('part_time', null)).toBe('not_needed');
    });
  });

  describe('a register row', () => {
    it('the contract’s gross and allowances when the tab has no comprehensive wage, within the limits; the default basic wage', () => {
      const row = siRegisterRow(source(), LAW, 410);
      expect(row).toMatchObject({
        insuranceNo: '12345678',
        nationalId: '•••• 1234',
        occupationCode: '194200',
        insuranceStartDate: '2026-02-01',
        insuranceBasicWage: 410,
        basicFrom: 'default',
        insuranceComprehensiveWage: 12000,
        comprehensiveFrom: 'contract',
        insuredWage: 12000,
        employeeInsurance: 1320,
        employerInsurance: 2250,
        form1: 'printed',
        form6: 'not_due',
        print: 'received',
        printReceivedOn: '2026-03-04',
      });
      expect(row.occupationName).toBe('اخصائي موارد بشريه');
    });

    it('the employee’s own wages first; the comprehensive wage capped at the year’s maximum, raised to its minimum', () => {
      const capped = siRegisterRow(source({ tab: { insuranceBasicWage: 5000, insuranceComprehensiveWage: 20000 } }), LAW, 410);
      expect(capped).toMatchObject({ insuranceBasicWage: 5000, basicFrom: 'own', insuranceComprehensiveWage: 20000, comprehensiveFrom: 'own', insuredWage: 16700 });
      expect(capped.employeeInsurance).toBe(1837);
      expect(siRegisterRow(source({ contractPay: 1500 }), LAW, 410).insuredWage).toBe(2700);
    });

    it('without a comprehensive wage or a signed contract: no insured wage and no shares', () => {
      expect(siRegisterRow(source({ contractPay: null }), LAW, 410)).toMatchObject({ insuranceComprehensiveWage: null, comprehensiveFrom: null, insuredWage: null, employeeInsurance: null, employerInsurance: null });
    });

    it('without the employee file (Finance): no forms and no print', () => {
      expect(siRegisterRow(source({ file: null }), LAW, 410)).toMatchObject({ form1: null, form6: null, print: null, printReceivedOn: null });
    });

    it('a leaver: Form 6 due', () => {
      expect(siRegisterRow(source({ employment: { standing: 'former', leftOn: '2026-09-30', endingRecorded: true } }), LAW, 410)).toMatchObject({ form6: 'not_generated', leftOn: '2026-09-30' });
    });
  });

  describe('the month', () => {
    it('the whole month’s shares, joiners and leavers marked', () => {
      const joiner = siMonthRow(source({ employment: { joinDate: '2026-10-12' } }), LAW);
      expect(joiner).toMatchObject({ insuredWage: 12000, employeeInsurance: 1320, employerInsurance: 2250 });
      expect(siMonthMarks(joiner, '2026-10')).toEqual({ joined: true, left: false });
      expect(siMonthMarks({ joinDate: '2026-02-01', leftOn: '2026-10-20' }, '2026-10')).toEqual({ joined: false, left: true });
      expect(siMonthMarks({ joinDate: '2026-02-01', leftOn: '2026-11-20' }, '2026-10')).toEqual({ joined: false, left: false });
      // a developer gets the dates as null: no marks
      expect(siMonthMarks({ joinDate: null, leftOn: null }, '2026-10')).toEqual({ joined: false, left: false });
      expect(siMarksText({ joined: true, left: true })).toBe('Joined and left');
      expect(siMarksText({ joined: false, left: true })).toBe('Left');
      expect(siMarksText({ joined: false, left: false })).toBeNull();
    });

    it('the totals: added in piasters, both shares what is paid to the office, those without a wage counted apart', () => {
      const rows = [
        siMonthRow(source({ employment: { joinDate: '2026-10-12' } }), LAW),
        siMonthRow(source({ tab: { insuranceComprehensiveWage: 2700.55 }, employment: { leftOn: '2026-10-20' } }), LAW),
        siMonthRow(source({ contractPay: null }), LAW),
      ];
      expect(siMonthTotals(rows, '2026-10')).toEqual({
        people: 3,
        insured: 2,
        insuredWage: 14700.55,
        employeeInsurance: 1617.06,
        employerInsurance: 2756.35,
        toPay: 4373.41,
        joined: 1,
        left: 1,
      });
      expect(siTotals([])).toEqual({ people: 0, insured: 0, insuredWage: 0, employeeInsurance: 0, employerInsurance: 0, toPay: 0 });
    });
  });

  describe('the missing data', () => {
    it('in the checklist’s order, each item only where it applies', () => {
      const all = source({ tab: { socialInsured: false, insuranceNo: null, occupationCode: null, insuranceStartDate: null }, file: { form1: [], form6: [], printReceivedOn: null } });
      expect(siMissingItems(all)).toEqual(['not_registered', 'insurance_no', 'occupation', 'start_date', 'form_1', 'print']);
      expect(siMissingItems(source())).toEqual([]);
      // a registered part-timer: no forms or print to miss, nor registration
      expect(siMissingItems(source({ tab: { insuranceNo: null }, employment: { employmentType: 'part_time' }, file: { form1: [], form6: [], printReceivedOn: null } }))).toEqual(['insurance_no']);
      // a form generated but not yet printed counts as generated
      expect(siMissingItems(source({ file: { form1: ['generated'], form6: [], printReceivedOn: null } }))).toEqual(['print']);
    });

    it('counts each item', () => {
      const rows = [siMissingRow(source({ tab: { insuranceNo: null } })), siMissingRow(source({ tab: { insuranceNo: null, occupationCode: null } }))];
      expect(siMissingCounts(rows)).toEqual({ not_registered: 0, insurance_no: 2, occupation: 1, start_date: 0, form_1: 0, print: 0 });
    });
  });

  describe('the order', () => {
    it('by department (none last), the department’s own people before its teams, then name', () => {
      const of = (name: string, department: SiSource['employment']['department']) => ({ employee: { id: name, employeeCode: name, fullNameEn: name, fullNameAr: name }, department });
      const rows = [
        of('Zed', null),
        of('Amr', { nameEn: 'Field', parent: { nameEn: 'Sales' } }),
        of('Basma', { nameEn: 'Sales', parent: null }),
        of('Carol', { nameEn: 'Finance', parent: null }),
        of('Adel', { nameEn: 'Field', parent: { nameEn: 'Sales' } }),
      ];
      expect([...rows].sort(siOrder).map((r) => r.employee.fullNameEn)).toEqual(['Carol', 'Basma', 'Adel', 'Amr', 'Zed']);
      expect(siPlaceParts({ nameEn: 'Field', parent: { nameEn: 'Sales' } })).toEqual({ department: 'Sales', team: 'Field' });
      expect(siPlaceParts(null)).toEqual({ department: null, team: null });
    });
  });
});
