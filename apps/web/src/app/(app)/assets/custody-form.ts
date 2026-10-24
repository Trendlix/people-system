// The custody form and the custody statement, as printed (Assets step 3; the spec's printables: "custody form (check-out
// receipt / assignment form: items, terms, blank signature lines for the employee and the person handing over; return
// sections appended per return); employee statement (everything held)"). The paper signing (the spec): the handover is
// saved, its form printed, the employee signs it on paper, and the signed page is photographed or scanned and attached
// to the record. Each is a document of its own on A4, printed from a frame in the page as the asset's label is, so the
// site's sidebar and buttons never print with it: the company's name and logo (Organization) at the top, the title (a
// shoot's "Custody Receipt", a long-term assignment's "Assignment Form"), the person, the items (never a value), the
// terms as the record keeps them, the signature lines, then one section for each return with its own signature lines.
// The owner's note on the terms ("have a labour lawyer review this wording before use") is never printed. Pure code,
// tested; every text escaped.
//
// In Arabic and English on one page (owner, 24 October 2026: "i want to generate custodty form to be sign by the
// employee and the HR with the recived goods"; asked, "Arabic and English" and "Employee and HR only"):
// - the titles side by side, the English on the left and the Arabic on the right (إقرار استلام عهدة / نموذج تسليم عهدة);
// - each detail on a row of its own: its English label on the left, the value, its Arabic label on the right;
// - the tables' headings English over Arabic, the condition words in both; the item and accessory names as stored;
// - the terms in two columns, the English (left to right) and the Arabic (right to left), as the record keeps them;
// - two signers only, the employee and HR, on the handover, on each return and on the statement. Who handed over and who
//   received a return are printed as details; they don't sign.
// Dates and numbers 0–9 in both languages, as in every bilingual document (22 October 2026). The Arabic in the system's
// Arabic font, IBM Plex Sans Arabic, which the document loads itself from this site (public/fonts), so the frame it is
// printed from has it too.

import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_LABELS_AR,
  CUSTODY_KIND_LABELS,
  CUSTODY_KIND_LABELS_AR,
  custodyTermsArPrinted,
  RETURN_CONDITION_LABELS,
  RETURN_CONDITION_LABELS_AR,
  type CustodyPersonView,
  type CustodyRecordView,
  type HoldingsView,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../lib/format';
import { HIDDEN_LABEL, shownCode } from '../../../lib/hidden';

/** A text in English and in Arabic. */
type Pair = readonly [en: string, ar: string];

/** The form's words in both languages. */
const L = {
  record: ['Record no.', 'رقم السجل'],
  employee: ['Employee', 'الموظف'],
  employeeCode: ['Employee code', 'الرقم الوظيفي'],
  jobTitle: ['Job title', 'المسمى الوظيفي'],
  department: ['Department', 'القسم'],
  kind: ['Kind', 'نوع العهدة'],
  outAt: ['Handed over on', 'تاريخ التسليم'],
  returnBy: ['Return by', 'تاريخ الإرجاع'],
  noReturnDate: ['No return date: it comes back at clearance', 'بدون تاريخ إرجاع: تُعاد عند إخلاء الطرف'],
  purpose: ['Purpose', 'الغرض'],
  handedOverBy: ['Handed over by', 'القائم بالتسليم'],
  receivedBy: ['Received by', 'القائم بالاستلام'],
  notes: ['Notes', 'ملاحظات'],
  items: ['Items', 'الأصناف'],
  code: ['Code', 'الرمز'],
  asset: ['Asset', 'الصنف'],
  serial: ['Serial', 'الرقم التسلسلي'],
  condition: ['Condition', 'الحالة'],
  accessories: ['Accessories', 'الملحقات'],
  cameBack: ['Came back', 'حالة الإرجاع'],
  notBack: ['Not back', 'لم يرجع'],
  terms: ['Terms', 'الشروط'],
  signatures: ['Signatures', 'التوقيعات'],
  hr: ['HR', 'الموارد البشرية'],
  name: ['Name', 'الاسم'],
  date: ['Date', 'التاريخ'],
  on: ['On', 'في تاريخ'],
  assetsHeld: ['Assets held', 'عدد الأصناف في العهدة'],
  assetsHeldTitle: ['Assets Held', 'الأصناف التي في العهدة'],
  custodyRecord: ['Record', 'السجل'],
  since: ['Since', 'منذ'],
  longTerm: ['Long term', 'طويلة الأجل'],
  overdue: ['overdue', 'متأخرة'],
  with: ['With', 'مع'],
  confirm: ['I confirm that I hold the assets listed above.', 'أقر بأن الأصناف المبينة أعلاه في عهدتي.'],
} as const satisfies Record<string, Pair>;

/** Under the Arabic terms of a record that kept none, when its English terms are the standard ones (custodyTermsArPrinted). */
export const STANDARD_AR_NOTE = 'النص العربي القياسي لهذه الشروط.';
/** In place of the Arabic terms of a record whose English terms have no Arabic. */
export const ENGLISH_ONLY_AR_NOTE = 'شروط هذا السجل مدونة باللغة الإنجليزية فقط.';

/**
 * An item's accessories as printed (step 4, owner, 22 October 2026: accessories): its checklist that went out ("Charger, 2
 * × Battery"), then anything written by hand on the handover; a dash when none.
 */
const accessoriesPrinted = (i: { accessoriesOut?: { name: string; quantity: number; serial: string | null }[]; accessories: string | null }): string => {
  const list = (i.accessoriesOut ?? []).map((a) => `${a.quantity > 1 ? `${a.quantity} × ` : ''}${a.name}${a.serial ? ` (${a.serial})` : ''}`).join(', ');
  return [list, i.accessories].filter(Boolean).join('; ') || '—';
};

const escape = (text: string | null | undefined) => (text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** An Arabic text (escaped) in its own direction and font; `block`: on a line of its own. */
const ar = (text: string, block = false) => `<span class="ar${block ? ' block' : ''}" dir="rtl" lang="ar">${escape(text)}</span>`;

/** A text in both languages on one line: "Shoot · تصوير". */
const inline = ([en, arText]: Pair) => `${escape(en)}<span class="sep">·</span>${ar(arText)}`;

/** A text in both languages, the Arabic under the English (the tables' headings and condition words). */
const stacked = ([en, arText]: Pair) => `<span class="en">${escape(en)}</span>${ar(arText, true)}`;

/** A section's heading, the English on the left and the Arabic on the right (markup, escaped by the caller). */
const heading = (en: string, arMarkup: string) => `<div class="bi-h"><h2>${en}</h2><h2 dir="rtl" lang="ar">${arMarkup}</h2></div>`;

/** A detail's row: its English label, the value (markup), its Arabic label. */
const row = ([en, arText]: Pair, value: string) => `<tr><th class="l-en">${escape(en)}</th><td>${value}</td><th class="l-ar" dir="rtl" lang="ar">${escape(arText)}</th></tr>`;

/** A table's head, each heading English over Arabic, with its column's width class (none: the rest of the width). */
const thead = (cells: [Pair | string, string?][]) =>
  `<thead><tr>${cells.map(([c, w]) => `<th${w ? ` class="${w}"` : ''}>${typeof c === 'string' ? escape(c) : stacked(c)}</th>`).join('')}</tr></thead>`;

/** A person's name in English and, when they have one, in Arabic. */
const nameBoth = (p: { fullNameEn: string; fullNameAr?: string | null }) => `${escape(p.fullNameEn)}${p.fullNameAr?.trim() ? `<span class="sep">·</span>${ar(p.fullNameAr.trim())}` : ''}`;

/** The company as the form names it: its name (in Arabic too, when Organization has one) and its logo's address on this site (null: none uploaded). */
export interface FormBrand {
  company: string;
  companyAr?: string | null;
  logoSrc: string | null;
}

/** A form's titles by its kind (spec §5: "check-out receipt / assignment form"), English and Arabic. */
export const CUSTODY_FORM_TITLES: Record<CustodyRecordView['kind'], Pair> = {
  shoot: ['Custody Receipt', 'إقرار استلام عهدة'],
  assignment: ['Assignment Form', 'نموذج تسليم عهدة'],
};

/** The statement's titles. */
export const CUSTODY_STATEMENT_TITLES: Pair = ['Custody Statement', 'بيان العهدة'];

/** A form's English title by its kind (the page's heading and the printed document's name). */
export const custodyFormTitle = (kind: CustodyRecordView['kind']): string => CUSTODY_FORM_TITLES[kind][0];

/** The Arabic font's files on this site (public/fonts): IBM Plex Sans Arabic's Arabic letters, as the app loads them. */
export const CUSTODY_FORM_FONTS = { regular: '/fonts/ibm-plex-sans-arabic-400.woff2', bold: '/fonts/ibm-plex-sans-arabic-600.woff2' } as const;

const ARABIC_RANGE = 'U+0600-06FF,U+0750-077F,U+0870-08FF,U+200C-200E,U+2010-2011,U+FB50-FDFF,U+FE70-FEFC';
const fontFace = (weight: number, src: string) =>
  `@font-face{font-family:"Plex Arabic Print";font-style:normal;font-weight:${weight};font-display:block;src:url(${src}) format("woff2");unicode-range:${ARABIC_RANGE}}`;

/** The forms' own styles: in the page (the preview) and in the document printed. */
export const CUSTODY_FORM_CSS = `
${fontFace(400, CUSTODY_FORM_FONTS.regular)}
${fontFace(600, CUSTODY_FORM_FONTS.bold)}
.custody-doc{box-sizing:border-box;max-width:180mm;margin:0 auto;background:#fff;color:#12161f;font:9.5pt/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.custody-doc *{box-sizing:border-box}
.custody-doc [lang="ar"]{font-family:"Plex Arabic Print","IBM Plex Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
.custody-doc header{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:5mm;border-bottom:0.4mm solid #12161f;padding-bottom:3mm;margin-bottom:3mm}
.custody-doc header .side-ar{text-align:right}
.custody-doc header .mid{text-align:center}
.custody-doc header img{display:block;max-height:14mm;max-width:45mm;object-fit:contain;margin:0 auto 1.5mm}
.custody-doc .company{font-weight:700;font-size:11pt}
.custody-doc h1{font-size:14pt;font-weight:700;line-height:1.3;margin:0.5mm 0 0}
.custody-doc .code{font:700 10.5pt ui-monospace,SFMono-Regular,Menlo,monospace}
.custody-doc .tiny{font-size:7.5pt;color:#5b6472}
.custody-doc .bi-h{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;margin:3.5mm 0 1.2mm}
.custody-doc h2{font-size:10.5pt;font-weight:700;margin:0}
.custody-doc table{width:100%;border-collapse:collapse;font-size:9pt}
.custody-doc th,.custody-doc td{border:0.25mm solid #c9ced6;padding:1mm 1.6mm;text-align:left;vertical-align:top}
.custody-doc table.items,.custody-doc table.returned,.custody-doc table.held{table-layout:fixed}
.custody-doc .w-n{width:7mm}.custody-doc .w-code{width:27mm}.custody-doc .w-serial{width:25mm}.custody-doc .w-cond{width:27mm}
.custody-doc .w-acc{width:43mm}.custody-doc .w-rec{width:22mm}.custody-doc .w-date{width:21mm}.custody-doc .w-due{width:30mm}.custody-doc .w-notes{width:62mm}
.custody-doc td.nowrap{white-space:nowrap}
.custody-doc td{overflow-wrap:anywhere}
.custody-doc thead th{background:#f2f4f7;font-weight:600}
.custody-doc .ar.block{display:block;text-align:inherit}
.custody-doc table.details th,.custody-doc table.details td{border:0;border-bottom:0.2mm solid #e3e6eb;padding:0.5mm 1.5mm}
.custody-doc table.details th{width:33mm;color:#5b6472;font-weight:400}
.custody-doc table.details th.l-ar{text-align:right}
.custody-doc .sep{color:#8a93a1;padding:0 1.2mm}
.custody-doc .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8.5pt}
.custody-doc .note{font-size:8.5pt;color:#5b6472}
.custody-doc .cols{display:grid;grid-template-columns:1fr 1fr;gap:7mm}
.custody-doc .cols>[dir="rtl"]{text-align:right}
.custody-doc .cols p{margin:0}
.custody-doc ol{margin:0;padding-inline-start:5mm;list-style:decimal}
.custody-doc li{margin:0 0 0.8mm}
.custody-doc .signatures{display:grid;grid-template-columns:1fr 1fr;gap:10mm;break-inside:avoid}
.custody-doc .signature .who{font-weight:600}
.custody-doc .signature .line{border-bottom:0.3mm solid #12161f;height:12mm}
.custody-doc .signature p{margin:1mm 0 0;font-size:9pt}
.custody-doc .signature .fill{color:#5b6472}
.custody-doc .return{break-inside:avoid;border-top:0.3mm dashed #5b6472;margin-top:5mm;padding-top:1mm}
.custody-doc .detail{margin:1.5mm 0 0;font-size:9pt}
`;

function headerOf(brand: FormBrand, [titleEn, titleAr]: Pair, code: string | null): string {
  const logo = brand.logoSrc ? `<img src="${escape(brand.logoSrc)}" alt="${escape(brand.company)}">` : '';
  const companyAr = brand.companyAr?.trim();
  return (
    `<header><div class="side-en"><div class="company">${escape(brand.company)}</div><h1>${escape(titleEn)}</h1></div>` +
    `<div class="mid">${logo}${code ? `<div class="tiny">${inline(L.record)}</div><div class="code">${escape(code)}</div>` : ''}</div>` +
    `<div class="side-ar" dir="rtl" lang="ar">${companyAr ? `<div class="company">${escape(companyAr)}</div>` : ''}<h1>${escape(titleAr)}</h1></div></header>`
  );
}

const DATE_BLANK = '____ / ____ / ________';

/**
 * A signature box (owner, 24 October 2026: "Employee and HR only"): who signs in both languages, the line, then the
 * employee's name printed under it, or for HR a name written by hand; and the date, written by hand.
 */
function signature(who: Pair, person: { fullNameEn: string; fullNameAr?: string | null } | null): string {
  const name = person ? `<p class="name">${nameBoth(person)}</p>` : `<p class="fill">${inline(L.name)}: ______________________________</p>`;
  return (
    `<div class="signature"><div class="who">${escape(who[0])} / ${ar(who[1])}</div><div class="line"></div>${name}` +
    `<p class="fill">${inline(L.date)}: ${DATE_BLANK}</p></div>`
  );
}

/** The two signatures, the employee's and HR's. */
const signatures = (employee: { fullNameEn: string; fullNameAr?: string | null }) =>
  `<div class="signatures">${signature(L.employee, employee)}${signature(L.hr, null)}</div>`;

const personRows = (p: CustodyPersonView) =>
  row(L.employee, nameBoth(p)) +
  row(L.employeeCode, `<span class="mono">${escape(shownCode(p.employeeCode) ?? HIDDEN_LABEL)}</span>`) +
  row(L.jobTitle, escape(p.jobTitle ?? '—')) +
  row(L.department, escape(p.department ?? '—'));

/**
 * The terms in two columns, the English and the Arabic (custodyTermsArPrinted): the Arabic the record kept; for a record
 * from before the Arabic terms whose English terms are the standard ones, the standard Arabic wording, said so under it;
 * else a line in Arabic saying the record's terms are in English only.
 */
function termsOf(r: Pick<CustodyRecordView, 'terms' | 'termsAr'>): string {
  if (!r.terms.length) return '';
  const arabic = custodyTermsArPrinted(r);
  const en = `<div dir="ltr"><h2>${escape(L.terms[0])}</h2><ol>${r.terms.map((t) => `<li>${escape(t)}</li>`).join('')}</ol></div>`;
  const arCol = arabic.terms.length
    ? `<ol>${arabic.terms.map((t) => `<li>${escape(t)}</li>`).join('')}</ol>${arabic.source === 'standard' ? `<p class="note">${escape(STANDARD_AR_NOTE)}</p>` : ''}`
    : `<p class="note">${escape(ENGLISH_ONLY_AR_NOTE)}</p>`;
  return `<section class="terms cols" style="margin-top:4mm">${en}<div dir="rtl" lang="ar"><h2>${escape(L.terms[1])}</h2>${arCol}</div></section>`;
}

/** The custody form's markup, the same in the preview and in the document printed. */
export function custodyFormMarkup(r: CustodyRecordView, brand: FormBrand): string {
  const returnBy = r.kind === 'shoot' && r.dueDate ? escape(formatDate(r.dueDate)) : `${escape(L.noReturnDate[0])}${ar(L.noReturnDate[1], true)}`;
  const details =
    `<table class="details"><tbody>${personRows(r.employee)}` +
    row(L.kind, inline([CUSTODY_KIND_LABELS[r.kind], CUSTODY_KIND_LABELS_AR[r.kind]])) +
    row(L.outAt, escape(formatDateTime(r.outAt))) +
    row(L.returnBy, returnBy) +
    (r.purpose ? row(L.purpose, escape(r.purpose)) : '') +
    row(L.handedOverBy, escape(r.handedOverBy ?? '—')) +
    (r.notes ? row(L.notes, escape(r.notes)) : '') +
    `</tbody></table>`;
  const rows = r.items
    .map(
      (i, n) =>
        `<tr><td>${n + 1}</td><td class="mono nowrap">${escape(i.asset.code)}</td><td>${escape(i.asset.name)}${i.asset.brand || i.asset.model ? `<br><span class="note">${escape([i.asset.brand, i.asset.model].filter(Boolean).join(' '))}</span>` : ''}</td>` +
        `<td class="mono">${escape(i.asset.serial ?? '—')}</td><td>${i.conditionOut ? stacked([ASSET_CONDITION_LABELS[i.conditionOut], ASSET_CONDITION_LABELS_AR[i.conditionOut]]) : '—'}</td><td>${escape(accessoriesPrinted(i))}</td></tr>`,
    )
    .join('');
  const items = `<table class="items">${thead([['#', 'w-n'], [L.code, 'w-code'], [L.asset], [L.serial, 'w-serial'], [L.condition, 'w-cond'], [L.accessories, 'w-acc']])}<tbody>${rows}</tbody></table>`;
  const returns = r.returns
    .map((ret) => {
      const lines = ret.items
        .map((i) => {
          // step 4: the accessories that didn't come back with it
          const notBack = i.missingAccessories?.length ? `${inline(L.notBack)}: ${escape(i.missingAccessories.map((a) => `${a.quantity > 1 ? `${a.quantity} × ` : ''}${a.name}`).join(', '))}` : null;
          const notes = [notBack, i.notes ? escape(i.notes) : null].filter(Boolean).join('. ') || '—';
          return `<tr><td class="mono nowrap">${escape(i.code)}</td><td>${escape(i.name)}</td><td>${stacked([RETURN_CONDITION_LABELS[i.condition], RETURN_CONDITION_LABELS_AR[i.condition]])}</td><td>${notes}</td></tr>`;
        })
        .join('');
      const by = ret.receivedBy ? (ret.receivedBy.name ?? ret.receivedBy.email) : null;
      const when = escape(formatDateTime(ret.at));
      return (
        `<section class="return">${heading(`Return of ${when}`, `إرجاع بتاريخ <bdi dir="ltr">${when}</bdi>`)}` +
        `<table class="returned">${thead([[L.code, 'w-code'], [L.asset], [L.cameBack, 'w-cond'], [L.notes, 'w-notes']])}<tbody>${lines}</tbody></table>` +
        (by ? `<p class="detail">${inline(L.receivedBy)}: ${escape(by)}</p>` : '') +
        `<div style="margin-top:3mm">${signatures(r.employee)}</div></section>`
      );
    })
    .join('');
  return (
    `<div class="custody-doc">${headerOf(brand, CUSTODY_FORM_TITLES[r.kind], r.code)}${details}` +
    `${heading(escape(L.items[0]), escape(L.items[1]))}${items}${termsOf(r)}` +
    `${heading(escape(L.signatures[0]), escape(L.signatures[1]))}${signatures(r.employee)}${returns}</div>`
  );
}

const documentOf = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>` +
  `<style>@page{size:A4;margin:12mm 15mm}html,body{margin:0;padding:0;background:#fff}` +
  `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}${CUSTODY_FORM_CSS}</style></head><body>${body}</body></html>`;

/** The custody form printed: A4, the form alone. */
export const custodyFormDocument = (r: CustodyRecordView, brand: FormBrand): string => documentOf(`${r.code} ${custodyFormTitle(r.kind)}`, custodyFormMarkup(r, brand));

/**
 * The custody statement's markup: everything the person holds now (spec §5: "employee statement (everything held)"),
 * never a value; in both languages, signed by the employee and HR (24 October 2026: "Employee and HR only").
 */
export function custodyStatementMarkup(h: HoldingsView, brand: FormBrand, today: string): string {
  const on = escape(formatDate(today));
  const rows = h.current
    .map((c, n) => {
      const due = c.custody.kind === 'shoot' && c.custody.dueDate ? `${escape(formatDate(c.custody.dueDate))}${c.overdue ? ` (${inline(L.overdue)})` : ''}` : stacked(L.longTerm);
      return (
        `<tr><td>${n + 1}</td><td class="mono nowrap">${escape(c.asset.code)}</td><td>${escape(c.asset.name)}${
          accessoriesPrinted(c) !== '—' ? `<br><span class="note">${inline(L.with)}: ${escape(accessoriesPrinted(c))}</span>` : ''
        }</td><td class="mono">${escape(c.asset.serial ?? '—')}</td>` + `<td class="mono nowrap">${escape(c.custody.code)}</td><td>${escape(formatDate(c.since))}</td><td>${due}</td></tr>`
      );
    })
    .join('');
  const table = h.current.length
    ? `<table class="held">${thead([['#', 'w-n'], [L.code, 'w-code'], [L.asset], [L.serial, 'w-serial'], [L.custodyRecord, 'w-rec'], [L.since, 'w-date'], [L.returnBy, 'w-due']])}<tbody>${rows}</tbody></table>`
    : `<div class="cols"><p>Holds nothing of the company's assets on ${on}.</p><p dir="rtl" lang="ar">لا توجد أي أصناف للشركة في عهدة الموظف في تاريخ <bdi dir="ltr">${on}</bdi>.</p></div>`;
  return (
    `<div class="custody-doc">${headerOf(brand, CUSTODY_STATEMENT_TITLES, null)}` +
    `<table class="details"><tbody>${personRows(h.employee)}${row(L.on, on)}${row(L.assetsHeld, String(h.current.length))}</tbody></table>` +
    `${heading(escape(L.assetsHeldTitle[0]), escape(L.assetsHeldTitle[1]))}${table}` +
    `<div class="cols" style="margin-top:4mm"><p>${escape(L.confirm[0])}</p><p dir="rtl" lang="ar">${escape(L.confirm[1])}</p></div>` +
    `${heading(escape(L.signatures[0]), escape(L.signatures[1]))}${signatures(h.employee)}</div>`
  );
}

/** The custody statement printed: A4. */
export const custodyStatementDocument = (h: HoldingsView, brand: FormBrand, today: string): string =>
  documentOf(`Custody statement of ${h.employee.fullNameEn}`, custodyStatementMarkup(h, brand, today));
