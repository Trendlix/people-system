'use server';

// "Send us your CV" on the careers page (owner, 22 October 2026: "what came out of the posted jobs and what cam on
// randomly", "Both"): the form checked as the rules say (the API checks every rule again, the CV's too), then sent to the
// API's public address with the person's IP address (signed with WEB_KEY for the general form) and browser. Answers the
// reference. Since 25 October 2026 (owner: "for creatives, they need to add their portfolios"): the portfolio checked as
// the chosen position asks (the form's asks read again: the API checks them anyway), its links and PDF passed on, and
// LinkedIn's ticket (the email's "Confirmed by LinkedIn").
import { headers } from 'next/headers';
import { GENERAL_CV_IP_TOKEN, type PublicGeneralForm } from '@trendlix/shared';
import { messagesOf } from '@/lib/api';
import { clientIp } from '@/lib/client-ip';
import { publicFetch, publicGet } from '@/lib/public-api';
import { signedIpHeaders } from '@/lib/signed-ip';
import { generalApiForm, generalFormProblems, generalTypedValues } from '../careers';

export interface GeneralState {
  errors?: string[];
  values?: Record<string, string>;
  /** Sent: the CV's reference. */
  reference?: string;
}

export async function sendGeneralCv(_prev: GeneralState, fd: FormData): Promise<GeneralState> {
  const values = generalTypedValues(fd);
  const form = await publicGet<PublicGeneralForm>('/general-cvs/form');
  const problems = generalFormProblems(fd, form.ok ? form.data : null);
  if (problems.length) return { errors: problems, values };
  const h = await headers();
  const ua = h.get('user-agent')?.trim().slice(0, 500);
  const ip = clientIp(h);
  const body = generalApiForm(fd, { ip, userAgent: ua || undefined });
  const signed = signedIpHeaders(process.env.WEB_KEY, GENERAL_CV_IP_TOKEN, ip);
  let res: Response;
  try {
    res = await publicFetch('/general-cvs', { method: 'POST', body, headers: signed });
  } catch {
    return { errors: ['Cannot reach the server. Please try again in a moment.'], values };
  }
  if (!res.ok) return { errors: (await messagesOf(res)).filter((m) => !/^Cannot POST /.test(m)), values };
  const said = (await res.json().catch(() => null)) as { reference?: string } | null;
  return { reference: said?.reference ?? '' };
}
