// The pages of a document as the API gives them to be adjusted.
import { describe, expect, it } from 'vitest';
import { PAGES_MAX, pagesFrom } from './paperwork-pages';

describe('the pages the API gives', () => {
  it('takes each page: its picture in base64 and its size', () => {
    expect(pagesFrom({ pages: [{ image: '/9j/4AAQSkZJRg==', width: 1240, height: 1754 }] })).toEqual([{ image: '/9j/4AAQSkZJRg==', width: 1240, height: 1754 }]);
    // a data address: its base64 only
    expect(pagesFrom({ pages: [{ image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 10, height: 20 }] })?.[0].image).toBe('/9j/4AAQSkZJRg==');
    // a size it does not give is found when the picture is opened
    expect(pagesFrom({ pages: [{ image: '/9j/4AAQSkZJRg==' }] })?.[0]).toMatchObject({ width: 0, height: 0 });
  });

  it('nothing from an answer without pages, or with a page that is not a picture', () => {
    expect(pagesFrom(undefined)).toBeNull();
    expect(pagesFrom(null)).toBeNull();
    expect(pagesFrom({})).toBeNull();
    expect(pagesFrom({ pages: [] })).toBeNull();
    expect(pagesFrom({ pages: [{ image: 42 }] })).toBeNull();
    expect(pagesFrom({ pages: [{ image: '<html>not a picture</html>' }] })).toBeNull();
    expect(pagesFrom({ pages: [null] })).toBeNull();
  });

  it('at most PAGES_MAX pages', () => {
    const many = Array.from({ length: PAGES_MAX + 5 }, () => ({ image: '/9j/4AAQSkZJRg==', width: 1, height: 1 }));
    expect(pagesFrom({ pages: many })).toHaveLength(PAGES_MAX);
  });
});
