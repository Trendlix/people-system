import 'server-only';
import { cache } from 'react';
import type { AssetHistoryView, CustodyListView, CustodyRecordView, HandoverChoices, HolderCardView, HoldingsView, MyCustodyView } from '@trendlix/shared';
import { getBrand } from '@/lib/api';
import { CUSTODY_API, type CustodyQuery } from '@/lib/asset-paths';
import { brandMark } from '@/lib/brand';
import { loadJson, type Loaded } from '../payroll/load';
import type { FormBrand } from './custody-form';

// Reading the custody pages' data (Assets step 3, owner, 21 October 2026): the Custody list, a record, what the
// handover form chooses from, the holdings and a person's, an asset's history, My custody, and the company's name and
// logo for the printed forms. An API from before custody answers 404, which here means "not available yet" (a record's
// page says not found); a refusal (403) is said in its place. The API checks every request.

export function loadCustodyList(query: CustodyQuery): Promise<Loaded<CustodyListView>> {
  return loadJson<CustodyListView>(CUSTODY_API.list(query));
}

export const loadCustodyRecord = cache((code: string): Promise<Loaded<CustodyRecordView>> => loadJson<CustodyRecordView>(CUSTODY_API.record(code)));

export function loadHandoverChoices(): Promise<Loaded<HandoverChoices>> {
  return loadJson<HandoverChoices>(CUSTODY_API.choices);
}

export function loadHolders(q: string | null): Promise<Loaded<HolderCardView[]>> {
  return loadJson<HolderCardView[]>(CUSTODY_API.people(q));
}

export const loadHoldings = cache((employeeId: string): Promise<Loaded<HoldingsView>> => loadJson<HoldingsView>(CUSTODY_API.person(employeeId)));

export const loadAssetHistory = cache((code: string): Promise<Loaded<AssetHistoryView>> => loadJson<AssetHistoryView>(CUSTODY_API.history(code)));

/** The signed-in person's own custody (owner, 21 October 2026: "Yes, My custody"), anyone's. */
export const loadMyCustody = cache((): Promise<Loaded<MyCustodyView>> => loadJson<MyCustodyView>(CUSTODY_API.mine));

/**
 * The company as the printed forms name it: its name, in Arabic too for the bilingual custody form (24 October 2026),
 * and its logo (Organization), the logo served by this site.
 */
export async function formBrand(): Promise<FormBrand> {
  const brand = await getBrand();
  return { company: brand.nameEn, companyAr: brand.nameAr, logoSrc: brandMark(brand).full };
}
