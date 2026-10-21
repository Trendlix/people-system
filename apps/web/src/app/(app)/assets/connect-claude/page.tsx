import { CONNECTOR_TOOLS, connectorAbilities, connectorResource } from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { originFromHeaders } from '@/lib/connector/site';
import { assetsCaller } from '../data';
import { Loading, NoAccess } from '../ui';
import { CopyAddress } from './copy-address';

// Assets → Connect Claude (owner, 21 October 2026: "i might link a claude account for the assets section only to fetch
// data and help in the data entry"; asked how without paying extra: "the connection method" / "option a"): the
// connector's address to copy and the steps in Claude (Customize → Connectors → Add custom connector → paste the URL →
// Connect → sign in → Allow), what Claude can do at the person's level, its tools, where its drafts go, and how to end
// it. It runs on the person's own Claude subscription: no API key, no API billing.

export const metadata: Metadata = { title: 'Connect Claude · People System' };

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
        {n}
      </span>
      <span className="pt-0.5 text-sm">{children}</span>
    </li>
  );
}

async function Connect() {
  const [{ access, can }, h] = await Promise.all([assetsCaller(), headers()]);
  if (!can.view) return <NoAccess />;
  const origin = originFromHeaders(h) ?? 'https://people.trendlix.com';
  const { can: abilities, cannot } = connectorAbilities(access.access, access.values);
  const tools = CONNECTOR_TOOLS.filter((t) => t.level === 'viewer' || can.register);
  return (
    <div className="space-y-4">
      <section aria-labelledby="address-heading" className="card space-y-4 p-5">
        <h2 id="address-heading" className="font-semibold">
          The Connector’s Address
        </h2>
        <CopyAddress address={connectorResource(origin)} />
      </section>

      <section aria-labelledby="steps-heading" className="card space-y-4 p-5">
        <h2 id="steps-heading" className="font-semibold">
          In Claude
        </h2>
        <ol className="space-y-3">
          <Step n={1}>
            Open Claude (claude.ai, or the desktop app) and go to <strong>Customize → Connectors</strong>. On a Team or Enterprise plan an Owner adds it under
            Organization settings → Connectors, then you press Connect.
          </Step>
          <Step n={2}>
            Choose <strong>Add custom connector</strong>. Name it <strong>Trendlix People</strong> and paste the address above into the server URL.
          </Step>
          <Step n={3}>
            If Claude asks how it should sign in, choose <strong>Sign in now</strong>; if it asks about the OAuth client, choose <strong>Register automatically</strong>.
            Leave the client ID and secret empty. Then press <strong>Add</strong>.
          </Step>
          <Step n={4}>
            Press <strong>Connect</strong>. Trendlix People opens: sign in if asked, read what Claude may do, and press <strong>Allow</strong>.
          </Step>
          <Step n={5}>
            In a chat, turn it on from <strong>+ → Connectors</strong>, then ask, e.g. “What does Mona hold?” or “Draft these three lenses from the photos”.
          </Step>
        </ol>
        <p className="text-sm text-muted">
          Any Claude plan can add a custom connector (the Free plan, one). It runs on your own Claude subscription: no API key, nothing billed to the company.
        </p>
      </section>

      <section aria-labelledby="can-heading" className="card space-y-3 p-5">
        <h2 id="can-heading" className="font-semibold">
          What Claude Can Do With Your Access
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {abilities.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <h3 className="pt-2 text-sm font-semibold">What It Can’t</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {cannot.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          The money (purchase cost, market and book value) is only for the CEO, Finance and a Super Admin, through Claude too. Every draft Claude saves is in the
          audit log as yours, via the Claude connector.
        </p>
      </section>

      <section aria-labelledby="tools-heading" className="card space-y-3 p-5">
        <h2 id="tools-heading" className="font-semibold">
          Its Tools
        </h2>
        <ul className="space-y-1.5 text-sm">
          {tools.map((t) => (
            <li key={t.name}>
              <span className="font-mono text-xs">{t.name}</span> · {t.summary}
            </li>
          ))}
        </ul>
        {can.register && (
          <p className="text-sm text-muted">
            A draft is not an asset: it waits on <Link href={ASSET_PATHS.drafts}>Drafts from Claude</Link> until someone reviews it on the Add form, adds its
            photos (they can’t come through Claude) and confirms it, when its code is given. Claude can add the maker’s product image from a link it finds,
            up to 3 a draft, labelled as a product image: it shows the model, not the item itself.
          </p>
        )}
      </section>

      <section aria-labelledby="end-heading" className="card space-y-2 p-5">
        <h2 id="end-heading" className="font-semibold">
          Ending It
        </h2>
        <p className="text-sm">
          The connection shows on <Link href="/account/sessions">Your Sessions</Link> as Claude connector, with Sign out. It also ends when your password
          changes or is reset, when your account is deactivated, or after 90 days without use; then press Connect again in Claude.
        </p>
      </section>
    </div>
  );
}

export default function ConnectClaudePage() {
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Connect Claude</h1>
        <p className="mt-1 text-muted">
          Add Trendlix People to your own Claude as a connector: Claude then reads the Assets section with your access, and drafts assets for you to confirm
          here.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Connect />
      </Suspense>
    </div>
  );
}
