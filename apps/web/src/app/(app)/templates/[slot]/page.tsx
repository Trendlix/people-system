import { TEMPLATE_SLOTS, TEMPLATE_VERSION_STATUS_LABELS, type TemplateSlot, type TemplateVersionStatus } from '@trendlix/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { formatDateTime, titleCase } from '@/lib/format';
import { PROTECTED_PDF_HINT } from '@/lib/protected-pdf';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser, TemplateDetail, TemplateVersion } from '@/lib/types';
import { formatSize } from '../../employees/paperwork';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { deleteTemplateVersion, publishTemplateVersion, uploadTemplateVersion } from '../actions';
import { loadTemplate } from '../data';
import { SlotDetails, StatusLines, Tag } from '../parts';
import { isOfferSlot, previewHint } from '../preview-people';
import { PreviewWithData } from '../preview-with-data';
import { checkTags, count, tagCount } from '../tag-check';
import { UploadTemplateForm } from '../upload-form';
import { DeleteDraftButton, PublishButton } from '../version-buttons';
import {
  COPY_NOTE,
  folderLabel,
  LANGUAGE_LABELS,
  managesTemplates,
  NOT_AVAILABLE,
  publishConfirm,
  seesTemplates,
  sourceName,
  statusLines,
  templateHref,
  versionFileHref,
  versionPreviewHref,
  WHO_SEES,
  OVERRIDES_NOTE,
} from '../wording';

// One template (spec §8): what it is and where it stands; for HR and Admin, uploading a new version of its Word file as
// a draft; the check of each draft's tags (unknown or broken ones block publishing), with Publish; and every version,
// to download (the CEO too). A version previewed with data is a protected PDF, never a Word file (owner's request, 15
// October 2026: "No doc file export, just a protected PDF"); the uploaded Word file itself stays HR's to download. A
// Super Admin can delete a draft. The API checks every request.

const none = <span className="text-muted">—</span>;

// ---------- the check of a draft ----------

function DraftCheck({ version: v, slotKey, inUse, manages }: { version: TemplateVersion; slotKey: string; inUse: number | null; manages: boolean }) {
  const check = checkTags(v);
  const label = `v${v.version}`;
  const nothing = !check.known.length && !check.unknown.length && !check.broken.length;
  return (
    <section id={`draft-${v.id}`} aria-labelledby={`draft-${v.id}-title`} className="card scroll-mt-6 space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`draft-${v.id}-title`} className="font-semibold">
            Check of Draft v{v.version}
          </h3>
          <p className="mt-0.5 text-sm break-all text-muted">
            {v.fileName} · {LANGUAGE_LABELS[v.language] ?? v.language} · uploaded {formatDateTime(v.uploadedAt)}
            {v.uploadedBy?.email && <> by {v.uploadedBy.email}</>}
          </p>
          {v.note && <p className="mt-1 text-sm whitespace-pre-line">What changed: {v.note}</p>}
        </div>
        <span className="badge bg-warn-soft text-warn">{TEMPLATE_VERSION_STATUS_LABELS.draft}</span>
      </div>

      {nothing && <p className="text-sm text-muted">No merge tags were found in this file: documents made from it will be the file exactly as it is.</p>}

      {check.unknown.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
          <h4 className="text-sm font-semibold text-danger">Unknown Tags ({check.unknown.length})</h4>
          <p className="mt-1 text-sm text-danger">Not in the tag list: fix the spelling in Word or remove it.</p>
          <ul className="mt-3 space-y-2">
            {check.unknown.map(({ tag, suggestion }) => (
              <li key={tag} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <Tag tag={tag} tone="danger" />
                {suggestion ? (
                  <span>
                    Did you mean <Tag tag={suggestion} />?
                  </span>
                ) : (
                  <span className="text-muted">No close match in the tag list.</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {check.broken.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
          <h4 className="text-sm font-semibold text-danger">Broken Tags ({check.broken.length})</h4>
          <p className="mt-1 text-sm text-danger">
            These look like tags but aren&apos;t: each tag needs two braces on each side, {'{{like_this}}'}, with only the tag&apos;s name between them.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {check.broken.map((fragment) => (
              <li key={fragment}>
                <code dir="auto" className="rounded-md border border-danger/30 bg-white px-1.5 py-0.5 font-mono text-xs break-all text-danger">
                  {fragment}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {check.known.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">Known Tags ({check.known.length})</h4>
          <ul className="mt-2 divide-y divide-line-soft">
            {check.known.map((t) => (
              <li key={t.tag} className="grid gap-x-4 gap-y-1 py-2 text-sm sm:grid-cols-[minmax(12rem,auto)_1fr_1fr_auto] sm:items-center">
                <span>
                  <Tag tag={t.tag} />
                </span>
                <span>{t.labelEn}</span>
                <span lang="ar" dir="rtl" className="sm:text-right">
                  {t.labelAr}
                </span>
                <span>{t.restricted ? <span className="badge bg-warn-soft text-warn">Restricted</span> : null}</span>
              </li>
            ))}
          </ul>
          {check.known.some((t) => t.restricted) && (
            <p className="hint">Restricted: national ID, salary or bank data. Only those who may see it can make a document with it.</p>
          )}
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* a plain link: never prefetched */}
          <a href={versionPreviewHref(v.id)} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center text-sm font-semibold">
            Preview<span className="sr-only"> draft v{v.version} ({v.fileName}) as a PDF, in a new tab</span>
          </a>
          <PreviewWithData versionId={v.id} label={`draft v${v.version} (${v.fileName})`} align="start" offers={isOfferSlot(slotKey)} />
        </div>
        <p className="hint">{previewHint(slotKey)}</p>
      </div>

      {manages && (
        <PublishButton
          action={publishTemplateVersion.bind(null, slotKey, v.id, v.version)}
          confirmText={publishConfirm(v.version, inUse)}
          blocked={check.blocked}
          label={label}
        />
      )}
    </section>
  );
}

// ---------- the versions ----------

const STATUS_STYLE: Record<TemplateVersionStatus, string> = {
  draft: 'bg-warn-soft text-warn',
  published: 'bg-ok-soft text-ok',
  retired: 'bg-line-soft text-muted',
};

function Who({ email, at }: { email: string | null | undefined; at: string | null }) {
  if (!at) return none;
  return (
    <>
      <span className="block whitespace-nowrap">{formatDateTime(at)}</span>
      {email && <span className="block text-xs break-all text-muted">{email}</span>}
    </>
  );
}

function VersionRow({ version: v, slotKey, deletes }: { version: TemplateVersion; slotKey: string; deletes: boolean }) {
  const check = v.status === 'draft' ? checkTags(v) : null;
  const problems = check ? check.unknown.length + check.broken.length : 0;
  // the actions go on a line of their own under the version, so the table fits without scrolling sideways and the
  // version number stays in sight (owner, 15 October 2026: v2 was deleted instead of v1, the number scrolled away)
  return (
    <>
    <tr className="[&>td]:border-b-0">
      <td className="font-semibold tabular-nums">v{v.version}</td>
      <td className="max-w-64 break-all">
        {v.fileName}
        <span className="block text-xs whitespace-nowrap text-muted tabular-nums">{formatSize(v.sizeBytes)}</span>
      </td>
      <td>{LANGUAGE_LABELS[v.language] ?? v.language}</td>
      <td>
        <span className={`badge ${STATUS_STYLE[v.status] ?? ''}`}>{TEMPLATE_VERSION_STATUS_LABELS[v.status] ?? v.status}</span>
      </td>
      <td>
        <Who email={v.uploadedBy?.email} at={v.uploadedAt} />
      </td>
      <td>
        <Who email={v.publishedBy?.email} at={v.publishedAt} />
      </td>
      <td className="min-w-40 whitespace-pre-line">{v.note || none}</td>
      <td className="tabular-nums">
        {tagCount(v)}
        {problems > 0 && (
          <a href={`#draft-${v.id}`} className="block text-xs whitespace-nowrap text-danger">
            {count(problems, 'problem')}
          </a>
        )}
      </td>
    </tr>
    <tr>
      <td colSpan={8} className="pt-0">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="text-xs font-semibold text-muted">v{v.version}:</span>
          {/* plain links: never prefetched */}
          <a href={versionPreviewHref(v.id)} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center text-sm font-semibold">
            Preview<span className="sr-only"> v{v.version} ({v.fileName}) as a PDF, in a new tab</span>
          </a>
          <PreviewWithData versionId={v.id} label={`v${v.version} (${v.fileName})`} offers={isOfferSlot(slotKey)} />
          <a href={versionFileHref(v.id)} className="inline-flex min-h-9 items-center text-sm font-semibold">
            Download<span className="sr-only"> v{v.version} ({v.fileName})</span>
          </a>
          {/* a Super Admin deletes any version nothing was made from (owner, 15 October 2026) */}
          {deletes && v.usedBy === 0 && (
            <DeleteDraftButton
              action={deleteTemplateVersion.bind(null, slotKey, v.id, v.version)}
              label={v.status === 'draft' ? `draft v${v.version}` : `v${v.version}`}
              confirmText={
                v.status === 'published'
                  ? `Delete v${v.version} (${v.fileName})? It is the version in use: until another version is published, no document can be made from this template. This can't be undone.`
                  : `Delete v${v.version} (${v.fileName})? This can't be undone.`
              }
            />
          )}
        </div>
      </td>
    </tr>
    </>
  );
}

function VersionsTable({ versions, slotKey, deletes }: { versions: TemplateVersion[]; slotKey: string; deletes: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <caption className="sr-only">Versions of the template, newest first</caption>
        <thead>
          <tr>
            <th>Version</th>
            <th>File</th>
            <th>Language</th>
            <th>Status</th>
            <th>Uploaded</th>
            <th>Published</th>
            <th>What Changed</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <VersionRow key={v.id} version={v} slotKey={slotKey} deletes={deletes} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- the page ----------

/** What the page says after Publish or Delete brought the browser back here. */
function doneMessage(query: Record<string, string | string[] | undefined>): string | null {
  const n = (key: string) => (typeof query[key] === 'string' && /^\d{1,4}$/.test(query[key]) ? query[key] : null);
  const published = n('published');
  if (published) return `v${published} is now in use: new documents are made from it. Documents made earlier keep the version they were made with.`;
  const deleted = n('deleted');
  if (deleted) return `Version ${deleted} deleted.`;
  return null;
}

function Body({ detail, user }: { detail: TemplateDetail; user: SessionUser }) {
  const manages = managesTemplates(user);
  if (detail.copyOf) {
    const overrides = Object.entries(detail.overrides ?? {});
    return (
      <section className="card space-y-3 p-6">
        <p className="text-sm">
          {COPY_NOTE} <Link href={templateHref(detail.copyOf)}>{sourceName(detail.copyOf)}</Link>
        </p>
        {overrides.length > 0 && (
          <ul className="space-y-1 text-sm">
            {overrides.map(([tag, reads]) => (
              <li key={tag} className="flex flex-wrap items-center gap-2">
                <Tag tag={tag} /> <span className="text-muted">reads</span> <Tag tag={reads} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const versions = detail.versions ?? [];
  const drafts = versions.filter((v) => v.status === 'draft');
  const inUse = detail.published?.version ?? versions.find((v) => v.status === 'published')?.version ?? null;
  return (
    <div className="space-y-8">
      {Object.keys(detail.overrides ?? {}).length > 0 && <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">{OVERRIDES_NOTE}</p>}
      {manages && (
        <section id="upload" className="card scroll-mt-6 p-6">
          <UploadTemplateForm action={uploadTemplateVersion.bind(null, detail.key)} language={detail.language} hasFile={versions.length > 0} />
        </section>
      )}

      {drafts.length > 0 && (
        <section aria-labelledby="drafts" className="space-y-4">
          <div>
            <h2 id="drafts" className="text-lg font-semibold">
              {drafts.length === 1 ? 'Draft to Check' : 'Drafts to Check'}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {manages
                ? 'Check the tags found in the file, then publish it. Unknown or broken tags must be fixed in Word first, and the file uploaded again.'
                : 'HR or an Admin checks the tags found in the file, then publishes it.'}
            </p>
          </div>
          {drafts.map((v) => (
            <DraftCheck key={v.id} version={v} slotKey={detail.key} inUse={inUse} manages={manages} />
          ))}
        </section>
      )}

      <section aria-labelledby="versions" className="space-y-3">
        <div>
          <h2 id="versions" className="text-lg font-semibold">
            Versions
          </h2>
          <p className="mt-1 text-sm text-muted">
            New documents are made from the version in use. A newer published version replaces it; documents made earlier keep the version they were made
            with.
          </p>
          {versions.length > 0 && (
            <p className="hint">
              {previewHint(detail.key)} {PROTECTED_PDF_HINT}
            </p>
          )}
        </div>
        {versions.length === 0 ? <Empty>No file yet.</Empty> : <VersionsTable versions={versions} slotKey={detail.key} deletes={canDelete(user)} />}
      </section>
    </div>
  );
}

async function Template({ params, searchParams }: PageProps<'/templates/[slot]'>) {
  const { slot: key } = await params;
  // The slots are a fixed list (packages/shared/src/templates.ts); anything else gets the 404 page without asking the API.
  const known = TEMPLATE_SLOTS.find((s) => s.key === key);
  if (!known) notFound();
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);

  const header = (slot: Pick<TemplateSlot, 'name' | 'folder' | 'language' | 'appliesTo' | 'triggers' | 'signers'>, status?: React.ReactNode) => (
    <div className="card space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{folderLabel(slot.folder)}</p>
          <h1 className="mt-1 text-2xl font-semibold">{titleCase(slot.name)}</h1>
        </div>
        {status}
      </div>
      <SlotDetails slot={slot} />
    </div>
  );

  if (!seesTemplates(user)) {
    return (
      <div className="space-y-6">
        {header(known)}
        <Empty>{WHO_SEES}</Empty>
      </div>
    );
  }
  const loaded = await loadTemplate(key);
  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-6">
        {header(known)}
        {loaded.kind === 'unavailable' ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{NOT_AVAILABLE}</p>
        ) : (
          <Empty>{loaded.kind === 'forbidden' ? WHO_SEES : `The template couldn't load: ${loaded.message}`}</Empty>
        )}
      </div>
    );
  }

  const detail = loaded.data;
  const done = doneMessage(query);
  return (
    <div className="space-y-6">
      {header(detail, detail.copyOf ? undefined : <StatusLines lines={statusLines(detail)} />)}
      {done && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {done}
        </p>
      )}
      <Body detail={detail} user={user} />
    </div>
  );
}

export default function TemplatePage(props: PageProps<'/templates/[slot]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/templates">Templates</BackLink>
      <Suspense fallback={<Loading />}>
        <Template {...props} />
      </Suspense>
    </div>
  );
}
