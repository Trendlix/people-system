import 'server-only';
import type { EarlierOffersSetting, LinkedInSettingsView, PortfolioSettingsView } from '@trendlix/shared';
import { loadJson, type Loaded } from '../payroll/load';

// Recruitment Settings' newer sections (owner, 25 October 2026: "can i use linkedin to complete the data? and for
// creatives, they need to add their portfolios"; asked, all three): the portfolio each position asks for on the careers
// forms (HR, the CEO and a Super Admin read it), and the LinkedIn sign-in's setup (a Super Admin's only: 403 for anyone
// else, never a developer). An API from before them answers 404: "not available yet".

export const loadPortfolioSettings = (): Promise<Loaded<PortfolioSettingsView>> => loadJson('/recruitment/settings/portfolio');

export const loadLinkedInSettings = (): Promise<Loaded<LinkedInSettingsView>> => loadJson('/recruitment/settings/linkedin');

/** "Entering earlier offers" (25 October 2026): HR, the CEO and a Super Admin read it. */
export const loadEarlierOffersSetting = (): Promise<Loaded<EarlierOffersSetting>> => loadJson('/recruitment/settings/earlier-offers');
