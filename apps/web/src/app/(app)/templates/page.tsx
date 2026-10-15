import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import type { TemplateSlotView } from '@/lib/types';
import { Empty, Loading } from '../organization/ui';
import { loadLibrary } from './data';
import { SlotDetails, StatusLines } from './parts';
import { byFolder, COPY_NOTE, folderLabel, OVERRIDES_NOTE, managesTemplates, NOT_AVAILABLE, progress, seesTemplates, sourceName, statusLines, templateHref, uploadLabel, WHO_SEES } from './wording';
import { titleCase } from '@/lib/format';

// The template library (spec §8, owner's request of 15 October 2026): one slot per document, by folder, each with where
// it stands and Upload. HR and Admin (a Super Admin too) upload and publish; the CEO views. Filling templates in for an
// employee comes next. The API checks every request.

function SlotCard({ slot, slots, manages }: { slot: TemplateSlotView; slots: TemplateSlotView[]; manages: boolean }) {
  const copy = slot.copyOf;
  return (
    <li className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-3">
        <h3 className="font-semibold">
          <Link href={templateHref(slot.key)}>{titleCase(slot.name)}</Link>
        </h3>
        <SlotDetails slot={slot} />
        {!copy && Object.keys(slot.overrides ?? {}).length > 0 && <p className="text-sm text-muted">{OVERRIDES_NOTE}</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-3 sm:w-72 sm:items-end sm:text-right">
        {copy ? (
          <p className="text-sm text-muted">
            {COPY_NOTE} <Link href={templateHref(copy)}>{sourceName(copy, slots)}</Link>
          </p>
        ) : (
          <>
            <StatusLines lines={statusLines(slot)} />
            {manages && (
              <Link href={`${templateHref(slot.key)}#upload`} className={`btn ${slot.published ? 'btn-secondary' : 'btn-primary'}`}>
                {uploadLabel(slot)}
                <span className="sr-only">: {slot.name}</span>
              </Link>
            )}
          </>
        )}
      </div>
    </li>
  );
}

async function Library() {
  const user = await getCurrentUser();
  if (!seesTemplates(user)) return <Empty>{WHO_SEES}</Empty>;
  const loaded = await loadLibrary();
  if (loaded.kind === 'unavailable') return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{NOT_AVAILABLE}</p>;
  if (loaded.kind === 'forbidden') return <Empty>{WHO_SEES}</Empty>;
  if (loaded.kind === 'failed') return <Empty>The templates couldn&apos;t load: {loaded.message}</Empty>;

  const slots = loaded.data;
  const manages = managesTemplates(user);
  const done = progress(slots);
  return (
    <div className="space-y-8">
      <p className={`text-sm font-medium ${done.inUse === done.total ? 'text-ok' : 'text-ink'}`}>
        {done.text}
        {done.inUse < done.total && <span className="font-normal text-muted"> · each one needs its Word file uploaded and published</span>}
      </p>
      {byFolder(slots).map(({ folder, slots: inFolder }) => (
        <section key={folder} aria-labelledby={`folder-${folder}`} className="space-y-3">
          <h2 id={`folder-${folder}`} className="text-lg font-semibold">
            {folderLabel(folder)} <span className="text-sm font-normal text-muted tabular-nums">({inFolder.length})</span>
          </h2>
          <ul className="space-y-3">
            {inFolder.map((slot) => (
              <SlotCard key={slot.key} slot={slot} slots={slots} manages={manages} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Templates</h1>
      <p className="mt-1 max-w-3xl text-muted">
        Upload each Word file exactly as you use it today, with merge tags like <code className="font-mono text-sm">{'{{full_name_ar}}'}</code> where the data
        goes. The system only fills in the tags. The tags you can use are in the <Link href="/templates/tags">tag reference</Link>.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Library />
        </Suspense>
      </div>
    </div>
  );
}
