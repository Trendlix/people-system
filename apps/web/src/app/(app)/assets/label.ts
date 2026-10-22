// An asset's label (spec §5: "labels (A4, 3 × 8 labels of 63 × 30 mm: QR to https://people.trendlix.com/assets/{code},
// the code, the name, the company name; after printing set labeled_at)"). Step 1 prints one label (owner's brief, 21
// October 2026: "print label (single label)"); the A4 sheets of 24 come with step 5. The label is a document of its own,
// 63 × 30 mm, printed from a frame in the page, so the site's sidebar and buttons never print with it: the QR code on
// the left, the code, the name (two lines at most) and the company's name on the right. Pure code, tested.

import { LABEL_SHEET, labelSheetSlots } from '@trendlix/shared';

export const LABEL_SIZE = { widthMm: 63, heightMm: 30 } as const;

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** What a label shows. `qrSvg`: the QR code's SVG, drawn by the server (lib/asset-qr.ts). */
export interface LabelContent {
  code: string;
  name: string;
  company: string;
  qrSvg: string;
}

/** The label's own styles: in the page (the preview) and in the document printed. */
export const LABEL_CSS = `
.asset-label{box-sizing:border-box;width:${LABEL_SIZE.widthMm}mm;height:${LABEL_SIZE.heightMm}mm;padding:2mm;display:flex;gap:2mm;align-items:center;background:#fff;color:#12161f;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.asset-label .qr{flex:none;width:26mm;height:26mm}
.asset-label .qr svg{display:block;width:100%;height:100%}
.asset-label .text{min-width:0;display:flex;flex-direction:column;gap:0.8mm}
.asset-label .code{font:700 3.6mm/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.1mm}
.asset-label .name{font-size:2.9mm;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.asset-label .company{font-size:2.3mm;line-height:1.2;color:#5b6472;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

/** The label's markup, the same in the preview and in the document printed. */
export function labelMarkup(c: LabelContent): string {
  return (
    `<div class="asset-label"><div class="qr">${c.qrSvg}</div>` +
    `<div class="text"><div class="code">${escape(c.code)}</div><div class="name">${escape(c.name)}</div>` +
    `<div class="company">${escape(c.company)}</div></div></div>`
  );
}

/** The document printed: one page of 63 × 30 mm, no margin, the label alone. */
export function labelDocument(c: LabelContent): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(c.code)}</title>` +
    `<style>@page{size:${LABEL_SIZE.widthMm}mm ${LABEL_SIZE.heightMm}mm;margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}${LABEL_CSS}</style></head>` +
    `<body>${labelMarkup(c)}</body></html>`
  );
}

// ---------- A4 sheets of 24 (Assets step 5) ----------
// The label sheets (owner, 22 October 2026: "label sheets"; spec §5: "labels (A4, 3 × 8 labels of 63 × 30 mm …)"): each
// sheet an A4 page with no margin of the printer's, the 24 places laid out from the sheet's own margins (10.5 mm at the
// sides, 28.5 mm at the top and bottom), each label the single label's markup; the places before the label chosen to
// start at (a sheet already partly used) and after the last one left blank. Print at 100% ("Actual size"), not "Fit".

/** The sheets' own styles: in the page (the preview) and in the document printed. */
export const SHEET_CSS = `
.label-sheet{box-sizing:border-box;width:${LABEL_SHEET.pageWidthMm}mm;height:${LABEL_SHEET.pageHeightMm}mm;padding:${LABEL_SHEET.marginTopMm}mm ${LABEL_SHEET.marginLeftMm}mm;background:#fff;display:grid;grid-template-columns:repeat(${LABEL_SHEET.columns},${LABEL_SHEET.labelWidthMm}mm);grid-template-rows:repeat(${LABEL_SHEET.rows},${LABEL_SHEET.labelHeightMm}mm);overflow:hidden;break-after:page;page-break-after:always}
.label-sheet:last-child{break-after:auto;page-break-after:auto}
.label-sheet .place{width:${LABEL_SHEET.labelWidthMm}mm;height:${LABEL_SHEET.labelHeightMm}mm;overflow:hidden}
`;

/** One sheet's markup: its 24 places, a label or blank. */
export function sheetMarkup(places: readonly (LabelContent | null)[]): string {
  return `<div class="label-sheet">${places.map((p) => `<div class="place">${p ? labelMarkup(p) : ''}</div>`).join('')}</div>`;
}

/** The document printed: the sheets, one A4 page each, the labels from place `start` on. */
export function labelSheetsDocument(labels: readonly LabelContent[], start = 1, title = 'Asset labels'): string {
  const sheets = labelSheetSlots(labels, start);
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>` +
    `<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}${LABEL_CSS}${SHEET_CSS}</style></head>` +
    `<body>${sheets.map(sheetMarkup).join('')}</body></html>`
  );
}
