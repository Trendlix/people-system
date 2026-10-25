// The careers forms filled in from the CV (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to
// complete the data?"; told that LinkedIn's sign-in shares only a name, an email and a photo, they chose "Fill the form
// from the CV" too). The CV chosen first on the form is read on the spot (POST /public/cv-prefill: its text only, no
// OCR, never kept), and these rules find in its text what the form asks:
// - the full name, only when confident: one of the top lines that reads as a name (two to five words of letters, no
//   digits, no address, not a heading like "Curriculum Vitae", not a job title); on a LinkedIn profile saved as a PDF
//   (it starts with "Contact" and the profile's link), the line above its headline;
// - the email;
// - the mobile, as the system keeps phones (the country code and no extra zero, Egypt's +20 when none is written):
//   01012345678, +20 10 1234 5678, 0020 101 234 5678, the Arabic digits ٠١٠١٢٣٤٥٦٧٨ too; an Egyptian mobile first,
//   else the first international one written with its code;
// - the LinkedIn profile's link (linkedin.com/in/…);
// - the portfolio links, each with its platform (portfolio.ts), as their shapes check: a personal website only when the
//   line says so ("Portfolio:", "Website") or it is in the CV's top lines (its contacts), never a company's site in the
//   work history;
// - the years of experience, as the CV's reading works them out (cv-analysis.ts experienceMonths), rounded down.
// What it finds is a suggestion the person checks: the form fills only empty fields, marked "From your CV".
// Pure code, tested in apps/api/src/common/cv-contacts.spec.ts.

import { experienceMonths } from './cv-analysis.js';
// Arabic-Indic (٠-٩) and Persian (۰-۹) digits as 0-9
import { westernDigits } from './leave-import.js';
import { phoneOk, phoneTidy } from './phone.js';
import { checkPortfolioLink, PORTFOLIO_KINDS, type PortfolioLinkKind } from './portfolio.js';
import { isEmail, RECRUITMENT_LIMITS } from './recruitment.js';

/** What the CV gave the form (POST /public/cv-prefill), each null (or empty) when it wasn't found. */
export interface CvPrefill {
  fullName: string | null;
  email: string | null;
  mobile: string | null;
  linkedin: string | null;
  portfolioLinks: { url: string; kind: PortfolioLinkKind }[];
  yearsExperience: number | null;
}

/** POST /public/cv-prefill's answer: `read` false when the file had no text that could be read (the form says so). */
export interface CvPrefillResult extends CvPrefill {
  read: boolean;
}

export const NO_PREFILL: CvPrefill = { fullName: null, email: null, mobile: null, linkedin: null, portfolioLinks: [], yearsExperience: null };

/** The prefill's limits: a CV as the forms take it, about 20 an hour from one address, 10 seconds to read it. */
export const CV_PREFILL_LIMITS = {
  mb: RECRUITMENT_LIMITS.cvMb,
  perHour: 20,
  /** From every address together, an hour: a cap on a flood. */
  perHourAll: 600,
  seconds: 10,
  /** At most this many portfolio links are suggested. */
  links: 3,
} as const;

/** What the website's signature of the address is bound to for the prefill (as an application's is to its job). */
export const CV_PREFILL_IP_TOKEN = 'careers-prefill';

/** What the form says when the file couldn't be read (never a block: the form still sends). */
export const CV_PREFILL_FAILED = 'We couldn’t read this file: please fill in the form.';

// ---------- digits and lines ----------

const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

// ---------- emails ----------

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** The emails written in the text, in lower case, each once, in order. */
export function cvEmails(text: string): string[] {
  const out: string[] = [];
  for (const raw of westernDigits(text).match(EMAIL_IN_TEXT) ?? []) {
    const e = raw.toLowerCase().replace(/\.+$/, '');
    if (isEmail(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

// ---------- phones ----------

/** A run that could be a phone number: + or 00, digits with spaces, dots, dashes and brackets between. */
const PHONE_LIKE = /(?:\+|\b00)?\s?\(?\d[\d\s().\-‐‑–]{6,20}\d/g;

/** A phone as the system keeps it (+201012345678) when it is one: an Egyptian mobile, or one written with its code. */
export function cvPhoneOf(raw: string): { phone: string; egyptMobile: boolean } | null {
  // "(+20) 155 …": the bracket before the code is no part of it
  const t = westernDigits(raw).trim().replace(/^\(\s*/, '');
  const abroad = /^(?:\+|00)/.test(t);
  const d = t.replace(/\D/g, '');
  // 01012345678
  if (!abroad && /^01[0125]\d{8}$/.test(d)) return { phone: `+20${d.slice(1)}`, egyptMobile: true };
  if (abroad) {
    const n = t.startsWith('00') ? d.slice(2) : d;
    // +20 10 1234 5678, 0020 101 234 5678, +20 0101 234 5678 (the extra zero)
    const egypt = /^200?(1[0125]\d{8})$/.exec(n);
    if (egypt) return { phone: `+20${egypt[1]}`, egyptMobile: true };
    if (n.length >= 8 && n.length <= 15) {
      const kept = phoneTidy(`+${n}`);
      if (kept && phoneOk(kept) && !kept.startsWith('+20')) return { phone: kept, egyptMobile: false };
    }
  }
  return null;
}

/** The phones written in the text, as kept, each once: the Egyptian mobiles first, then the others, in order. */
export function cvPhones(text: string): string[] {
  // the emails and links taken out first: a link's digits (vimeo.com/123456789) are no phone
  const plain = westernDigits(text).replace(EMAIL_IN_TEXT, ' ').replace(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/gi, ' ');
  const found = (plain.match(PHONE_LIKE) ?? []).map(cvPhoneOf).filter((p): p is { phone: string; egyptMobile: boolean } => !!p);
  const ordered = [...found.filter((p) => p.egyptMobile), ...found.filter((p) => !p.egyptMobile)].map((p) => p.phone);
  return [...new Set(ordered)];
}

// ---------- links ----------

/** A LinkedIn profile's link: linkedin.com/in/<name>, any country's sub-domain, with or without https://. */
const LINKEDIN_IN_TEXT = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9%_-]+(?:-[A-Za-z0-9%_]+)*)\/?/gi;

/**
 * The text with a LinkedIn link broken over two lines joined again (LinkedIn's own PDF wraps a long one:
 * "www.linkedin.com/in/mona-adel-" then "12345678 (LinkedIn)").
 */
const joinWrappedLinkedIn = (text: string) => text.replace(/(linkedin\.com\/in\/[A-Za-z0-9%_-]*-)[ \t]*\r?\n[ \t]*([A-Za-z0-9%_-]+)/gi, '$1$2');

/** The LinkedIn profile written in the text, as https://www.linkedin.com/in/<name>; null when none. */
export function cvLinkedIn(text: string): string | null {
  LINKEDIN_IN_TEXT.lastIndex = 0;
  const m = LINKEDIN_IN_TEXT.exec(joinWrappedLinkedIn(text));
  if (!m) return null;
  const name = m[1].replace(/-+$/, '');
  return name.length >= 3 ? `https://www.linkedin.com/in/${name}` : null;
}

/** Something written like a web address: with https://, www., or a host and a path. */
const LINK_IN_TEXT = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?:\/[^\s,;)>"'\]]*)?/gi;

/** Words on a line that say a link is the person's own site. */
const OWN_SITE_WORDS = /\b(?:portfolio|website|web site|site|my work|showreel|reel|behance|blog)\b|معرض الأعمال|الموقع/i;

/** How many of the CV's first lines are its header (the name and the contacts). */
const HEADER_LINES = 12;

/**
 * The portfolio links written in the text, each with its platform, as their shapes check (portfolio.ts), each once, at
 * most 3: never LinkedIn, an email's domain or a bare word with a dot; a website only when its line says it is the
 * person's own (OWN_SITE_WORDS) or it is among the header's lines. An http:// address is taken as https://.
 */
export function cvPortfolioLinks(text: string): { url: string; kind: PortfolioLinkKind }[] {
  const lines = linesOf(westernDigits(text));
  const emailHosts = new Set(cvEmails(text).map((e) => e.split('@')[1]));
  const out: { url: string; kind: PortfolioLinkKind }[] = [];
  lines.forEach((line, i) => {
    for (const raw of line.match(LINK_IN_TEXT) ?? []) {
      if (out.length >= CV_PREFILL_LIMITS.links) return;
      const link = raw.replace(/[.)\]]+$/, '');
      const bare = link.replace(/^https?:\/\//i, '');
      const host = bare.split('/')[0].toLowerCase().replace(/^www\./, '');
      if (emailHosts.has(host) || /(^|\.)linkedin\.com$/.test(host) || /^\d+(\.\d+)*$/.test(host)) continue;
      // a word with a dot ("Node.js", "file.pdf") is no link: it has https://, www., or a path
      if (!/^https?:\/\//i.test(link) && !/^www\./i.test(link) && !bare.includes('/')) continue;
      const checked = checkPortfolioLink(`https://${bare}`, PORTFOLIO_KINDS);
      if (!checked.ok) continue;
      if (checked.kind === 'website' && !(i < HEADER_LINES || OWN_SITE_WORDS.test(line))) continue;
      if (!out.some((o) => o.url === checked.link)) out.push({ url: checked.link, kind: checked.kind });
    }
  });
  return out;
}

// ---------- the name ----------

/** Headings a CV starts with, never a name. */
const HEADINGS = /^(?:curriculum vitae|curriculum vitæ|c\.?\s?v\.?|r[eé]sum[eé]|resume|my cv|personal (?:information|info|details|data|profile)|contact(?: info| information| details)?|profile|summary|about me|السيره الذاتيه|السيرة الذاتية|سيره ذاتيه|سيرة ذاتية|البيانات الشخصيه|البيانات الشخصية)$/i;

/** Words of a job title or a section, never in a name ("Senior Video Editor", "Work Experience"). */
const NOT_NAME_WORDS =
  /\b(?:editor|designer|developer|engineer|manager|specialist|officer|executive|assistant|accountant|analyst|consultant|director|coordinator|supervisor|creator|producer|writer|copywriter|artist|photographer|videographer|animator|marketer|marketing|intern|trainee|student|graduate|freelancer?|lead|head|senior|junior|team|sales|media|content|graphic|motion|video|digital|social|experience|education|skills|languages|objective|summary|profile|references|projects|address|phone|mobile|email|linkedin|portfolio|egypt|cairo|giza|alexandria|street|road|city|governorate|university|faculty|college|school)\b/i;

/** A word of a name: letters (Latin with accents, or Arabic), with an apostrophe or a hyphen inside; an initial. */
const NAME_WORD = /^(?:[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*|[A-Z]\.|[ء-ي]+)$/;

/** Whether a line reads as a person's name: two to five words of a name, no digits, nothing else, in a short line. */
export function nameLike(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim();
  if (t.length < 4 || t.length > 50 || /[\d@/\\|:•·,;()]/.test(t) || HEADINGS.test(t) || NOT_NAME_WORDS.test(t)) return false;
  const words = t.split(' ');
  if (words.length < 2 || words.length > 5 || !words.every((w) => NAME_WORD.test(w))) return false;
  // Latin words: each with a capital first (Title Case or capitals), as a name is written
  const latin = words.filter((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(w));
  return latin.every((w) => /^[A-ZÀ-ÖØ-Þ]/.test(w));
}

/** A name as kept: single spaces; one in capitals ("MONA ADEL") in Title Case ("Mona Adel"). */
function tidyName(line: string): string {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!/[a-zà-ÿ]/.test(t) && /[A-Z]/.test(t)) return t.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return t;
}

/** Where a LinkedIn profile's main column starts: its headline, location, then "Summary" or "Experience". */
const LINKEDIN_SECTIONS = /^(?:summary|experience|about)$/i;
/** A location line of a LinkedIn profile: "Cairo, Egypt", "Giza, Al Jizah, Egypt", "Egypt", "Dubai, United Arab Emirates". */
const LOCATION_LINE = /^[\p{L}\s.'-]+(?:,\s*[\p{L}\s.'-]+){1,3}$|^(?:egypt|مصر|saudi arabia|united arab emirates|qatar|kuwait|bahrain|oman|jordan)$/iu;

/**
 * The person's name, only when confident (null otherwise): on a LinkedIn profile saved as a PDF (starts with "Contact",
 * has the profile's link), the line above its headline and location; on any other CV, the first of its top lines
 * (headings like "Curriculum Vitae" skipped) when it reads as a name (nameLike).
 */
export function cvName(text: string): string | null {
  const lines = linesOf(westernDigits(text));
  if (!lines.length) return null;
  if (/^contact$/i.test(lines[0]) && /linkedin\.com\/in\//i.test(text)) {
    const at = lines.findIndex((l, i) => i > 0 && LINKEDIN_SECTIONS.test(l));
    if (at >= 2) {
      // name, headline, location ("Cairo, Egypt"), then the section; or name, headline (no location)
      const name = lines[at - 2 - (LOCATION_LINE.test(lines[at - 1]) ? 1 : 0)];
      if (name && nameLike(name)) return tidyName(name);
    }
    return null;
  }
  const top = lines.filter((l) => !HEADINGS.test(l.replace(/[:\-–—]+$/, '').trim())).slice(0, 3);
  const first = top[0];
  if (first && nameLike(first)) return tidyName(first);
  // a name written after a short heading on its line: "Name: Mona Adel"
  const named = /^(?:name|full name|الاسم)\s*[:：-]\s*(.+)$/i.exec(lines.slice(0, 6).find((l) => /^(?:name|full name|الاسم)\s*[:：-]/i.test(l)) ?? '');
  return named && nameLike(named[1]) ? tidyName(named[1]) : null;
}

// ---------- all of it ----------

/** The years of experience the CV's dates work out to (as its reading's: experienceMonths), rounded down; null without dates. */
export function cvYearsOf(text: string, now: Date = new Date()): number | null {
  const months = experienceMonths(text, now);
  if (months === null) return null;
  return Math.min(Math.floor(months / 12), RECRUITMENT_LIMITS.yearsExperience);
}

/** What the CV's text gives the form. */
export function cvPrefillOf(text: string, now: Date = new Date()): CvPrefill {
  if (!text.trim()) return { ...NO_PREFILL, portfolioLinks: [] };
  return {
    fullName: cvName(text),
    email: cvEmails(text)[0] ?? null,
    mobile: cvPhones(text)[0] ?? null,
    linkedin: cvLinkedIn(text),
    portfolioLinks: cvPortfolioLinks(text),
    yearsExperience: cvYearsOf(text, now),
  };
}
