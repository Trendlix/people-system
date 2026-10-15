// The pages of a document as the API gives them to be adjusted (POST /paperwork/prepare): each a JPEG picture in
// base64, with its size in pixels. Shared by the server actions (employees/adjust-actions.ts) and the document adjuster
// (components/adjust). Pure: tested in paperwork-pages.test.ts.

/** A page of a document, as POST /paperwork/prepare gives it: a JPEG picture in base64 and its size in pixels. */
export interface PreparedPage {
  image: string;
  width: number;
  height: number;
}

/** What preparing a document gives the adjuster: its pages, or why it could not be done. */
export interface PagesState {
  pages?: PreparedPage[];
  errors?: string[];
}

/** The most pages taken from the API's answer (it sends about 20 at most). */
export const PAGES_MAX = 40;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The pages in what the API answered, or null when it holds none that can be shown. */
export function pagesFrom(body: unknown): PreparedPage[] | null {
  const list = (body as { pages?: unknown } | null | undefined)?.pages;
  if (!Array.isArray(list) || !list.length) return null;
  const pages: PreparedPage[] = [];
  for (const p of list.slice(0, PAGES_MAX)) {
    const { image, width, height } = (p ?? {}) as Record<string, unknown>;
    if (typeof image !== 'string' || image.length < 8) return null;
    // a data address is taken too: only its base64 is kept
    const data = image.replace(/^data:image\/[a-z]+;base64,/i, '');
    if (!BASE64.test(data.slice(0, 64))) return null;
    pages.push({ image: data, width: Number(width) || 0, height: Number(height) || 0 });
  }
  return pages;
}
