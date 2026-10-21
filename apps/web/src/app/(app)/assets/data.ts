import 'server-only';
import { cache } from 'react';
import {
  assetsCan,
  type AssetDraftView,
  type AssetKitView,
  type AssetListView,
  type AssetRoomView,
  type AssetSettingsView,
  type AssetsAccessView,
  type AssetView,
} from '@trendlix/shared';
import { ASSET_API, type AssetQuery } from '@/lib/asset-paths';
import { getCurrentUser } from '@/lib/session';
import { loadJson, type Loaded } from '../payroll/load';

// Reading the Assets pages' data (owner, 21 October 2026: "i want to add this module with a special permission to the
// system"): the caller's Assets access (GET /auth/me's `assets`), a page of the register, one asset, the rooms, the kits
// and the settings. An API from before the Assets module answers 404, which here means "not available yet" rather than
// the 404 page (except for an asset's page, where a 404 is an asset that isn't there); a refusal (403) is said in its
// place. The API checks every request: hiding a page is a convenience.

export type { Loaded };

const NONE: AssetsAccessView = { access: 'none', values: false, ai: false };

/** The caller's Assets access in effect, the values rule and the AI; none from an API from before the module. */
export const loadAssetsAccess = cache(async (): Promise<AssetsAccessView> => (await getCurrentUser()).assets ?? NONE);

/** What the caller may do in Assets (assetsCan), with their access. */
export async function assetsCaller() {
  const access = await loadAssetsAccess();
  return { access, can: assetsCan(access) };
}

export function loadAssets(query: AssetQuery): Promise<Loaded<AssetListView>> {
  return loadJson<AssetListView>(ASSET_API.list(query));
}

export const loadAsset = cache((code: string): Promise<Loaded<AssetView>> => loadJson<AssetView>(ASSET_API.asset(code)));

export const loadRooms = cache((): Promise<Loaded<AssetRoomView[]>> => loadJson<AssetRoomView[]>(ASSET_API.rooms));

export const loadKits = cache((): Promise<Loaded<AssetKitView[]>> => loadJson<AssetKitView[]>(ASSET_API.kits));

export function loadAssetSettings(): Promise<Loaded<AssetSettingsView>> {
  return loadJson<AssetSettingsView>(ASSET_API.settings);
}

/**
 * The drafts from Claude still open (step 2, owner, 21 October 2026: "the connection method"), for a custodian or a
 * manager; and one draft, any status (a 404 here is "unavailable": a draft that isn't there, or an API from before).
 */
export const loadDrafts = cache((): Promise<Loaded<AssetDraftView[]>> => loadJson<AssetDraftView[]>(ASSET_API.drafts));

export const loadDraft = cache((id: string): Promise<Loaded<AssetDraftView>> => loadJson<AssetDraftView>(ASSET_API.draft(id)));

/** What an Assets page says in place of what it couldn't load. */
export function assetsNotLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return 'Not available yet: the server does not have Assets yet. Please try again after its next update.';
  if (loaded.kind === 'forbidden') return `You can't see the ${what}.`;
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}

/** The list a page's choices come from, empty when it couldn't be read (the page still works without it). */
export const listOrEmpty = <T,>(loaded: Loaded<T[]>): T[] => (loaded.kind === 'ok' ? loaded.value : []);
