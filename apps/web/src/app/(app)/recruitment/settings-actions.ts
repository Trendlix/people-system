'use server';

// Saving Recruitment Settings' newer sections (owner, 25 October 2026: "can i use linkedin to complete the data? and for
// creatives, they need to add their portfolios"; asked, all three): the portfolio per position (HR and a Super Admin;
// every row of the form sent), and the LinkedIn sign-in (a Super Admin; the client secret only when one was pasted, and
// never kept to show again after a refusal). Each forwards to the API, which checks who may and every rule again, and
// audits the change.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { linkedinSettingsOf, typedLinkedInValues } from './linkedin-settings';
import { portfolioSettingsOf, typedPortfolioValues } from './portfolio';

async function send(path: string, body: unknown, values: Record<string, string | string[]>, said: string): Promise<FormState> {
  try {
    await apiSend('PUT', path, body);
  } catch (err) {
    if (err instanceof ApiError) {
      const errors = err.status === 404 ? ['Not available yet: the server doesn’t have this setting yet. Please try again after its next update.'] : err.messages;
      return { errors, values };
    }
    throw err;
  }
  refresh();
  return { message: said };
}

export async function savePortfolioSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  return send('/recruitment/settings/portfolio', { positions: portfolioSettingsOf(fd) }, typedPortfolioValues(fd), 'Saved the portfolio settings.');
}

export async function saveLinkedInSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  return send('/recruitment/settings/linkedin', linkedinSettingsOf(fd), typedLinkedInValues(fd), 'Saved the LinkedIn sign-in.');
}
