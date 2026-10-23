import { SetupFrame } from '../../setup-menu';
import { BackLink } from '../../ui';
import { FIELDS_GUIDE_DOCX_HREF, FIELDS_GUIDE_PDF_HREF, TEMPLATES_PATH } from '../wording';
import { TagReference } from './tag-reference';

// The Fields Guide (spec §8; owner's request, 15 October 2026), for whoever writes templates in Word: every merge tag a
// template may use (TEMPLATE_TAGS in @trendlix/shared), by group, with a Copy button, and the same guide as a document
// to download (Word, or a PDF in a new tab), which the API makes from the same list. Any other {{tag}} stops a version
// from being published. The list is the same for everyone and holds no one's data.

export default function TagsPage() {
  return (
    <SetupFrame active="templates">
      <div className="space-y-6">
        <BackLink href={TEMPLATES_PATH}>Templates</BackLink>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Fields Guide</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              The fields a template can use, as merge tags. Type a tag in the Word file where its value goes, braces included, e.g.{' '}
              <code className="font-mono text-sm">{'{{full_name_ar}}'}</code>; when a document is made, the system puts the employee&apos;s data in its place. A
              tag that isn&apos;t listed here stops the file from being published.
            </p>
          </div>
          {/* plain links: the files are made on request, never prefetched */}
          <div className="flex shrink-0 flex-wrap gap-3">
            <a href={FIELDS_GUIDE_DOCX_HREF} className="btn btn-secondary">
              Download as Word
            </a>
            <a href={FIELDS_GUIDE_PDF_HREF} target="_blank" rel="noopener" className="btn btn-secondary">
              Download as PDF<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
        <section aria-labelledby="typing-tags" className="card max-w-3xl p-5">
          <h2 id="typing-tags" className="font-semibold">
            Typing Tags in Word
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>
              Tags are case-sensitive: type them exactly as listed, in small letters (<code className="font-mono text-xs">{'{{full_name_ar}}'}</code>, not{' '}
              <code className="font-mono text-xs">{'{{Full_Name_AR}}'}</code>).
            </li>
            <li>
              Type each tag in one go, without changing its formatting halfway through (bold, a colour or another font in the middle of a tag). The system copes
              when Word splits a tag, but one typed in one go is the surest.
            </li>
            <li>Dates come as DD/MM/YYYY (14/10/2026) unless the tag&apos;s note says otherwise.</li>
            <li>Restricted tags hold national ID, salary or bank data: only those who may see that data can make a document that uses them.</li>
          </ul>
        </section>
        <TagReference />
      </div>
    </SetupFrame>
  );
}
