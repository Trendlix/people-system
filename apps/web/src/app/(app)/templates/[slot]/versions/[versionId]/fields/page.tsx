import { TEMPLATE_SLOTS } from '@trendlix/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import type { TemplateVersion } from '@/lib/types';
import { BackLink, Empty, Loading } from '../../../../../organization/ui';
import { loadTemplate, loadTemplateFields } from '../../../../data';
import { isOfferSlot } from '../../../../preview-people';
import { isPdfVersion, managesTemplates, NOT_AVAILABLE, seesTemplates, templateHref, WHO_SEES } from '../../../../wording';
import { FieldEditor, type CopySource } from './field-editor';

// Place Fields (owner's decision, 15 October 2026): a PDF version of a template, with the fields placed on its pages.
// HR and Admin place and save them (field-editor.tsx); the CEO, and anyone on a replaced version, sees them, and can
// test print the form and preview it with data. The version must be one of this template's; the API checks every
// request, and the role again.

const ID = /^[0-9a-z-]{1,64}$/i;

/** A version the API says is a Word file. */
const isWord = (v: Pick<TemplateVersion, 'format'> | undefined) => !!v?.format && !isPdfVersion(v);

/** What the page says when it was reached straight after uploading a PDF draft (actions.ts). */
function uploadedNotice(query: Record<string, string | string[] | undefined>): string | null {
  const n = typeof query.uploaded === 'string' && /^\d{1,4}$/.test(query.uploaded) ? query.uploaded : null;
  return n ? `Draft v${n} uploaded. Place each field on the form, check it with Test print, then save. Publish it from the template's page.` : null;
}

async function Fields({ params, searchParams }: PageProps<'/templates/[slot]/versions/[versionId]/fields'>) {
  const { slot: key, versionId } = await params;
  // the slots are a fixed list (packages/shared/src/templates.ts); anything else gets the 404 page without asking the API
  const known = TEMPLATE_SLOTS.find((s) => s.key === key);
  if (!known || !ID.test(versionId)) notFound();
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const back = <BackLink href={templateHref(key)}>{known.name}</BackLink>;
  const quiet = (text: string) => (
    <div className="space-y-4">
      {back}
      <Empty>{text}</Empty>
    </div>
  );

  if (!seesTemplates(user)) return quiet(WHO_SEES);
  const [loaded, slot] = await Promise.all([loadTemplateFields(versionId), loadTemplate(key)]);
  const versions = slot.kind === 'ok' ? (slot.data.versions ?? []) : [];
  const listed = versions.find((v) => v.id === versionId);
  // a version of another template, reached with this one's address
  if (slot.kind === 'ok' && !listed) notFound();
  // a Word version has no fields to place (the API refuses them with a 409)
  if (isWord(listed) || (loaded.kind === 'ok' && isWord(loaded.data.version))) return quiet('This version is a Word file: its fields are the merge tags written in the file itself.');
  if (loaded.kind === 'unavailable') return quiet(NOT_AVAILABLE);
  if (loaded.kind === 'forbidden') return quiet(WHO_SEES);
  if (loaded.kind === 'failed') return quiet(`The fields couldn't load: ${loaded.message}`);

  const { version, pages, fields, editable } = loaded.data;
  const manages = managesTemplates(user);
  const readOnly = !manages
    ? 'Only HR and Admin can place fields. You can see them, test print the form and preview it with data.'
    : !editable
      ? 'This version was replaced, so its fields can no longer be changed. To change them, upload the form again as a new version.'
      : null;
  const pageCount = version.pageCount ?? pages.length;
  const copyFrom: CopySource[] = versions
    .filter((v) => v.id !== versionId && isPdfVersion(v) && (v.fieldCount ?? 0) > 0 && v.pageCount === pageCount)
    .map((v) => ({ id: v.id, version: v.version, fieldCount: v.fieldCount ?? 0 }));

  return (
    <div className="space-y-4">
      {back}
      <FieldEditor
        slotName={slot.kind === 'ok' ? slot.data.name : known.name}
        version={{ id: versionId, version: version.version, fileName: version.fileName, status: version.status, language: version.language }}
        pages={pages ?? []}
        fields={fields ?? []}
        canEdit={manages && editable}
        readOnly={readOnly}
        notice={uploadedNotice(query)}
        copyFrom={copyFrom}
        offers={isOfferSlot(key)}
      />
    </div>
  );
}

export default function FieldsPage(props: PageProps<'/templates/[slot]/versions/[versionId]/fields'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Fields {...props} />
    </Suspense>
  );
}
