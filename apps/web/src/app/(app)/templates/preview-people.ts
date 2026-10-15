// Previewing a template version with a real employee's data (owner's request, 15 October 2026: "When previewing a
// template, fetch any demo data already uploaded"): where the browser opens the filled version, where the people to
// choose from are read, and how each is offered. Pure code (no server-only), tested.

/** Someone to preview a version with (GET /templates/versions/:id/preview-people), best first. */
export interface PreviewPerson {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  employmentType: string | null;
  /** How many of the tags the version prints have a value for them, of `total`. */
  filled: number;
  total: number;
}

export const PREVIEW_HINT = "Filled with a real employee's data, nothing saved. Missing values show as [Field].";

const versionPath = (versionId: string) => `/templates/versions/${encodeURIComponent(versionId)}`;

/**
 * Where the browser opens a version filled in with someone's data (the best person to preview it with when no one is
 * chosen): a PDF shown in a new tab, or the Word file. The web server fetches it from the API with the session.
 */
export function dataPreviewHref(versionId: string, employeeId?: string | null, format: 'pdf' | 'docx' = 'pdf'): string {
  const query = new URLSearchParams();
  if (employeeId) query.set('employeeId', employeeId);
  if (format === 'docx') query.set('format', 'docx');
  const q = query.toString();
  return `${versionPath(versionId)}/preview${q ? `?${q}` : ''}`;
}

/** Where the template page reads the people to preview a version with, when asked. */
export const previewPeopleHref = (versionId: string) => `${versionPath(versionId)}/preview-people`;

/** "Omar Khaled · EMP-0001 · 18 of 20 filled"; without the count for a version that prints no tags. */
export function personOption(p: Pick<PreviewPerson, 'fullNameEn' | 'employeeCode' | 'filled' | 'total'>): string {
  const parts = [p.fullNameEn, p.employeeCode];
  if (p.total > 0) parts.push(`${p.filled} of ${p.total} filled`);
  return parts.join(' · ');
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** The people in the API's answer, in its order; anything that isn't one is left out. */
export function readPeople(body: unknown): PreviewPerson[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((x: unknown): PreviewPerson[] => {
    if (!x || typeof x !== 'object') return [];
    const p = x as Record<string, unknown>;
    if (typeof p.id !== 'string' || !p.id || typeof p.employeeCode !== 'string' || typeof p.fullNameEn !== 'string') return [];
    if (!isCount(p.filled) || !isCount(p.total)) return [];
    const employmentType = typeof p.employmentType === 'string' ? p.employmentType : null;
    return [{ id: p.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn, employmentType, filled: p.filled, total: p.total }];
  });
}
