import { describe, expect, it } from 'vitest';
import { jdBlocks } from './jd-lines';

describe('a job description as typed', () => {
  it('keeps headings and plain lines as they are, and gathers the points under them', () => {
    expect(
      jdBlocks([
        'Employee Relations & Communication',
        '·  Act as the first point of contact for HR-related employee inquiries.',
        '• Handle employee concerns.',
        'Payroll & Compensation',
        'Prepare and process monthly payroll through Zoho.',
        '- Review attendance.',
      ]),
    ).toEqual([
      { kind: 'line', text: 'Employee Relations & Communication' },
      { kind: 'points', items: ['Act as the first point of contact for HR-related employee inquiries.', 'Handle employee concerns.'] },
      { kind: 'line', text: 'Payroll & Compensation' },
      { kind: 'line', text: 'Prepare and process monthly payroll through Zoho.' },
      { kind: 'points', items: ['Review attendance.'] },
    ]);
  });

  it('leaves out empty lines and lone bullets, and keeps a number typed at the start of a line', () => {
    expect(jdBlocks(['', '  ', '•', '1. Recruitment'])).toEqual([{ kind: 'line', text: '1. Recruitment' }]);
  });
});
