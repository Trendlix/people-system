import { BackLink } from '../../organization/ui';
import { TagReference } from './tag-reference';

// The tag reference (spec §8), for whoever writes templates in Word: every merge tag a template may use (TEMPLATE_TAGS
// in @trendlix/shared), by group, with a Copy button. Any other {{tag}} stops a version from being published. The list
// is the same for everyone and holds no one's data.

export default function TagsPage() {
  return (
    <div className="space-y-6">
      <BackLink href="/templates">Templates</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Tag Reference</h1>
        <p className="mt-1 max-w-3xl text-muted">
          The merge tags a template can use. Type a tag in the Word file where its value goes, braces included, e.g.{' '}
          <code className="font-mono text-sm">{'{{full_name_ar}}'}</code>; when a document is made, the system puts the employee&apos;s data in its place. A tag
          that isn&apos;t listed here stops the file from being published.
        </p>
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
  );
}
