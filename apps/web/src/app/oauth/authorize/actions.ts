'use server';

// The consent page's buttons (owner, 21 October 2026: "the connection method"; the brief: "Allow Claude to use your
// Assets access in Trendlix People?", with Allow / Deny). Allow asks the API for the code (it checks the request, the
// person's Assets access and that they aren't viewing as someone, again) and sends the person back to Claude with it;
// Deny, and Back to Claude, send them back with access_denied, but only to a return address the API has just accepted
// (never one taken from the form as it is).

import { authorizeRedirect, type ConnectorAuthorizeCheck, type ConnectorAuthorizeGrant } from '@trendlix/shared';
import { redirect } from 'next/navigation';
import { checkBody, DENIED, inputFromForm, loginPathFor } from '@/lib/connector/authorize';
import { postWithSession, siteOrigin } from './data';

export interface ConsentState {
  error?: string;
}

export async function allowClaude(_prev: ConsentState, fd: FormData): Promise<ConsentState> {
  const input = inputFromForm(fd.get('request'));
  const origin = await siteOrigin();
  const grant = await postWithSession<ConnectorAuthorizeGrant>('/connector/oauth/authorize', checkBody(input, origin));
  if (grant.kind === 'signin') redirect(loginPathFor(input));
  if (grant.kind === 'failed') return { error: grant.messages.join(' ') };
  redirect(authorizeRedirect(grant.value.redirectUri, origin, input.state, { code: grant.value.code }));
}

export async function denyClaude(_prev: ConsentState, fd: FormData): Promise<ConsentState> {
  const input = inputFromForm(fd.get('request'));
  const origin = await siteOrigin();
  const check = await postWithSession<ConnectorAuthorizeCheck>('/connector/oauth/authorize/check', checkBody(input, origin));
  if (check.kind === 'signin') redirect(loginPathFor(input));
  if (check.kind === 'failed') return { error: check.messages.join(' ') };
  const c = check.value;
  if (c.kind === 'show') return { error: c.message };
  redirect(authorizeRedirect(c.redirectUri, origin, input.state, c.kind === 'redirect' ? c.error : DENIED));
}
