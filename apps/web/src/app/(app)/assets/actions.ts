'use server';

// The Assets pages' form actions (owner, 21 October 2026: "i want to add this module with a special permission to the
// system"): registering and editing an asset (its values too, for the CEO, Finance and a Super Admin: "CEO and
// Finance"), its photos, marking it labelled, deleting it (a Super Admin, never one that was in custody), the rooms, the
// kits and the capitalization threshold. Each forwards to the API, which checks the caller's Assets access, the values
// rule and every field again, so calling these directly can't get round them; its refusals show on the forms.

import type { AssetPhotoRef, AssetStatus, AssetView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { ASSET_API, ASSET_PATHS } from '@/lib/asset-paths';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { todayInCairo } from '../employees/ui';
import { ASSET_FORM_FIELDS, assetBody, readAssetForm, readValuesForm, typedValues, VALUE_FORM_FIELDS, numberFrom } from './assets';
import { assetsCaller } from './data';

/** A save of the Add or Edit form: its refusal, or the asset's code once saved (the form then sends its photos). */
export type AssetSaveState = FormState & { code?: string };

const messages = (err: unknown): string[] => {
  if (err instanceof ApiError) return err.messages;
  throw err;
};

/**
 * Registers an asset (`code` null) or edits one: its fields read and checked as the API will (readAssetForm), the
 * values only from those who see them, the status by hand only on Edit (`from`: its status now). Answers the code; the
 * form sends the photos chosen after it, then opens the asset's page. `draftId`: the Add form filled in from a draft
 * from Claude (step 2, owner, 21 October 2026: "the connection method"): saving confirms it, the asset made and its code
 * given in the same step, the draft then confirmed; the values drafted are kept for someone who doesn't see them.
 */
export async function saveAsset(code: string | null, from: AssetStatus | null, fd: FormData, draftId: string | null = null): Promise<AssetSaveState> {
  const { can } = await assetsCaller();
  const fields = can.values ? [...ASSET_FORM_FIELDS, ...VALUE_FORM_FIELDS] : [...ASSET_FORM_FIELDS];
  const typed = typedValues(fd, fields);
  const form = readAssetForm(fd, todayInCairo(), code ? from : null);
  const values = can.values ? readValuesForm(fd) : null;
  const problems = [...form.problems, ...(values?.problems ?? [])];
  if (problems.length) return { errors: problems, values: typed };
  const body = assetBody(form, code ? 'edit' : 'add', values?.values ?? null);
  try {
    const saved = code
      ? await apiSend<AssetView>('PATCH', ASSET_API.asset(code), body)
      : await apiSend<AssetView>('POST', draftId ? ASSET_API.draftConfirm(draftId) : ASSET_API.create, body);
    return { code: saved?.code ?? code ?? undefined };
  } catch (err) {
    return { errors: messages(err), values: typed };
  }
}

/** Sends one photo (`photos` in the form, made smaller in the browser): one a request, as uploads are limited in size. */
export async function addAssetPhoto(code: string, fd: FormData): Promise<{ photos?: AssetPhotoRef[]; error?: string }> {
  const form = new FormData();
  for (const file of fd.getAll('photos')) if (file instanceof File && file.size > 0) form.append('photos', file, file.name || 'photo.jpg');
  if (!form.has('photos')) return { error: 'Choose a photo.' };
  try {
    return { photos: (await apiUpload<AssetPhotoRef[]>('POST', ASSET_API.photos(code), form)) ?? [] };
  } catch (err) {
    return { error: messages(err).join(' ') };
  }
}

/** After photos were sent from the asset's page: its data again. */
export async function photosSent(): Promise<void> {
  refresh();
}

/** A photo's file replaced by another (`photo`), e.g. a clearer one. */
export async function replaceAssetPhoto(code: string, photoId: string, fd: FormData): Promise<{ error?: string }> {
  const file = fd.get('photo');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a photo.' };
  const form = new FormData();
  form.append('photo', file, file.name || 'photo.jpg');
  try {
    await apiUpload('PUT', ASSET_API.photo(code, photoId), form);
  } catch (err) {
    return { error: messages(err).join(' ') };
  }
  refresh();
  return {};
}

/** The photo the lists show: this one, first. */
export async function makeAssetPhotoFirst(code: string, photoId: string): Promise<{ error?: string }> {
  try {
    await apiSend('POST', ASSET_API.photoFirst(code, photoId));
  } catch (err) {
    return { error: messages(err).join(' ') };
  }
  refresh();
  return {};
}

/** Deletes a photo: a Super Admin's, as every delete is (owner's decision, 15 October 2026). */
export async function deleteAssetPhoto(code: string, photoId: string): Promise<{ error?: string }> {
  const refused = await deleteRefusal();
  if (refused) return { error: refused.join(' ') };
  try {
    await apiSend('DELETE', ASSET_API.photo(code, photoId));
  } catch (err) {
    return { error: messages(err).join(' ') };
  }
  refresh();
  return {};
}

/**
 * The values alone (PATCH /assets/:code/values), for the CEO, Finance and a Super Admin, whatever their Assets access:
 * "Edit values" on the asset's page and "Needs values". Opens the asset's page once saved, or `back` (Needs values).
 */
export async function saveAssetValues(code: string, back: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const typed = typedValues(fd, VALUE_FORM_FIELDS);
  const { values, problems } = readValuesForm(fd);
  if (problems.length) return { errors: problems, values: typed };
  try {
    await apiSend('PATCH', ASSET_API.values(code), values);
  } catch (err) {
    return { errors: messages(err), values: typed };
  }
  redirect(back === 'needs-values' ? `${ASSET_PATHS.needsValues}?done=${encodeURIComponent(code)}` : `${ASSET_PATHS.asset(code)}?done=values`);
}

/** Marks the asset labelled now, once its label is printed and stuck on (spec §5: "after printing set labeled_at"). */
export async function markAssetLabelled(code: string): Promise<FormState> {
  try {
    await apiSend('POST', ASSET_API.labeled(code));
  } catch (err) {
    return { errors: messages(err) };
  }
  refresh();
  return { message: 'Marked as labelled.' };
}

/** Deletes an asset: a Super Admin's, and only one never in custody (the API refuses the others: dispose of them). */
export async function deleteAsset(code: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', ASSET_API.asset(code));
  } catch (err) {
    return { errors: messages(err) };
  }
  redirect(`${ASSET_PATHS.list}?deleted=${encodeURIComponent(code)}`);
}

// ---------- drafts from Claude ----------

/**
 * Discards a draft from Claude (a custodian or a manager): it is set aside, never an asset, and leaves Drafts from
 * Claude; the audit log keeps it. Not a delete, so not only a Super Admin's. `back`: where to go after (the list).
 */
export async function discardDraft(id: string, back: string | null): Promise<FormState> {
  try {
    await apiSend('POST', ASSET_API.draftDiscard(id));
  } catch (err) {
    return { errors: messages(err) };
  }
  if (back) redirect(back);
  refresh();
  return { message: 'Draft discarded.' };
}

/**
 * Takes a product image off a draft still waiting (a custodian or a manager; owner, 21 October 2026: "let the mcp
 * connector fetch the product photo and add it"): it never reaches the asset. Not a record's delete, so not only a
 * Super Admin's; the audit log keeps where it came from.
 */
export async function removeDraftImage(draftId: string, imageId: string): Promise<FormState> {
  try {
    await apiSend('DELETE', ASSET_API.draftImage(draftId, imageId));
  } catch (err) {
    return { errors: messages(err) };
  }
  refresh();
  return { message: 'Product image removed.' };
}

// ---------- rooms ----------

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

export async function createRoom(_prev: FormState, fd: FormData): Promise<FormState> {
  const body = { name: text(fd, 'name'), notes: text(fd, 'notes') || null };
  try {
    await apiSend('POST', ASSET_API.rooms, body);
  } catch (err) {
    return { errors: messages(err), values: { name: body.name, notes: body.notes ?? '' } };
  }
  refresh();
  return { message: `${body.name} added.` };
}

export async function updateRoom(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const body = { name: text(fd, 'name'), notes: text(fd, 'notes') || null };
  try {
    await apiSend('PATCH', ASSET_API.room(id), body);
  } catch (err) {
    return { errors: messages(err), values: { name: body.name, notes: body.notes ?? '' } };
  }
  refresh();
  return { message: 'Saved.' };
}

/** An archived room can't be chosen for an asset any more; the assets in it keep it. */
export async function setRoomArchived(id: string, archived: boolean): Promise<FormState> {
  try {
    await apiSend('PATCH', ASSET_API.room(id), { archived });
  } catch (err) {
    return { errors: messages(err) };
  }
  refresh();
  return { message: archived ? 'Archived.' : 'Back in use.' };
}

export async function deleteRoom(id: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', ASSET_API.room(id));
  } catch (err) {
    return { errors: messages(err) };
  }
  refresh();
  return { message: 'Deleted.' };
}

// ---------- kits ----------

export async function createKit(_prev: FormState, fd: FormData): Promise<FormState> {
  const body = { name: text(fd, 'name'), notes: text(fd, 'notes') || null };
  try {
    const kit = await apiSend<{ code: string }>('POST', ASSET_API.kits, body);
    refresh();
    return { message: `${kit?.code ?? 'The kit'} ${body.name} added.` };
  } catch (err) {
    return { errors: messages(err), values: { name: body.name, notes: body.notes ?? '' } };
  }
}

export async function updateKit(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const body = { name: text(fd, 'name'), notes: text(fd, 'notes') || null };
  try {
    await apiSend('PATCH', ASSET_API.kit(id), body);
  } catch (err) {
    return { errors: messages(err), values: { name: body.name, notes: body.notes ?? '' } };
  }
  refresh();
  return { message: 'Saved.' };
}

// ---------- settings ----------

/** The capitalization threshold, in EGP: an asset cheaper than it is Expensed (book value 0). */
export async function saveAssetSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = text(fd, 'capitalizationThreshold');
  const threshold = numberFrom(raw);
  if (threshold === null || Number.isNaN(threshold)) return { errors: ['Enter the threshold in EGP, e.g. 5000, or 0 for none.'], values: { capitalizationThreshold: raw } };
  try {
    await apiSend('PATCH', ASSET_API.settings, { capitalizationThreshold: threshold });
  } catch (err) {
    return { errors: messages(err), values: { capitalizationThreshold: raw } };
  }
  refresh();
  return { message: 'Saved. Book values follow the new threshold straight away.' };
}
