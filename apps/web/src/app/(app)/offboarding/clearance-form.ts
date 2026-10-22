// The Clearance Form, as printed (owner, 22 October 2026: the full module; the brief: "a printable Clearance Form
// (system-drawn, like the other print pages) with signature lines"; the asset spec: "clearance (→ offboarding)"): the
// company's name and logo, who is leaving and when, each clearance item with its owner, state and note, what they
// still hold, and the signature lines of the employee, HR and each owner. A document of its own on A4, printed from a
// frame in the page as the custody form is. Never the exit interview or rehire eligibility. Pure code, tested; every
// text escaped.

import { CLEARANCE_ITEM_STATUS_LABELS, CLEARANCE_OWNER_LABELS, END_REASON_LABELS, type ClearanceOwner, type EndReason, type OffboardingCaseView } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';

const escape = (text: string | null | undefined) => (text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export interface ClearanceBrand {
  company: string;
  logoSrc: string | null;
}

export const CLEARANCE_FORM_CSS = `
.clearance-doc{box-sizing:border-box;max-width:180mm;margin:0 auto;background:#fff;color:#12161f;font:10.5pt/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.clearance-doc *{box-sizing:border-box}
.clearance-doc header{display:flex;align-items:center;justify-content:space-between;gap:6mm;border-bottom:0.4mm solid #12161f;padding-bottom:3mm;margin-bottom:4mm}
.clearance-doc header img{max-height:14mm;max-width:50mm;object-fit:contain}
.clearance-doc .company{font-weight:700;font-size:12pt}
.clearance-doc h1{font-size:15pt;margin:0}
.clearance-doc h2{font-size:11pt;margin:5mm 0 2mm}
.clearance-doc dl{display:grid;grid-template-columns:38mm 1fr;gap:1mm 4mm;margin:0}
.clearance-doc dt{color:#5b6472}
.clearance-doc dd{margin:0}
.clearance-doc table{width:100%;border-collapse:collapse;font-size:9.5pt}
.clearance-doc th,.clearance-doc td{border:0.25mm solid #c9ced6;padding:1.5mm 2mm;text-align:left;vertical-align:top}
.clearance-doc th{background:#f2f4f7}
.clearance-doc .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.clearance-doc .signatures{display:grid;grid-template-columns:1fr 1fr;gap:8mm 10mm;margin-top:8mm}
.clearance-doc .signature{break-inside:avoid}
.clearance-doc .signature .line{border-bottom:0.3mm solid #12161f;height:12mm}
.clearance-doc .signature p{margin:1mm 0 0;font-size:9pt;color:#5b6472}
.clearance-doc .note{font-size:9pt;color:#5b6472}
`;

function signature(label: string, name: string | null): string {
  return `<div class="signature"><div class="line"></div><p>${escape(label)}${name ? `: ${escape(name)}` : ''}</p><p>Date: ____ / ____ / ________</p></div>`;
}

/** The owners with items on the case, in the checklist's order, each signing once. */
export function signingOwners(c: Pick<OffboardingCaseView, 'items'>): ClearanceOwner[] {
  const seen: ClearanceOwner[] = [];
  for (const i of c.items) if (!seen.includes(i.owner)) seen.push(i.owner);
  return seen;
}

/** The form's markup, the same in the preview and in the document printed. */
export function clearanceFormMarkup(c: OffboardingCaseView, brand: ClearanceBrand): string {
  const logo = brand.logoSrc ? `<img src="${escape(brand.logoSrc)}" alt="${escape(brand.company)}">` : '';
  const header = `<header><div>${logo}<div class="company">${escape(brand.company)}</div></div><div style="text-align:right"><h1>Clearance Form</h1></div></header>`;
  const reason = c.endReason ? (END_REASON_LABELS[c.endReason as EndReason] ?? c.endReason) : null;
  const details =
    `<dl><dt>Employee</dt><dd>${escape(c.employee.fullNameEn)}</dd>` +
    `<dt>Employee code</dt><dd class="mono">${escape(c.employee.employeeCode)}</dd>` +
    `<dt>Job title</dt><dd>${escape(c.jobTitle ?? '—')}</dd>` +
    `<dt>Department</dt><dd>${escape(c.department ?? '—')}</dd>` +
    `<dt>Joined</dt><dd>${escape(formatDate(c.joinDate))}</dd>` +
    `<dt>Last working day</dt><dd>${escape(c.lastWorkingDay ? formatDate(c.lastWorkingDay) : '—')}</dd>` +
    (reason ? `<dt>Reason</dt><dd>${escape(reason)}</dd>` : '') +
    `</dl>`;
  const rows = c.items
    .map(
      (i, n) =>
        `<tr><td>${n + 1}</td><td>${escape(i.label)}</td><td>${escape(CLEARANCE_OWNER_LABELS[i.owner])}</td>` +
        `<td>${escape(CLEARANCE_ITEM_STATUS_LABELS[i.status])}${i.doneBy ? `<br><span class="note">${escape(i.doneBy)}${i.doneAt ? `, ${escape(formatDate(i.doneAt))}` : ''}</span>` : ''}</td>` +
        `<td>${escape(i.note ?? '')}</td></tr>`,
    )
    .join('');
  const items = `<table><thead><tr><th>#</th><th>Item</th><th>Cleared by</th><th>State</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
  const held = c.holdings.length
    ? `<h2>Still Held</h2><table><thead><tr><th>Asset</th><th>Custody record</th></tr></thead><tbody>${c.holdings
        .map((h) => `<tr><td><span class="mono">${escape(h.assetCode)}</span> ${escape(h.assetName)}</td><td class="mono">${escape(h.custodyCode)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  const signs = `<div class="signatures">${signature('Employee', c.employee.fullNameEn)}${signingOwners(c)
    .map((o) => signature(CLEARANCE_OWNER_LABELS[o], null))
    .join('')}</div>`;
  return `<div class="clearance-doc">${header}${details}<h2>Clearance</h2>${items}${held}${signs}</div>`;
}

/** The form printed: A4, the form alone. */
export const clearanceFormDocument = (c: OffboardingCaseView, brand: ClearanceBrand): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clearance Form ${escape(c.employee.fullNameEn)}</title>` +
  `<style>@page{size:A4;margin:15mm}html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}${CLEARANCE_FORM_CSS}</style>` +
  `</head><body>${clearanceFormMarkup(c, brand)}</body></html>`;
