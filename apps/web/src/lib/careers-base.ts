import { careersSiteOf } from '@trendlix/shared';

// The careers site's address on this website (25 October 2026: the careers pages moved to www.trendlix.com/en/careers,
// and the owner asked that the links stop relying on people.trendlix.com/careers' redirect; packages/shared
// careers-base.ts): the address the API sends from Recruitment Settings ("Careers site address", the standard when
// unset), so every public careers link the site shows (a vacancy's apply links and "Open on the careers site",
// LinkedIn's redirect URL) is built on it with careersSiteUrl. CAREERS_BASE_URL only when the API sent none (an API from
// before it), else the standard. Server code (it reads the environment); no "@/" imports, tested in careers-base.test.ts.

/** The careers site in use: the API's, else CAREERS_BASE_URL, else the standard. */
export const careersSiteFrom = (fromApi: string | null | undefined, fallback: string | undefined = process.env.CAREERS_BASE_URL): string => careersSiteOf(fromApi, fallback);
