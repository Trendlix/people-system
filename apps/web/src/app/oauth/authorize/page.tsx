import {
  ASSETS_ACCESS_LABELS,
  authorizeRedirect,
  CONNECTOR_CONSENT_QUESTION,
  CONNECTOR_REFUSALS,
  connectorAbilities,
  readAuthorizeInput,
  type ConnectorAuthorizeCheck,
} from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { checkBody, loginPathFor } from '@/lib/connector/authorize';
import { getCurrentUser } from '@/lib/session';
import { ConsentButtons } from './consent-buttons';
import { postWithSession, siteOrigin } from './data';

// The Claude connector's sign-in and consent page (owner, 21 October 2026: "i might link a claude account for the assets
// section only to fetch data and help in the data entry"; "the connection method"; the brief: "Allow Claude to use your
// Assets access in Trendlix People?"). Claude opens it with an OAuth 2.1 authorization request; without a session the
// proxy sends the person to the system's own sign-in first, which comes back here. The API checks the client and its
// return address (shown here, never redirected to when wrong), the request (sent back to Claude with the error), and the
// person: only someone with Assets access (viewer, custodian or manager), never while viewing as someone. Then what
// Claude can and can't do at their level, and Allow or Deny. Kept out of frames (next.config.ts headers).

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Connect Claude · People System', ...(await brandMetadata()) };
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="space-y-3 text-sm">{children}</div>
    </div>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: 'ok' | 'muted' }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className={tone === 'ok' ? 'text-ok' : 'text-muted'}>
              {tone === 'ok' ? '✓' : '✕'}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Consent({ searchParams }: { searchParams: PageProps<'/oauth/authorize'>['searchParams'] }) {
  const input = readAuthorizeInput(await searchParams);
  const origin = await siteOrigin();
  const checked = await postWithSession<ConnectorAuthorizeCheck>('/connector/oauth/authorize/check', checkBody(input, origin));
  if (checked.kind === 'signin') redirect(loginPathFor(input));
  if (checked.kind === 'failed') {
    return (
      <Notice title="Connect Claude">
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
          {checked.messages.join(' ')}
        </p>
      </Notice>
    );
  }
  const check = checked.value;
  // a client or a return address this server doesn't accept: said here, nobody is sent anywhere
  if (check.kind === 'show') {
    return (
      <Notice title="This Connection Can’t Be Made">
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
          {check.message}
        </p>
        <p className="text-muted">Add the connector again in Claude, from Assets → Setup → Connect Claude.</p>
        <Link href="/" className="btn btn-secondary">
          Go to Trendlix People
        </Link>
      </Notice>
    );
  }
  // anything else wrong with the request goes back to Claude, which says it
  if (check.kind === 'redirect') redirect(authorizeRedirect(check.redirectUri, origin, input.state, check.error));

  const request = JSON.stringify(input);
  if (check.refusal) {
    return (
      <Notice title="Connect Claude">
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">{CONNECTOR_REFUSALS[check.refusal]}</p>
        <ConsentButtons request={request} allow={false} />
      </Notice>
    );
  }

  const user = await getCurrentUser();
  const { can, cannot } = connectorAbilities(check.access, check.values);
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Connect Claude</h1>
        <p className="text-sm font-medium">{CONNECTOR_CONSENT_QUESTION}</p>
        <p className="text-sm text-muted">
          {check.client.name} asks to use Assets as {user.name ?? user.email}, with your access: {ASSETS_ACCESS_LABELS[check.access]}
          {check.values ? ', with the values' : ''}. Every change it makes is in the audit log as yours, via the Claude connector.
        </p>
      </div>
      <List title="Claude Can" items={can} tone="ok" />
      <List title="Claude Can’t" items={cannot} tone="muted" />
      <p className="text-sm text-muted">
        You will go back to <strong className="text-ink">{check.redirectHost}</strong>. You can sign the connection out any time on Your Sessions, where it
        shows as Claude connector; changing your password ends it too.
      </p>
      <ConsentButtons request={request} allow />
    </div>
  );
}

export default function AuthorizePage({ searchParams }: PageProps<'/oauth/authorize'>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Suspense fallback={<BrandFallback />}>
            <Brand />
          </Suspense>
        </div>
        <div className="card p-6">
          <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
            <Consent searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
