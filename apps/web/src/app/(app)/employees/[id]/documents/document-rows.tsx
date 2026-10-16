import Link from 'next/link';
import { DocumentViewer, VIEW_BUTTON } from '@/components/document-viewer';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { pdfFileName, PROTECTED_PDF_HINT } from '@/lib/protected-pdf';
import type { DocumentItem, EmployeeProfile, GeneratedDocument, GeneratedDocumentStatus } from '@/lib/types';
import { contractHref, Loading, ProfileSection, todayInCairo } from '../../ui';
import { ActionButton } from '../contracts/contract-buttons';
import { loadDocuments } from './data';
import { checkDocument, deleteDocument, generateDocument, markPrinted, uploadSignedCopy, verifyDocument } from './document-actions';
import { GenerateDocument, UploadSignedCopy } from './document-forms';
import {
  contractGroups,
  contractGroupTitle,
  employmentTabSections,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_TONE,
  documentDownloadHref,
  documentESignHref,
  documentFileHref,
  inputsText,
  itemContext,
  itemTemplateHref,
  newestFirst,
  nextSteps,
  NOT_AVAILABLE,
  progressSteps,
  sectionTitle,
  signedFileHref,
  signedMimeType,
  signersText,
  templateStateText,
  type Tone,
} from './wording';

// The documents generated from templates, on the profile's Employment tab, Issued Documents (its own sub-tab, owner's
// choice, 17 October 2026): per contract version its documents (the official and social insurance copies), then
// Hiring, Letters & Certificates and Leaving. Social insurance Forms 1 and 6 are listed the same way on the Social
// Insurance tab (owner's request, 16 October 2026). Each item says where its
// template stands; HR generates it (after a check of what it needs) and takes each document through Generated → Printed
// → Signed copy uploaded → Verified; the CEO views and downloads; a Super Admin deletes. A document is opened and saved
// only as a protected PDF, never as a Word file (owner's request, 15 October 2026: "No doc file export, just a protected
// PDF").

export type DocumentEmployee = Pick<EmployeeProfile, 'id' | 'fullNameEn' | 'employment' | 'access'>;
type Employee = DocumentEmployee;

/** What the caller may do: `act` (HR) generate and move documents along, `delete` (a Super Admin) delete them. */
export type DocumentAccess = { act: boolean; delete: boolean };

const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', accent: 'text-accent', muted: 'text-muted' };
const TONE_BADGE: Record<Tone, string> = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', accent: '', muted: 'bg-line-soft text-muted' };

function StatusPill({ status }: { status: GeneratedDocumentStatus }) {
  return <span className={`badge ${TONE_BADGE[DOCUMENT_STATUS_TONE[status]] ?? ''}`}>{DOCUMENT_STATUS_LABELS[status] ?? status}</span>;
}

/** Generated → Printed → Signed copy uploaded → Verified: each step done (when, and who) or not yet. */
function Progress({ document: d }: { document: GeneratedDocument }) {
  return (
    <ol aria-label="Progress" className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {progressSteps(d).map((step) => (
        <li key={step.key} className={step.at ? 'text-ink' : 'text-muted'}>
          <span aria-hidden="true">{step.at ? '✓ ' : '○ '}</span>
          <span className="font-medium">{step.label}</span>
          {step.at ? (
            <span className="tabular-nums">
              {' '}
              {formatDateTime(step.at)}
              {step.by && ` by ${step.by}`}
            </span>
          ) : (
            <span> · not yet</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** One generated document: its status, file and progress; Preview (PDF), Download PDF and PDF for e-signature until the signed copy is uploaded, then View signed copy; HR's next step; Delete. */
function DocumentLine({ document: d, item, employee, can }: { document: GeneratedDocument; item: DocumentItem; employee: Employee; can: DocumentAccess }) {
  const steps = nextSteps(d.status);
  const what = `${item.name}, generated ${formatDate(d.generatedAt)}`;
  const signers = signersText(item.slotKey);
  const hasSigned = Boolean(d.signedFileName || d.signedUploadedAt);
  const typed = inputsText(d.inputs);
  return (
    <li className="space-y-2 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusPill status={d.status} />
        <span className="text-sm">
          Dated <span className="tabular-nums">{formatDate(d.documentDate)}</span>
        </span>
        <span className="text-xs break-all text-muted">
          {/* the PDF it is given out as; the size of the Word file it is kept as would not be the PDF's */}
          <bdi>{pdfFileName(d.fileName)}</bdi> · template v{d.templateVersion}
        </span>
      </div>
      {typed && <p className="text-sm break-words">{typed}</p>}
      <Progress document={d} />
      {d.note && <p className="text-sm text-muted">{d.note}</p>}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* once the signed copy is uploaded, it is the document: the generated file is no longer offered (owner, 15
            October 2026) */}
        {/* plain links, never prefetched: the web server fetches the file from the API with the session */}
        {!hasSigned && (
          <a href={documentFileHref(employee.id, d.id)} target="_blank" rel="noopener" className={`${VIEW_BUTTON} text-accent`}>
            Preview (PDF)<span className="sr-only"> ({what}), in a new tab</span>
          </a>
        )}
        {!hasSigned && (
          <a href={documentDownloadHref(employee.id, d.id)} className={`${VIEW_BUTTON} text-accent`}>
            Download PDF<span className="sr-only"> ({what})</span>
          </a>
        )}
        {/* HR only: Adobe Sign and DocuSign refuse the protected PDF (owner, 15 October 2026); every download is recorded */}
        {can.act && !hasSigned && (
          <a
            href={documentESignHref(employee.id, d.id)}
            title="Unprotected, to upload to Adobe Sign or DocuSign. Every download is recorded."
            className={`${VIEW_BUTTON} text-accent`}
          >
            PDF for e-signature<span className="sr-only"> ({what}): unprotected, to upload to Adobe Sign or DocuSign; every download is recorded</span>
          </a>
        )}
        {hasSigned && (
          <DocumentViewer
            title={`Signed Copy · ${item.name} · ${employee.fullNameEn}`}
            files={[{ alt: `The signed copy of ${item.name}`, src: signedFileHref(employee.id, d.id), mimeType: signedMimeType(d) }]}
          >
            View signed copy<span className="sr-only"> ({what})</span>
          </DocumentViewer>
        )}
        {can.act && steps.print && (
          <ActionButton action={markPrinted.bind(null, d.id)} pendingText="Saving…">
            Mark printed<span className="sr-only"> ({what})</span>
          </ActionButton>
        )}
        {can.act && steps.verify && (
          <ActionButton
            action={verifyDocument.bind(null, d.id)}
            pendingText="Verifying…"
            variant="primary"
            confirmText={`Verify the signed copy of ${what}? Check first that every page is there${signers ? ` and that it is signed by ${signers}` : ''}.`}
          >
            Verify<span className="sr-only"> ({what})</span>
          </ActionButton>
        )}
        {can.delete && (
          <ActionButton
            action={deleteDocument.bind(null, d.id)}
            pendingText="Deleting…"
            variant="danger"
            confirmText={`Delete ${what}${hasSigned ? ', with its signed copy' : ''}? This cannot be undone.`}
          >
            Delete<span className="sr-only"> ({what})</span>
          </ActionButton>
        )}
        {/* last, so that its form opens across the row */}
        {can.act && (steps.upload || steps.reupload) && (
          <UploadSignedCopy action={uploadSignedCopy.bind(null, d.id)} name={item.name} again={steps.reupload} />
        )}
      </div>
    </li>
  );
}

/** One document the employee may be given: what it is, where its template stands, Generate, then what was generated. */
function ItemRow({ item, employee, can, today }: { item: DocumentItem; employee: Employee; can: DocumentAccess; today: string }) {
  const context = itemContext(item);
  const template = templateStateText(item);
  const documents = newestFirst(item.documents ?? []);
  const published = item.templateStatus === 'published';
  return (
    <li className="space-y-3 border-b border-line-soft p-5 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h4 className="font-semibold">{titleCase(item.name)}</h4>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
            {context && <span className="text-muted">{context} ·</span>}
            <span className={`font-medium ${TONE_TEXT[template.tone]}`}>{template.text}</span>
            {can.act && !published && (
              <Link href={itemTemplateHref(item)} className="font-semibold">
                {item.templateStatus === 'missing' ? 'Upload it in Templates' : 'Open the template'}
                <span className="sr-only"> for {item.name}</span>
              </Link>
            )}
          </p>
        </div>
        {can.act && published && (
          <GenerateDocument
            check={checkDocument.bind(null, employee.id, item.slotKey, item.contractId ?? null)}
            generate={generateDocument.bind(null, employee.id, { slotKey: item.slotKey, contractId: item.contractId ?? null, needsInputs: item.needsInputs ?? [] })}
            name={context ? `${item.name} (${context})` : item.name}
            needsInputs={item.needsInputs ?? []}
            today={today}
            again={documents.length > 0}
          />
        )}
      </div>
      {documents.length > 0 ? (
        <ul className="space-y-3">
          {documents.map((d) => (
            <DocumentLine key={d.id} document={d} item={item} employee={employee} can={can} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not generated yet.</p>
      )}
    </li>
  );
}

/** Documents the employee may be given, one row each; `today` (DD/MM/YYYY) is the date Generate starts with. */
export function DocumentItems({ items, employee, can, today }: { items: DocumentItem[]; employee: Employee; can: DocumentAccess; today: string }) {
  return (
    <ul className="card">
      {items.map((item) => (
        <ItemRow key={`${item.slotKey}-${item.contractId ?? ''}`} item={item} employee={employee} can={can} today={today} />
      ))}
    </ul>
  );
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <ProfileSection title="Contract Documents">
      <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{children}</p>
    </ProfileSection>
  );
}

export function GeneratedDocumentsLoading() {
  return (
    <ProfileSection title="Contract Documents">
      <Loading />
    </ProfileSection>
  );
}

/** The Employment tab's Issued Documents, part by part (HR and the CEO). */
export async function GeneratedDocuments({ employee, can }: { employee: Employee; can: DocumentAccess }) {
  const load = await loadDocuments(employee.id);
  if (load.kind === 'forbidden') return null;
  if (load.kind === 'unavailable') {
    return (
      <Unavailable>
        {NOT_AVAILABLE} Documents generated from the templates (the contract copies, the job offer and NDA, letters and certificates, and the
        leaving papers) will be listed here.
      </Unavailable>
    );
  }
  if (load.kind === 'failed') return <Unavailable>The documents could not be loaded. Please try again in a moment.</Unavailable>;

  const today = formatDate(todayInCairo());
  // social insurance has its own tab
  const listed = employmentTabSections(load.tab.sections);
  if (!listed.some((s) => s.items.length > 0)) {
    return <Unavailable>No documents apply to {employee.fullNameEn} yet: they follow the employment and its contract.</Unavailable>;
  }
  const sections = listed.filter((s) => s.key === 'contract' || s.items.length > 0);
  // said once, under the first part, once there is a document to open
  const anyDocument = listed.some((s) => s.items.some((i) => (i.documents ?? []).length > 0));

  return (
    <>
      {sections.map((section) => {
        if (section.key === 'contract') {
          const groups = contractGroups(section.items);
          return (
            // first, where #contract-documents (the Issued Documents sub-tab around it) lands
            <ProfileSection key={section.key} title={sectionTitle(section.key)} note="Generated from the templates for each contract version, to print and sign">
              {groups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
                  No contract version to generate documents for yet.
                  {can.act && employee.employment && (
                    <>
                      {' '}
                      Add the contract first, on <Link href={contractHref(employee.id)}>Details</Link>.
                    </>
                  )}
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.contractId} className="space-y-2">
                    <h3 className="text-sm font-semibold">{contractGroupTitle(group)}</h3>
                    <DocumentItems items={group.items} employee={employee} can={can} today={today} />
                  </div>
                ))
              )}
              {anyDocument && <p className="text-xs text-muted">{PROTECTED_PDF_HINT}</p>}
            </ProfileSection>
          );
        }
        return (
          <ProfileSection key={section.key} title={sectionTitle(section.key)}>
            <DocumentItems items={section.items} employee={employee} can={can} today={today} />
          </ProfileSection>
        );
      })}
    </>
  );
}
