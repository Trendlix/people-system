import 'server-only';
import { cache } from 'react';
import type { AssetCountSheetView, AssetCountsView, AssetCountView, AssetDashboardView, AssetLabelChoice } from '@trendlix/shared';
import { ASSET_STEP5_API, type CountScopeQuery, type LabelQuery } from '@/lib/asset-paths';
import { loadJson, type Loaded } from '../payroll/load';

// Reading Assets step 5's data (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets
// dashboard, exports) … work on this"): the counts and their schedule, a count's sheet, a count, the dashboard, and the
// label sheets' choices. An API from before step 5 answers 404, which the pages say as "not available yet".

export const loadCounts = (page: number): Promise<Loaded<AssetCountsView>> => loadJson<AssetCountsView>(ASSET_STEP5_API.counts(page));

export const loadCountSheet = (scope: CountScopeQuery): Promise<Loaded<AssetCountSheetView>> => loadJson<AssetCountSheetView>(ASSET_STEP5_API.sheet(scope));

export const loadCount = cache((id: string): Promise<Loaded<AssetCountView>> => loadJson<AssetCountView>(ASSET_STEP5_API.countOne(id)));

export const loadDashboard = (): Promise<Loaded<AssetDashboardView>> => loadJson<AssetDashboardView>(ASSET_STEP5_API.dashboard);

export const loadLabelChoices = (query: LabelQuery): Promise<Loaded<AssetLabelChoice[]>> => loadJson<AssetLabelChoice[]>(ASSET_STEP5_API.labels(query));

export const loadLabelsFor = (codes: readonly string[]): Promise<Loaded<AssetLabelChoice[]>> => loadJson<AssetLabelChoice[]>(ASSET_STEP5_API.labelsFor(codes));
