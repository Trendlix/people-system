import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CV_PREFILL_IP_TOKEN, CV_PREFILL_LIMITS, cvPrefillOf, NO_PREFILL, type CvPrefillResult } from '@trendlix/shared';
import { verifySignedIp } from '../attendance/signed-ip.js';
import { cvProblem, cvTypeOf } from './cv-file.js';
import { cvText } from './cv-text.js';
import { HourlyWindow } from './hourly-window.js';
import type { ApplyOrigin } from './public-careers.service.js';

// The careers forms filled in from the CV (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to
// complete the data?"; asked, "Fill the form from the CV" among the three; packages/shared cv-contacts.ts): the CV the
// person chose first is sent here on its own, through the website like an application (the address it signs with
// WEB_KEY counts, about 20 an hour from one address and 600 in all), read the way a CV's reading reads it (a PDF's own
// text, a Word file's paragraphs: no OCR here, too slow) within 10 seconds, and what the rules find in its text answered:
// the name (only when confident), the email, the mobile as the system keeps it, the LinkedIn link, the portfolio links
// by platform and the years. Nothing is ever kept: not the file, not its text, not what was found; the form fills only
// its empty fields, and the usual reading round still runs on the CV once it is sent.

/** How much of the CV is read: as a CV's reading (5 pages, 60,000 characters). */
const READ = { pages: 5, chars: 60_000 };

/** The address a prefill counts against: one the website signed for the prefill, else (no key on the server) the one named. */
// signed with CAREERS_KEY, as the applications' and general CVs' are, since the careers pages moved to www.trendlix.com
// (d937f18, db0638a; 25 October 2026): with WEB_KEY every visitor counted as the website's own address
export function prefillIp(named: string | null, origin: ApplyOrigin, key: string | undefined = process.env.CAREERS_KEY, now: number = Date.now()): string | null {
  const signed = verifySignedIp(origin.headers ?? {}, CV_PREFILL_IP_TOKEN, key, now);
  if (signed.ip) return signed.ip;
  return signed.problem === 'no_server_key' ? (named ?? origin.ip) : origin.ip;
}

/** The text, or '' when it takes longer than the limit (the reading goes on unheard; nothing waits for it). */
async function textWithin(data: Buffer, type: Parameters<typeof cvText>[1], ms: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), ms);
  });
  try {
    return await Promise.race([cvText(data, type, READ), late]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class CvPrefillService {
  private readonly window = new HourlyWindow(CV_PREFILL_LIMITS.perHour, CV_PREFILL_LIMITS.perHourAll);

  /**
   * POST /public/cv-prefill (a multipart form with the CV as `cv`). Refused: too many from the address this hour, or in
   * all (429); no file, not a PDF or a Word file, over 5 MB (400; 413 while it arrives). A file with no text (a scan),
   * or one that can't be read in time: `read` false, nothing found.
   */
  async prefill(file: Express.Multer.File | undefined, named: string | null, origin: ApplyOrigin): Promise<CvPrefillResult> {
    if (!this.window.allow(prefillIp(named, origin))) {
      throw new HttpException('Several CVs were read from your connection in the last hour: please fill in the form yourself.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const problem = cvProblem(file);
    if (problem) throw new BadRequestException([problem]);
    const text = await textWithin(file!.buffer, cvTypeOf(file!.buffer)!, CV_PREFILL_LIMITS.seconds * 1000);
    if (!text.trim()) return { read: false, ...NO_PREFILL, portfolioLinks: [] };
    return { read: true, ...cvPrefillOf(text) };
  }
}
