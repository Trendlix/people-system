import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar, initials, photoHref } from './avatar';

// The picture beside a name: the person's initials, the photo over them when there is one. For a developer (owner, 22
// October 2026: "make all real employees data encrypted for developer role") the API sends no photo (photoId null) and
// refuses the photo itself, and the name is a pseudonym: the circle shows the pseudonym's initials, and nothing is
// loaded.

describe('the avatar', () => {
  it('shows the initials of the first and last names', () => {
    expect(initials('Omar Khaled Mahmoud')).toBe('OM');
    expect(initials('  sara  ')).toBe('S');
    expect(initials('')).toBe('?');
  });

  it('a developer’s pseudonym: its initials, and no photo asked for', () => {
    const html = renderToStaticMarkup(createElement(Avatar, { name: 'Employee EMP-0182', photoId: null }));
    expect(html).toContain('EE');
    expect(html).not.toContain('<img');
  });

  it('with a photo: the photo over the initials, from the employee-photo route', () => {
    const html = renderToStaticMarkup(createElement(Avatar, { name: 'Omar Khaled', photoId: '5e5e5e5e-1111-4222-8333-444455556666' }));
    expect(html).toContain('OK');
    expect(html).toContain(`src="${photoHref('5e5e5e5e-1111-4222-8333-444455556666')}"`);
  });
});
