'use server';

// Delete selected and Dispose selected on All Assets (owner, 25 October 2026: "can i delete multiple assets at one?";
// "Never-in-custody only"): each forwards the codes ticked to the API, which checks the caller (a Super Admin deletes,
// an Assets manager disposes of), puts each asset through the rules of one deleted or disposed of on its page, and
// answers what it did and what it skipped with the reason; the list is then read again, its filters and page kept.

import type { BulkDeleteResult, BulkDisposeResult } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { ASSET_API, ASSET_STEP4_API } from '@/lib/asset-paths';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { todayInCairo } from '../employees/ui';
import { typedValues } from './assets';
import { BULK_DISPOSE_FIELDS, bulkDisposeBody, codesProblem } from './bulk';

/** An action's answer: what the API did, or why it refused (the form's fields kept). */
export type BulkState<T> = FormState & { result?: T };

const messages = (err: unknown): string[] => {
  if (err instanceof ApiError) return err.messages;
  throw err;
};

/** Delete selected (a Super Admin): those never in custody deleted, the others skipped with the reason. */
export async function deleteSelectedAssets(codes: string[]): Promise<BulkState<BulkDeleteResult>> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  const problem = codesProblem(codes);
  if (problem) return { errors: [problem] };
  try {
    const result = await apiSend<BulkDeleteResult>('POST', ASSET_API.bulkDelete, { codes });
    refresh();
    return { result: result ?? { deleted: [], skipped: [] } };
  } catch (err) {
    return { errors: messages(err) };
  }
}

/** Dispose selected (an Assets manager): how, the day, who approved it and a note, the same for every asset ticked. */
export async function disposeSelectedAssets(codes: string[], _prev: BulkState<BulkDisposeResult>, fd: FormData): Promise<BulkState<BulkDisposeResult>> {
  const values = typedValues(fd, BULK_DISPOSE_FIELDS);
  const { body, problems } = bulkDisposeBody(codes, fd, todayInCairo());
  if (problems.length) return { errors: problems, values };
  try {
    const result = await apiSend<BulkDisposeResult>('POST', ASSET_STEP4_API.bulkDispose, body);
    refresh();
    return { result: result ?? { disposed: [], skipped: [] } };
  } catch (err) {
    return { errors: messages(err), values };
  }
}
