import { TEMPLATE_SLOTS, TEMPLATE_VERSION_STATUS_LABELS } from '@trendlix/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { TemplateLine } from '@/lib/types';
import { Empty, Loading } from '../../../../../organization/ui';
import { mapTemplateFields } from '../../../../actions';
import { loadTemplate, loadVersionLines } from '../../../../data';
import { FieldMapper } from '../../../../field-mapper';
import { LANGUAGE_LABELS, managesTemplates, templateHref, versionPreviewHref } from '../../../../wording';

// Map Fields (owner's request, 15 October 2026: "I want a manual mapping fix"): HR and Admin place, change or remove the
// tags of one version of a template's Word file here, instead of in Word. Saving makes a new draft (the uploaded file
// never changes), which is checked and published on the template's page as usual. A draft or the version in use can
// be mapped; a replaced one can't (the API refuses it too). The API checks every change.

type Params = { slot: string; versionId: string };

/** Version ids in URLs; anything else gets the 404 page without asking the API. */
const ID = /^[0-9a-z-]{1,64}$/i;

function Breadcrumbs({ slotKey, name }: { slotKey: string; name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        <li>
          <Link href="/templates">Templates</Link>
        </li>
        <li>
          <span aria-hidden="true" className="text-muted">
            ›{' '}
          </span>
          <Link href={templateHref(slotKey)}>{titleCase(name)}</Link>
        </li>
        <li className="text-muted">
          <span aria-hidden="true">› </span>
          <span aria-current="page">Map Fields</span>
        </li>
      </ol>
    </nav>
  );
}

function HowTo({ version }: { version: number }) {
  return (
    <section aria-labelledby="how-to" className="card p-5">
      <h2 id="how-to" className="font-semibold">
        How It Works
      </h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>Click a tag to change it to another field or remove it, or click a dotted blank to put a field in its place.</li>
        <li>
          Use <strong>Add a field</strong> on a line to put a field at its end, in a blank, or after a word; or add the suggested fields.
        </li>
        <li>
          Nothing is saved until <strong>Save as a new draft</strong>. That makes a new draft from v{version} (the uploaded file stays as it is), which you then
          check and publish on the template&apos;s page.
        </li>
      </ol>
      <p className="hint">Only fields are put in, changed or removed here: the wording itself stays as it is in Word.</p>
    </section>
  );
}

async function MapFields({ params }: { params: Promise<Params> }) {
  const { slot: key, versionId } = await params;
  // The slots are a fixed list (packages/shared/src/templates.ts); a copy slot has no files of its own.
  const known = TEMPLATE_SLOTS.find((s) => s.key === key);
  if (!known || known.copyOf || !ID.test(versionId)) notFound();
  const user = await getCurrentUser();

  const heading = (details?: React.ReactNode) => (
    <div className="space-y-2">
      <Breadcrumbs slotKey={key} name={known.name} />
      <h1 className="text-2xl font-semibold">Map Fields</h1>
      {details}
    </div>
  );
  if (!managesTemplates(user)) {
    return (
      <>
        {heading()}
        <Empty>Only HR and Admin can map the fields of a template.</Empty>
      </>
    );
  }

  const [template, loaded] = await Promise.all([loadTemplate(key), loadVersionLines(versionId)]);
  if (loaded.kind !== 'ok') {
    return (
      <>
        {heading()}
        <Empty>
          {loaded.kind === 'unavailable'
            ? 'This version can’t be mapped: it is no longer there, or the server can’t map fields yet.'
            : loaded.kind === 'forbidden'
              ? 'Only HR and Admin can map the fields of a template.'
              : `The file’s lines couldn’t load: ${loaded.message}`}
        </Empty>
      </>
    );
  }
  const data = loaded.data;
  if (data.slotKey && data.slotKey !== key) notFound();

  const version = template.kind === 'ok' ? template.data.versions?.find((v) => v.id === versionId) : undefined;
  const name = template.kind === 'ok' ? template.data.name : known.name;
  // the arrays as the page needs them, also from an API that leaves an empty one out
  const lines: TemplateLine[] = (data.lines ?? []).map((l) => ({ ...l, text: l.text ?? '', tags: l.tags ?? [], blanks: l.blanks ?? [], suggestions: l.suggestions ?? [] }));
  const language = data.language ?? version?.language ?? 'en';
  // broken fragments ("{{ full_name_ar") have no place in the lines, so only Word can fix them
  const broken = [...new Set(version?.broken ?? [])];

  if (version?.status === 'retired') {
    return (
      <>
        {heading()}
        <Empty>
          v{version.version} was replaced, so its fields can&apos;t be mapped. Map the version in use or a newer draft, on the{' '}
          <Link href={templateHref(key)}>template&apos;s page</Link>.
        </Empty>
      </>
    );
  }

  return (
    <>
      {heading(
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-sm break-all text-muted">
            {titleCase(name)} · v{data.version}
            {version && (
              <>
                {' '}
                · {version.fileName} · {TEMPLATE_VERSION_STATUS_LABELS[version.status] ?? version.status}
              </>
            )}{' '}
            · {LANGUAGE_LABELS[language] ?? language}
          </p>
          {/* a plain link: never prefetched */}
          <a href={versionPreviewHref(versionId)} target="_blank" rel="noopener" className="text-sm font-semibold">
            Preview v{data.version} as a PDF<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>,
      )}
      <HowTo version={data.version} />
      {broken.length > 0 && (
        <div role="note" className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4 text-sm text-danger">
          <p>
            This version has {broken.length === 1 ? 'a broken tag' : `${broken.length} broken tags`}, which can&apos;t be fixed here: fix{' '}
            {broken.length === 1 ? 'it' : 'them'} in Word, then upload the file again.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {broken.map((fragment) => (
              <li key={fragment}>
                <code dir="auto" className="rounded-md border border-danger/30 bg-white px-1.5 py-0.5 font-mono text-xs break-all">
                  {fragment}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <FieldMapper lines={lines} language={language} version={data.version} action={mapTemplateFields.bind(null, key, versionId)} />
    </>
  );
}

export default function MapFieldsPage({ params }: { params: Promise<Params> }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <MapFields params={params} />
      </Suspense>
    </div>
  );
}
