'use server';

// Assets step 4's form actions (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal"; owner, 22
// October 2026: accessories, "Both kinds"): an asset's accessories' checklist, attaching it to a main asset or detaching
// it, Use and Restock, a maintenance entry by hand, disposal (an Assets manager's) and its amount (the CEO, Finance, a
// Super Admin), and a kit's assets. Each forwards to the API, which checks the caller's Assets access, the values rule
// and every rule again, so calling these directly can't get round them; its refusals show on the forms.

import type { AssetGroup, AssetKitView, DisposalResult, StockMoveKind } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { ASSET_STEP4_API } from '@/lib/asset-paths';
import type { FormState } from '@/lib/types';
import { apiMessages } from '../payroll/actions-common';
import { todayInCairo } from '../employees/ui';
import { numberFrom } from './assets';
import { ACCESSORY_ROWS_MAX, disposalBody, disposalResultText, kitCodesFrom, maintenanceBody, readAccessoriesForm, readParentCode, stockBody } from './upkeep';

const messages = (err: unknown): string[] => {
  if (err instanceof ApiError) return apiMessages(err);
  throw err;
};

const typedOf = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]));

/** The accessories' checklist saved as a whole (the form's `rows`: how many lines it had). */
export async function saveAccessories(code: string, group: AssetGroup, _prev: FormState, fd: FormData): Promise<FormState> {
  const rows = Math.min(ACCESSORY_ROWS_MAX + 1, Math.max(0, Math.floor(Number(fd.get('rows')) || 0)));
  const { items, problems } = readAccessoriesForm(fd, rows, group);
  if (problems.length) return { errors: problems, values: typedOf(fd) };
  try {
    await apiSend('PUT', ASSET_STEP4_API.accessories(code), { items });
  } catch (err) {
    return { errors: messages(err), values: typedOf(fd) };
  }
  refresh();
  return { message: items.length ? 'Accessories saved.' : 'Accessories cleared.' };
}

/** Attached to the main asset coded `parentCode` (typed), or `detach`ed. */
export async function attachAsset(code: string, detach: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  let parentCode: string | null = null;
  if (!detach) {
    const read = readParentCode(String(fd.get('parentCode') ?? ''));
    if (read.problem) return { errors: [read.problem], values: typedOf(fd) };
    parentCode = read.code;
  }
  try {
    await apiSend('PATCH', ASSET_STEP4_API.parent(code), { parentCode });
  } catch (err) {
    return { errors: messages(err), values: typedOf(fd) };
  }
  refresh();
  return { message: detach ? 'Detached.' : `Attached to ${parentCode}.` };
}

/** An asset attached to this main one (`mainCode`), by the attached one's code as typed. */
export async function attachItemTo(mainCode: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const read = readParentCode(String(fd.get('itemCode') ?? ''));
  if (read.problem) return { errors: [read.problem.replace('the main asset’s code', 'the code of the asset to attach')], values: typedOf(fd) };
  try {
    await apiSend('PATCH', ASSET_STEP4_API.parent(read.code!), { parentCode: mainCode });
  } catch (err) {
    return { errors: messages(err), values: typedOf(fd) };
  }
  refresh();
  return { message: `${read.code} attached.` };
}

/** Use or Restock (`quantity`: the stock the page showed, checked again by the API). */
export async function moveStock(code: string, kind: StockMoveKind, quantity: number, unit: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = stockBody(fd, kind, quantity, unit);
  if (problems.length) return { errors: problems, values: typedOf(fd) };
  try {
    await apiSend('POST', ASSET_STEP4_API.stock(code), body);
  } catch (err) {
    return { errors: messages(err), values: typedOf(fd) };
  }
  refresh();
  return { message: kind === 'use' ? 'Used from stock.' : 'Restocked.' };
}

/** A maintenance entry by hand; its cost only from those who see the values (`values`). */
export async function addMaintenance(code: string, values: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = maintenanceBody(fd, { values, today: todayInCairo() });
  if (problems.length) return { errors: problems, values: typedOf(fd) };
  try {
    await apiSend('POST', ASSET_STEP4_API.maintenance(code), body);
  } catch (err) {
    return { errors: messages(err), values: typedOf(fd) };
  }
  refresh();
  return { message: 'Added to the maintenance log.' };
}

/** Disposed of (an Assets manager); the amount received only from those who see the values. Says what else it did. */
export async function disposeAsset(code: string, values: boolean, purchaseDate: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = disposalBody(fd, { values, today: todayInCairo(), purchaseDate });
  if (problems.length) return { errors: problems, values: typedOf(fd) };
  try {
    const done = await apiSend<{ result: DisposalResult }>('POST', ASSET_STEP4_API.dispose(code), body);
    refresh();
    const also = done?.result ? disposalResultText(done.result) : null;
    return { message: `Disposed of. It stays on record, out of every total and list.${also ? ` ${also}` : ''}` };
  } catch (err) {
    return { errors: messages(err), values: typedOf(fd) };
  }
}

/** The amount a disposal received, set later (the CEO, Finance or a Super Admin). */
export async function saveDisposalAmount(code: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const raw = String(fd.get('amount') ?? '').trim();
  const amount = raw ? numberFrom(raw) : null;
  if (amount !== null && (Number.isNaN(amount) || amount < 0)) return { errors: ['Enter the amount received in EGP as 0 or more, e.g. 12000.'], values: { amount: raw } };
  try {
    await apiSend('PATCH', ASSET_STEP4_API.disposal(code), { amount });
  } catch (err) {
    return { errors: messages(err), values: { amount: raw } };
  }
  refresh();
  return { message: 'Saved.' };
}

/** Assets put in a kit by their codes (typed: one a line, or separated by commas). */
export async function addToKit(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const raw = String(fd.get('codes') ?? '');
  const { codes, wrong } = kitCodesFrom(raw);
  if (wrong.length) return { errors: [`Type each code as on its label, e.g. PK-CAM-0003: ${wrong.join(', ')} isn’t one.`], values: { codes: raw } };
  if (!codes.length) return { errors: ['Type the codes of the assets to add, e.g. PK-CAM-0003.'], values: { codes: raw } };
  try {
    const kit = await apiSend<AssetKitView>('PATCH', ASSET_STEP4_API.kitItems(id), { addCodes: codes });
    refresh();
    return { message: `${codes.length} ${codes.length === 1 ? 'asset' : 'assets'} in ${kit?.code ?? 'the kit'} now.` };
  } catch (err) {
    return { errors: messages(err), values: { codes: raw } };
  }
}

/** An asset taken out of a kit (it stays in the register, in no kit). */
export async function removeFromKit(id: string, assetId: string): Promise<FormState> {
  try {
    await apiSend('PATCH', ASSET_STEP4_API.kitItems(id), { remove: [assetId] });
  } catch (err) {
    return { errors: messages(err) };
  }
  refresh();
  return { message: 'Taken out of the kit.' };
}
