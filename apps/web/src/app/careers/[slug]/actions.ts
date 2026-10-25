'use server';

// Applying for a job on the careers page (owner, 22 October 2026: "where will we include the ATS?"): the form checked as
// the rules say (the API checks every rule again, the CV's too), then sent to the API's public address with the channel
// it came by, the applicant's IP address (signed with WEB_KEY) and browser (the limit of applications an hour). Answers
// the reference. Since 25 October 2026 (owner: "for creatives, they need to add their portfolios"): the portfolio checked
// as the vacancy asks, its links and PDF passed on, and LinkedIn's ticket (the email's "Confirmed by LinkedIn").
import { headers } from 'next/headers';
import { careersIpToken, type PublicVacancyView } from '@trendlix/shared';
import { messagesOf } from '@/lib/api';
import { clientIp } from '@/lib/client-ip';
import { publicFetch, publicGet } from '@/lib/public-api';
import { signedIpHeaders } from '@/lib/signed-ip';
import { apiForm, applyFormProblems, typedValues } from '../careers';

export interface ApplyState {
  errors?: string[];
  values?: Record<string, string>;
  /** Sent: the application's reference. */
  reference?: string;
}

const NOT_OPEN = 'This job is no longer open.';

export async function applyForJob(slug: string, source: string | null, _prev: ApplyState, fd: FormData): Promise<ApplyState> {
  const job = await publicGet<PublicVacancyView>(`/careers/${encodeURIComponent(slug)}`);
  if (!job.ok) return { errors: [job.status === 404 ? NOT_OPEN : 'Your application could not be sent. Please try again in a few minutes.'] };
  const questions = job.data.questions;
  const values = typedValues(fd, questions);
  const problems = applyFormProblems(fd, questions, job.data.portfolio);
  if (problems.length) return { errors: problems, values };
  const h = await headers();
  const ua = h.get('user-agent')?.trim().slice(0, 500);
  const ip = clientIp(h);
  const body = apiForm(fd, questions, { source, ip, userAgent: ua || undefined });
  // the address signed with WEB_KEY for this job, so the API trusts it for the hourly limit (22 October 2026)
  const signed = signedIpHeaders(process.env.WEB_KEY, careersIpToken(slug), ip);
  let res: Response;
  try {
    res = await publicFetch(`/careers/${encodeURIComponent(slug)}/apply`, { method: 'POST', body, headers: signed });
  } catch {
    return { errors: ['Cannot reach the server. Please try again in a moment.'], values };
  }
  if (!res.ok) return { errors: (await messagesOf(res)).filter((m) => !/^Cannot POST /.test(m)), values };
  const said = (await res.json().catch(() => null)) as { reference?: string } | null;
  return { reference: said?.reference ?? '' };
}
