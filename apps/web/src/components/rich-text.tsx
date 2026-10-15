import { sanitizeRichText } from '@/lib/rich-text';

/**
 * Rich text as it was written in the editor (rich-text-editor.tsx): bold, italic, underline, lists and indents, styled
 * by `.rich-text` in globals.css. The API cleans the HTML when it saves it; it is cleaned again here before it is shown.
 */
export function RichText({ html }: { html: string }) {
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }} />;
}
