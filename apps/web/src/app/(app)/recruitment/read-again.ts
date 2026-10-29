import type { CvReadingView } from '@trendlix/shared';

// Read a CV again on the site (owner, 29 October 2026: "what can we do if the OCR missed pulling data? can i perform a
// rerun for example?"): HR's two buttons on the From the CV card, Read again (as before: its own text, else the OCR
// service) and Read as a scan (the OCR service whatever its own text: a designed PDF whose text comes out jumbled; a PDF
// only), each asked first; and the line when one failed or found nothing (the earlier reading kept). Pure code, tested
// in read-again.test.ts; the API checks every rule again.

export interface ReadAgainChoice {
  asScan: boolean;
  label: string;
  pendingLabel: string;
  confirm: string;
}

/** The API's address for reading a CV again. */
export const readAgainApiPath = (subject: { applicationId: string } | { generalCvId: string }): string =>
  'applicationId' in subject
    ? `/recruitment/applications/${encodeURIComponent(subject.applicationId)}/read-again`
    : `/recruitment/general-cvs/${encodeURIComponent(subject.generalCvId)}/read-again`;

/** HR's choices for a CV: none while it is being read; Read as a scan not for a Word file (read from its own text). */
export function readAgainChoices(r: Pick<CvReadingView, 'status' | 'method'>): ReadAgainChoice[] {
  if (r.status === 'pending') return [];
  const choices: ReadAgainChoice[] = [
    {
      asScan: false,
      label: 'Read again',
      pendingLabel: 'Asking…',
      confirm: 'Read this CV again? What it found is worked out again, and the CV match with it. If it fails, what was read before stays.',
    },
  ];
  if (r.method !== 'docx')
    choices.push({
      asScan: true,
      label: 'Read as a scan (OCR)',
      pendingLabel: 'Asking…',
      confirm: 'Read this CV as a scan, by the OCR service, even though it has text of its own? For a designed PDF whose text came out jumbled. If it fails, what was read before stays.',
    });
  return choices;
}

/** The line under the reading when Read again failed or found nothing: why, and that the earlier reading is shown. */
export const rereadProblemText = (problem: string | null | undefined): string | null =>
  problem ? `Reading it again didn’t work (${problem.replace(/\.$/, '')}), so what was read before is shown.` : null;
