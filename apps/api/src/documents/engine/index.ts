// Filling a Word template in (spec §8): the published .docx with its {{tags}} replaced by the employee's values, the
// wording untouched, and the Arabic words the values need. The documents module calls only these.
//
//   fillTemplate(template: Buffer, values: Readonly<Record<string, string>>): Buffer      fill.ts
//   arabicAmountInWords(amount: number): string                                          arabic.ts
//   arabicDuration(months: number): string                                               arabic.ts
//   arabicWeekday(date: string): string                                                  arabic.ts

export { fillTemplate } from './fill.js';
export { arabicAmountInWords, arabicDuration, arabicWeekday } from './arabic.js';
