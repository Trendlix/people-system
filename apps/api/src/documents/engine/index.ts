// Filling a Word template in (spec §8): the published .docx with its {{tags}} replaced by the employee's values, the
// wording untouched, and the Arabic words the values need. The documents module calls only these.
//
//   fillTemplate(template: Buffer, values: Readonly<Record<string, TagValue>>): Buffer     fill.ts
//   TagValue: string | RichValue ({ html }: a value with formatting)                       rich.ts
//   valueText(value: TagValue): string, isBlankValue(value: TagValue): boolean             rich.ts
//   arabicAmountInWords(amount: number): string                                            arabic.ts
//   arabicDuration(months: number): string                                                 arabic.ts
//   arabicMonths(months: number): string                                                   arabic.ts
//   arabicWeekday(date: string): string                                                    arabic.ts
//   arabicDayName(day: number): string                                                     arabic.ts

export { fillTemplate } from './fill.js';
export { isBlankValue, valueText, type RichValue, type TagValue } from './rich.js';
export { arabicAmountInWords, arabicDayName, arabicDuration, arabicMonths, arabicWeekday } from './arabic.js';
