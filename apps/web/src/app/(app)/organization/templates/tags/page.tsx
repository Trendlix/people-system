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
          <h2 className="text-lg font-semibold">Fields Guide</h2>
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
        <TagReference />
      </div>
    </SetupFrame>
  );
}
