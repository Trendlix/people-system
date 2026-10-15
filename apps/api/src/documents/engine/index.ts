// Filling a Word template in (spec §8): the published .docx with its {{tags}} replaced by the employee's values, the
// wording untouched, and the Arabic words the values need. The documents module calls only these; the template
// library's Map Fields (owner's request, 15 October 2026) reads and changes paragraphs' text with the last two.
//
//   fillTemplate(template: Buffer, values: Readonly<Record<string, string>>): Buffer      fill.ts
//   arabicAmountInWords(amount: number): string                                          arabic.ts
//   arabicDuration(months: number): string                                               arabic.ts
//   arabicWeekday(date: string): string                                                  arabic.ts
//   readParagraphs(xml: string): Paragraph[]                                             paragraphs.ts
//   editText(xml: string, edits: readonly TextEdit[]): string                            edit.ts

export { fillTemplate } from './fill.js';
export { arabicAmountInWords, arabicDuration, arabicWeekday } from './arabic.js';
export { readParagraphs, type Paragraph } from './paragraphs.js';
export { editText, type TextEdit } from './edit.js';
