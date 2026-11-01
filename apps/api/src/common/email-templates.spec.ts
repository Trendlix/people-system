import {
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATES,
  emailTemplateKinds,
  emailTemplateProblems,
  emailTextHtml,
  fieldsIn,
  fillTemplate,
  loginCodeMail,
  loginCodeShown,
  LOGIN_CODE_MINUTES,
  renderEmailTemplate,
  sampleValues,
} from '@trendlix/shared';
import { describe, expect, it } from 'vitest';

// Organization → Email Templates (owner, 1 November 2026: "build the mail templetes"): the emails HR may word, their
// fields, the checks before a save, and how a template is filled when the email goes.

describe('the emails HR may word', () => {
  it('lists each email once, in the page’s order, each with a name, when it goes and its standard words', () => {
    expect(emailTemplateKinds().map((k) => k.key)).toEqual([...EMAIL_TEMPLATE_KEYS]);
    for (const k of emailTemplateKinds()) {
      expect(k.label).toMatch(/^[A-Z]/);
      expect(k.when).toMatch(/\.$/);
      expect(k.start.subject.trim()).toBe(k.start.subject);
      expect(new Set(k.fields.map((f) => f.key)).size).toBe(k.fields.length);
    }
  });

  it('starts every email from words that pass its own checks: only its fields, the ones it needs in its text', () => {
    for (const k of emailTemplateKinds()) {
      expect(emailTemplateProblems(k.key, k.start), k.key).toEqual([]);
      const known = k.fields.map((f) => f.key);
      for (const r of k.required) expect(known, `${k.key} needs ${r}`).toContain(r);
    }
  });

  it('needs the code in a sign-in code, and the link in an invitation, a password reset and a job offer', () => {
    expect(EMAIL_TEMPLATES.sign_in_code.required).toEqual(['code']);
    for (const key of ['account_invite', 'password_reset', 'job_offer'] as const) expect(EMAIL_TEMPLATES[key].required).toContain('link');
  });

  it('fills the standard sign-in code exactly as the system’s own email, with a name and without one', () => {
    for (const name of ['Mona Ali', null]) {
      const own = loginCodeMail('482913', name);
      const filled = renderEmailTemplate(EMAIL_TEMPLATES.sign_in_code.start, { name: name ?? '', code: loginCodeShown('482913'), minutes: String(LOGIN_CODE_MINUTES) });
      expect(filled.subject).toBe(own.subject);
      expect(filled.text).toBe(own.text);
    }
  });
});

describe('the checks before a save', () => {
  const words = { subject: 'Your code', body: 'Hello {{name}}, your code is {{code}}.' };

  it('passes words with the email’s fields', () => {
    expect(emailTemplateProblems('sign_in_code', words)).toEqual([]);
  });

  it('asks for a subject, on one line, and a text', () => {
    expect(emailTemplateProblems('sign_in_code', { ...words, subject: '  ' })).toEqual(['Write the subject.']);
    expect(emailTemplateProblems('sign_in_code', { ...words, subject: 'Your\ncode' })).toEqual(['Write the subject on one line.']);
    expect(emailTemplateProblems('sign_in_code', { ...words, body: '' })).toEqual(['Write the email’s text.', 'The text needs {{code}}: the email is no use without it.']);
  });

  it('keeps the subject and the text within their limits', () => {
    expect(emailTemplateProblems('sign_in_code', { ...words, subject: 'x'.repeat(201) })).toEqual(['Keep the subject to 200 characters.']);
    expect(emailTemplateProblems('sign_in_code', { ...words, body: `{{code}} ${'x'.repeat(10_000)}` })).toEqual(['Keep the text to 10,000 characters.']);
  });

  it('names a field the email doesn’t have, and the fields it has', () => {
    expect(emailTemplateProblems('sign_in_code', { ...words, body: 'Hi {{first_name}}: {{code}}' })).toEqual([
      '{{first_name}} isn’t one of this email’s fields: use {{name}}, {{code}}, {{minutes}}.',
    ]);
    expect(emailTemplateProblems('cv_received', { subject: 'Hi {{job}}', body: '{{link}}' })[0]).toMatch(/^\{\{job\}\}, \{\{link\}\} aren’t this email’s fields/);
  });

  it('refuses a text without the field the email is no use without, even when the subject has it', () => {
    expect(emailTemplateProblems('sign_in_code', { subject: 'Code {{code}}', body: 'Hello {{name}}' })).toEqual(['The text needs {{code}}: the email is no use without it.']);
    expect(emailTemplateProblems('job_offer', { subject: 'Your offer', body: 'Dear {{name}}' })).toEqual(['The text needs {{link}}: the email is no use without it.']);
  });

  it('reads a field written with spaces inside its braces', () => {
    expect(fieldsIn('Hello {{ name }} and {{code}} and {{name}}')).toEqual(['name', 'code']);
    expect(emailTemplateProblems('sign_in_code', { subject: 'Code', body: 'Use {{ code }}' })).toEqual([]);
  });
});

describe('a template filled when the email goes', () => {
  it('puts each value in its field and leaves a field it doesn’t know as written', () => {
    expect(fillTemplate('Hello {{name}}, {{other}}', { name: 'Mona' })).toBe('Hello Mona, {{other}}');
  });

  it('tidies what an empty value leaves: a space before a comma (Arabic too), more than one empty line', () => {
    expect(fillTemplate('Hello {{name}},\n\n\n\nBye', { name: '' })).toBe('Hello,\n\nBye');
    expect(fillTemplate('مرحبًا {{name}}،', { name: null })).toBe('مرحبًا،');
    expect(fillTemplate('{{note}}\n\nThanks', { note: '' })).toBe('Thanks');
    expect(fillTemplate('Hi {{name}}! Ready {{name}}? مرحبًا {{name}}؟', { name: '' })).toBe('Hi! Ready? مرحبًا؟');
  });

  it('keeps the subject on one line, whatever a value holds', () => {
    expect(renderEmailTemplate({ subject: 'About {{job}}', body: '{{job}}' }, { job: 'Graphic\nDesigner' }).subject).toBe('About Graphic Designer');
  });

  it('makes the HTML a paragraph per block, each in its own direction, with links and nothing of a value run as HTML', () => {
    expect(emailTextHtml('Hi <b>Mona</b>\nSee https://people.trendlix.com/login.\n\nمرحبًا')).toBe(
      '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">' +
        '<p dir="auto">Hi &lt;b&gt;Mona&lt;/b&gt;<br>See <a href="https://people.trendlix.com/login">https://people.trendlix.com/login</a>.</p>' +
        '<p dir="auto">مرحبًا</p></div>',
    );
  });

  it('has a sample for every field, for the preview and the test', () => {
    for (const k of emailTemplateKinds()) {
      const filled = renderEmailTemplate(k.start, sampleValues(k.key));
      expect(fieldsIn(`${filled.subject}\n${filled.text}`), k.key).toEqual([]);
    }
  });
});
