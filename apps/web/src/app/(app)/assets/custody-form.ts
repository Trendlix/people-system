// The custody form and the custody statement, as printed (Assets step 3; the spec's printables: "custody form (check-out
// receipt / assignment form: items, terms, blank signature lines for the employee and the person handing over; return
// sections appended per return); employee statement (everything held)"). The paper signing (the spec): the handover is
// saved, its form printed, the employee signs it on paper, and the signed page is photographed or scanned and attached
// to the record. Each is a document of its own on A4, printed from a frame in the page as the asset's label is, so the
// site's sidebar and buttons never print with it: the company's name and logo (Organization) at the top, the title (a
// shoot's "Custody Receipt", a long-term assignment's "Assignment Form"), the person, the items (never a value), the
// terms as the record keeps them, the signature lines, then one section for each return with its own signature line.
// The owner's note on the terms ("have a labour lawyer review this wording before use") is never printed. Pure code,
// tested; every text escaped.

import {
  ASSET_CONDITION_LABELS,
  CUSTODY_KIND_LABELS,
  RETURN_CONDITION_LABELS,
  type CustodyRecordView,
  type HoldingsView,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../lib/format';

const escape = (text: string | null | undefined) => (text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** The company as the form names it: its name and its logo's address on this site (null: none uploaded). */
export interface FormBrand {
  company: string;
  logoSrc: string | null;
}

/** A form's title by its kind (spec §5: "check-out receipt / assignment form"). */
export const custodyFormTitle = (kind: CustodyRecordView['kind']): string => (kind === 'shoot' ? 'Custody Receipt' : 'Assignment Form');

/** The forms' own styles: in the page (the preview) and in the document printed. */
export const CUSTODY_FORM_CSS = `
.custody-doc{box-sizing:border-box;max-width:180mm;margin:0 auto;background:#fff;color:#12161f;font:10.5pt/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.custody-doc *{box-sizing:border-box}
.custody-doc header{display:flex;align-items:center;justify-content:space-between;gap:6mm;border-bottom:0.4mm solid #12161f;padding-bottom:3mm;margin-bottom:4mm}
.custody-doc header img{max-height:14mm;max-width:50mm;object-fit:contain}
.custody-doc .company{font-weight:700;font-size:12pt}
.custody-doc h1{font-size:15pt;margin:0}
.custody-doc h2{font-size:11pt;margin:5mm 0 2mm}
.custody-doc .code{font:700 11pt ui-monospace,SFMono-Regular,Menlo,monospace}
.custody-doc dl{display:grid;grid-template-columns:38mm 1fr;gap:1mm 4mm;margin:0}
.custody-doc dt{color:#5b6472}
.custody-doc dd{margin:0}
.custody-doc table{width:100%;border-collapse:collapse;font-size:9.5pt}
.custody-doc th,.custody-doc td{border:0.25mm solid #c9ced6;padding:1.5mm 2mm;text-align:left;vertical-align:top}
.custody-doc th{background:#f2f4f7}
.custody-doc .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.custody-doc ol{margin:0;padding-left:5mm}
.custody-doc li{margin:0 0 1mm}
.custody-doc .signatures{display:grid;grid-template-columns:1fr 1fr;gap:10mm;margin-top:8mm}
.custody-doc .signature .line{border-bottom:0.3mm solid #12161f;height:14mm}
.custody-doc .signature p{margin:1mm 0 0;font-size:9pt;color:#5b6472}
.custody-doc .return{break-inside:avoid;border-top:0.3mm dashed #5b6472;margin-top:8mm;padding-top:3mm}
.custody-doc .note{font-size:9pt;color:#5b6472}
`;

function headerOf(brand: FormBrand, title: string, code: string | null): string {
  const logo = brand.logoSrc ? `<img src="${escape(brand.logoSrc)}" alt="${escape(brand.company)}">` : '';
  return (
    `<header><div>${logo}<div class="company">${escape(brand.company)}</div></div>` +
    `<div style="text-align:right"><h1>${escape(title)}</h1>${code ? `<div class="code">${escape(code)}</div>` : ''}</div></header>`
  );
}

function signature(label: string, name: string | null): string {
  return `<div class="signature"><div class="line"></div><p>${escape(label)}${name ? `: ${escape(name)}` : ''}</p><p>Date: ____ / ____ / ________</p></div>`;
}

const personRows = (p: { fullNameEn: string; employeeCode: string; jobTitle: string | null; department: string | null }) =>
  `<dt>Employee</dt><dd>${escape(p.fullNameEn)}</dd><dt>Employee code</dt><dd class="mono">${escape(p.employeeCode)}</dd>` +
  `<dt>Job title</dt><dd>${escape(p.jobTitle ?? '—')}</dd><dt>Department</dt><dd>${escape(p.department ?? '—')}</dd>`;

/** The custody form's markup, the same in the preview and in the document printed. */
export function custodyFormMarkup(r: CustodyRecordView, brand: FormBrand): string {
  const details =
    `<dl>${personRows(r.employee)}` +
    `<dt>Kind</dt><dd>${escape(CUSTODY_KIND_LABELS[r.kind])}</dd>` +
    `<dt>Handed over on</dt><dd>${escape(formatDateTime(r.outAt))}</dd>` +
    `<dt>Return by</dt><dd>${escape(r.kind === 'shoot' && r.dueDate ? formatDate(r.dueDate) : 'No return date: it comes back at clearance')}</dd>` +
    (r.purpose ? `<dt>Purpose</dt><dd>${escape(r.purpose)}</dd>` : '') +
    `<dt>Handed over by</dt><dd>${escape(r.handedOverBy ?? '—')}</dd>` +
    (r.notes ? `<dt>Notes</dt><dd>${escape(r.notes)}</dd>` : '') +
    `</dl>`;
  const rows = r.items
    .map(
      (i, n) =>
        `<tr><td>${n + 1}</td><td class="mono">${escape(i.asset.code)}</td><td>${escape(i.asset.name)}${i.asset.brand || i.asset.model ? `<br><span class="note">${escape([i.asset.brand, i.asset.model].filter(Boolean).join(' '))}</span>` : ''}</td>` +
        `<td class="mono">${escape(i.asset.serial ?? '—')}</td><td>${escape(i.conditionOut ? ASSET_CONDITION_LABELS[i.conditionOut] : '—')}</td><td>${escape(i.accessories ?? '—')}</td></tr>`,
    )
    .join('');
  const items = `<table><thead><tr><th>#</th><th>Code</th><th>Asset</th><th>Serial</th><th>Condition</th><th>Accessories</th></tr></thead><tbody>${rows}</tbody></table>`;
  const terms = r.terms.length ? `<h2>Terms</h2><ol>${r.terms.map((t) => `<li>${escape(t)}</li>`).join('')}</ol>` : '';
  const signs = `<div class="signatures">${signature('Employee', r.employee.fullNameEn)}${signature('Handed over by', r.handedOverBy)}</div>`;
  const returns = r.returns
    .map((ret) => {
      const lines = ret.items
        .map((i) => `<tr><td class="mono">${escape(i.code)}</td><td>${escape(i.name)}</td><td>${escape(RETURN_CONDITION_LABELS[i.condition])}</td><td>${escape(i.notes ?? '—')}</td></tr>`)
        .join('');
      const by = ret.receivedBy ? (ret.receivedBy.name ?? ret.receivedBy.email) : null;
      return (
        `<section class="return"><h2>Return of ${escape(formatDateTime(ret.at))}</h2>` +
        `<table><thead><tr><th>Code</th><th>Asset</th><th>Came back</th><th>Notes</th></tr></thead><tbody>${lines}</tbody></table>` +
        `<div class="signatures">${signature('Returned by', r.employee.fullNameEn)}${signature('Received by', by)}</div></section>`
      );
    })
    .join('');
  return `<div class="custody-doc">${headerOf(brand, custodyFormTitle(r.kind), r.code)}${details}<h2>Items</h2>${items}${terms}${signs}${returns}</div>`;
}

const documentOf = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>` +
  `<style>@page{size:A4;margin:15mm}html,body{margin:0;padding:0;background:#fff}` +
  `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}${CUSTODY_FORM_CSS}</style></head><body>${body}</body></html>`;

/** The custody form printed: A4, the form alone. */
export const custodyFormDocument = (r: CustodyRecordView, brand: FormBrand): string => documentOf(`${r.code} ${custodyFormTitle(r.kind)}`, custodyFormMarkup(r, brand));

/** The custody statement's markup: everything the person holds now (spec §5: "employee statement (everything held)"), never a value. */
export function custodyStatementMarkup(h: HoldingsView, brand: FormBrand, today: string): string {
  const rows = h.current
    .map(
      (c, n) =>
        `<tr><td>${n + 1}</td><td class="mono">${escape(c.asset.code)}</td><td>${escape(c.asset.name)}</td><td class="mono">${escape(c.asset.serial ?? '—')}</td>` +
        `<td class="mono">${escape(c.custody.code)}</td><td>${escape(formatDate(c.since))}</td>` +
        `<td>${escape(c.custody.kind === 'shoot' && c.custody.dueDate ? `${formatDate(c.custody.dueDate)}${c.overdue ? ' (overdue)' : ''}` : 'Long term')}</td></tr>`,
    )
    .join('');
  const table = h.current.length
    ? `<table><thead><tr><th>#</th><th>Code</th><th>Asset</th><th>Serial</th><th>Record</th><th>Since</th><th>Return by</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>Holds nothing of the company's assets on ${escape(formatDate(today))}.</p>`;
  return (
    `<div class="custody-doc">${headerOf(brand, 'Custody Statement', null)}<dl>${personRows(h.employee)}<dt>On</dt><dd>${escape(formatDate(today))}</dd>` +
    `<dt>Assets held</dt><dd>${h.current.length}</dd></dl><h2>Assets Held</h2>${table}` +
    `<p class="note">I confirm that I hold the assets listed above.</p><div class="signatures">${signature('Employee', h.employee.fullNameEn)}${signature('For the company', null)}</div></div>`
  );
}

/** The custody statement printed: A4. */
export const custodyStatementDocument = (h: HoldingsView, brand: FormBrand, today: string): string =>
  documentOf(`Custody statement of ${h.employee.fullNameEn}`, custodyStatementMarkup(h, brand, today));
