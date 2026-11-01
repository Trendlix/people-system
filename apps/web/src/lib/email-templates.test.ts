import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { changed, editsEmailTemplates, EMAIL_TEMPLATES_PATH, insertField, paragraphsOf, seesEmailTemplates, wordsOf } from './email-templates';

// Organization → Email Templates (owner, 1 November 2026: "build the mail templetes"): who sees and changes it, and the
// editor's small steps.

const as = (...roles: Role[]) => ({ roles });
const start = { subject: 'Your code', body: 'Hello {{name}}' };

describe('who sees and changes the email templates', () => {
  it('lives under Organization', () => {
    expect(EMAIL_TEMPLATES_PATH).toBe('/organization/email-templates');
  });

  it('is seen by HR, the CEO and a Super Admin, and changed by HR and a Super Admin', () => {
    expect([as('hr'), as('ceo'), as('super_admin')].map(seesEmailTemplates)).toEqual([true, true, true]);
    expect([as('employee'), as('manager'), as('finance'), as('admin')].map(seesEmailTemplates)).toEqual([false, false, false, false]);
    expect([as('hr'), as('super_admin'), as('ceo'), as('finance')].map(editsEmailTemplates)).toEqual([true, true, false, false]);
  });
});

describe('the editor', () => {
  it('goes with HR’s words when saved, else the standard ones', () => {
    expect(wordsOf({ start, custom: null })).toEqual(start);
    expect(wordsOf({ start, custom: { subject: 'Code', body: '{{code}}', updatedAt: '2026-11-01T10:00:00Z', updatedBy: null } })).toEqual({ subject: 'Code', body: '{{code}}' });
  });

  it('counts the words as changed only when they differ beyond spaces at their ends', () => {
    expect(changed({ start, custom: null }, { subject: ' Your code ', body: 'Hello {{name}}\r\n' })).toBe(false);
    expect(changed({ start, custom: null }, { subject: 'Your code', body: 'Hi {{name}}' })).toBe(true);
  });

  it('puts a field where the cursor is, over what is selected, or at the end', () => {
    expect(insertField('Hello ,', 'name', 6, 6)).toEqual({ text: 'Hello {{name}},', cursor: 14 });
    expect(insertField('Hello you', 'name', 6, 9)).toEqual({ text: 'Hello {{name}}', cursor: 14 });
    expect(insertField('Code: ', 'code', null, null)).toEqual({ text: 'Code: {{code}}', cursor: 14 });
  });

  it('shows the preview as paragraphs split at empty lines, each with its lines', () => {
    expect(paragraphsOf('One\nTwo\n\n\nThree\n')).toEqual([['One', 'Two'], ['Three']]);
  });
});
