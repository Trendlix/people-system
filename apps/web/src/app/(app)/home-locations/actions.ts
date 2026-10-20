'use server';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"): asking (the employee's own), withdrawing one while it is being decided, removing an approved home (the
// employee's own, or HR's, the CEO's or the Super Admin's with a comment), and each step's decision (HR's with the radius,
// the CEO's). Each forwards to the API, which checks who may do what and that nobody decides their own, so calling these
// directly can't bypass that. Once done, the request's page opens: the site's, or the phone pages' for a form sent from
// them (lib/surface.ts); a decision taken on Approvals comes back to Approvals.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { HomeStage } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { HomeLocationView } from '@/lib/home-location-types';
import { afterAction } from '@/lib/surface';
import type { FormState } from '@/lib/types';
import { APPROVALS_HOME_ID, homeAskBody, homeDecisionBody, homeDoneHref, homeRemoveBody, MY_HOMES_API } from './home-locations';

const typed = (fd: FormData) => ({
  latitude: String(fd.get('latitude') ?? ''),
  longitude: String(fd.get('longitude') ?? ''),
  accuracy: String(fd.get('accuracy') ?? ''),
  label: String(fd.get('label') ?? ''),
});

/** The employee asks for their home (POST /me/home-locations). */
export async function askHome(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd);
  const { body, errors } = homeAskBody(fd);
  if (!body) return { errors, values };
  let made: HomeLocationView | undefined;
  try {
    made = await apiSend<HomeLocationView>('POST', MY_HOMES_API, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  // My Requests and HR's counts in the sidebar now have it
  refresh();
  redirect(afterAction(fd, made?.id ? homeDoneHref(made.id, 'sent') : '/my-requests'));
}

/** The employee withdraws their request while it is being decided. */
export async function withdrawHome(id: string, _prev?: FormState, fd?: FormData): Promise<FormState> {
  try {
    await apiSend('POST', `${MY_HOMES_API}/${encodeURIComponent(id)}/withdraw`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, homeDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, homeDoneHref(id, 'withdrawn')));
}

/**
 * An approved home removed: the employee's own (POST /me/home-locations/:id/remove), or HR's, the CEO's or the Super
 * Admin's, with a comment if they give one (POST /home-locations/:id/remove). `own`: the employee's.
 */
export async function removeHome(id: string, own: boolean, _prev?: FormState, fd?: FormData): Promise<FormState> {
  try {
    await apiSend('POST', own ? `${MY_HOMES_API}/${encodeURIComponent(id)}/remove` : `/home-locations/${encodeURIComponent(id)}/remove`, own ? undefined : homeRemoveBody(fd));
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, homeDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, homeDoneHref(id, 'removed')));
}

/**
 * A step's decision on a request waiting for the caller (POST /home-locations/:id/decide): HR's with the radius, the
 * CEO's. One that moved on meanwhile is refused with why: shown on the form. Sent from Approvals (`from=approvals`), back
 * to Approvals with what was done.
 */
export async function decideHome(id: string, stage: HomeStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), comment: String(fd.get('comment') ?? ''), radiusMetres: String(fd.get('radiusMetres') ?? '') };
  const { body, errors } = homeDecisionBody(fd, stage);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/home-locations/${encodeURIComponent(id)}/decide`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  if (fd.get('from') === 'approvals') redirect(`/approvals?done=home-${stage}-${body.decision}#${APPROVALS_HOME_ID}`);
  redirect(afterAction(fd, homeDoneHref(id, `${stage}_${body.decision}`)));
}
