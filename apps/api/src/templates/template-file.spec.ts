import { formatOf, templateFileName } from './template-file.js';

// A template's file name ends as the file is: .docx, or .pdf for a PDF form (owner's decision, 15 October 2026).

describe('templateFileName', () => {
  it('ends a Word template’s name in .docx, replacing Word’s other extensions', () => {
    expect(templateFileName('عقد العمل.docx')).toBe('عقد العمل.docx');
    expect(templateFileName('Contract.doc')).toBe('Contract.docx');
    expect(templateFileName('letter')).toBe('letter.docx');
    expect(templateFileName(undefined)).toBe('template.docx');
  });

  it('ends a PDF form’s name in .pdf', () => {
    expect(templateFileName('نموذج 1.pdf', 'pdf')).toBe('نموذج 1.pdf');
    expect(templateFileName('Form 6', 'pdf')).toBe('Form 6.pdf');
    expect(templateFileName('Form 1.docx', 'pdf')).toBe('Form 1.pdf');
    expect(templateFileName('Form: 1.PDF', 'pdf')).toBe('Form_ 1.pdf');
    expect(templateFileName('Form 1.pdf')).toBe('Form 1.docx');
  });

  it('reads a kept format', () => {
    expect([formatOf('pdf'), formatOf('docx'), formatOf(null), formatOf('odt')]).toEqual(['pdf', 'docx', 'docx', 'docx']);
  });
});
