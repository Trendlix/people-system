import type { ChartBox, ChartLayout, Pill, Segment, TextLine, Tone } from './tree';
import { ARABIC_FAMILY, FONTS, LATIN_FAMILY } from './text';

// The org chart as SVG: shown on the page as a picture, downloaded as an .svg file, and drawn on a canvas for the PNG
// and the PDF (export.ts), so all four look the same. Also the PDF's page (A4 or A3, landscape, the chart fitted under
// its title), and the names of the files. Pure: tested in svg.test.ts.
//
// Arabic text is placed by its right end (text-anchor="end") and wrapped in the Unicode marks that make a passage
// right-to-left (RLE … PDF), rather than with direction="rtl", which turns what text-anchor means around in browsers but
// not in every program an .svg is opened in: these marks read the same everywhere, and the letters join as they should.

/**
 * The theme's colours (globals.css), written out: a picture drawn from an SVG can't read the page's CSS variables.
 * svg.test.ts checks them against globals.css.
 */
export const PALETTE = {
  ink: '#111110',
  muted: '#777773',
  line: '#deded9',
  canvas: '#ededeb',
  card: '#ffffff',
  accent: '#151514',
  accentSoft: '#f2f2ed',
  sidebar: '#111110',
  sidebarText: '#92928c',
} as const;

const TONES: Record<Tone, string> = {
  ink: `fill="${PALETTE.ink}"`,
  muted: `fill="${PALETTE.muted}"`,
  white: 'fill="#ffffff"',
  paleOnDark: `fill="#ffffff" fill-opacity="0.82"`,
};

const PILLS: Record<Pill['look'], { box: string; text: string }> = {
  onDark: { box: 'fill="#ffffff" fill-opacity="0.2"', text: 'fill="#ffffff"' },
  onLight: { box: `fill="${PALETTE.accentSoft}"`, text: `fill="${PALETTE.accent}"` },
  onSoft: { box: 'fill="#ffffff"', text: `fill="${PALETTE.accent}"` },
  vacant: { box: `fill="${PALETTE.canvas}" stroke="${PALETTE.line}"`, text: `fill="${PALETTE.muted}"` },
};

const BOXES: Record<ChartBox['kind'], string> = {
  company: `rx="12" fill="${PALETTE.sidebar}"`,
  department: `rx="10" fill="${PALETTE.accent}"`,
  team: `rx="8" fill="${PALETTE.accentSoft}" stroke="${PALETTE.accent}" stroke-opacity="0.35"`,
  title: `rx="8" fill="${PALETTE.card}" stroke="${PALETTE.muted}" stroke-opacity="0.4"`,
};

/** A number as written in the SVG: at most one decimal. */
export const n = (v: number) => String(Math.round(v * 10) / 10);

/** Whether a character is a control character (tab, line ends and the rest), which XML and file names can't have. */
const isControl = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return c < 0x20 || c === 0x7f || c === 0xfffe || c === 0xffff;
};

/** The text with each control character made a space. */
const withoutControls = (s: string) => Array.from(s, (ch) => (isControl(ch) ? ' ' : ch)).join('');

/** Text safe inside an element or a quoted attribute. Control characters, which XML forbids, become spaces. */
export function esc(s: string): string {
  return withoutControls(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Right-to-left embedding, and its end (see above). */
const RLE = '\u202b';
const PDF = '\u202c';

function text(l: TextLine): string {
  const f = FONTS[l.font];
  const attrs = [`x="${n(l.x)}"`, `y="${n(l.y)}"`, `font-size="${f.size}"`];
  if (f.weight !== 400) attrs.push(`font-weight="${f.weight}"`);
  if (f.arabic) attrs.push(`font-family="${esc(ARABIC_FAMILY)}"`, 'xml:lang="ar"');
  if (l.align !== 'start') attrs.push(`text-anchor="${l.align}"`);
  attrs.push(TONES[l.tone]);
  return `<text ${attrs.join(' ')}>${f.arabic ? `${RLE}${esc(l.text)}${PDF}` : esc(l.text)}</text>`;
}

const path = (segments: Segment[]) => segments.map((s) => `M${n(s.x1)} ${n(s.y1)}L${n(s.x2)} ${n(s.y2)}`).join('');

function pill(p: Pill): string {
  const look = PILLS[p.look];
  const label = `<text x="${n(p.x + p.w / 2)}" y="${n(p.y + p.h / 2 + FONTS.count.size * 0.36)}" font-size="${FONTS.count.size}" font-weight="${FONTS.count.weight}" text-anchor="middle" ${look.text}>${esc(p.text)}</text>`;
  return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="${n(p.h / 2)}" ${look.box}/>${label}`;
}

/** Where the logo itself goes in its white square: a little inside it. */
export const LOGO_INSET = 5;

function box(b: ChartBox, logo: string | null): string {
  const parts = [`<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" ${BOXES[b.kind]}${b.vacant ? ' stroke-dasharray="4 3"' : ''}/>`];
  if (b.logo) {
    const { x, y, size } = b.logo;
    parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="8" fill="#ffffff"/>`);
    if (logo) {
      const inner = size - 2 * LOGO_INSET;
      const at = `x="${n(x + LOGO_INSET)}" y="${n(y + LOGO_INSET)}" width="${inner}" height="${inner}"`;
      parts.push(`<image ${at} preserveAspectRatio="xMidYMid meet" href="${esc(logo)}" xlink:href="${esc(logo)}"/>`);
    }
  }
  if (b.rule) parts.push(`<path d="${path([b.rule])}" stroke="${PALETTE.line}" stroke-width="1"/>`);
  if (b.pill) parts.push(pill(b.pill));
  parts.push(...b.lines.map(text));
  return parts.join('');
}

/** What the chart is drawn with, in its own units (0, 0 to width, height), without the <svg> around it. */
export function chartBody(layout: ChartLayout, logo: string | null = null): string {
  return [
    `<rect width="${n(layout.width)}" height="${n(layout.height)}" fill="#ffffff"/>`,
    layout.links.length ? `<path d="${path(layout.links)}" fill="none" stroke="${PALETTE.muted}" stroke-opacity="0.55" stroke-width="1.25"/>` : '',
    ...layout.boxes.map((b) => box(b, logo)),
    ...layout.note.map(text),
  ].join('');
}

const open = (width: number, height: number, viewBox: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(width)}" height="${n(height)}" viewBox="${viewBox}" font-family="${esc(LATIN_FAMILY)}">`;

export interface ChartSvgOptions {
  /** The company's logo as a data: address (a picture drawn from an SVG can't fetch anything); null leaves its square empty. */
  logo?: string | null;
  /** Its size as `scale` times its own (a PNG at three times, say); the drawing is the same. */
  scale?: number;
  /** For programs that show a title: "Organization chart — TrendLIX — 15/10/2026". */
  title?: string;
}

/** The chart as a whole SVG file. */
export function chartSvg(layout: ChartLayout, { logo = null, scale = 1, title }: ChartSvgOptions = {}): string {
  return `${open(layout.width * scale, layout.height * scale, `0 0 ${n(layout.width)} ${n(layout.height)}`)}${title ? `<title>${esc(title)}</title>` : ''}${chartBody(layout, logo)}</svg>`;
}

// ---------- the PDF's page ----------

export type ChartPaper = 'a4' | 'a3';

/** The sheets the PDF can be on, landscape, in millimetres. */
export const PAPER_MM: Readonly<Record<ChartPaper, readonly [number, number]>> = { a4: [297, 210], a3: [420, 297] };

/** The page's margin, the title's size and the space under it, in millimetres of an A4 page. */
const MARGIN_MM = 10;
const HEADING_MM = 5.5;
const UNDER_HEADING_MM = 4;
/** From the top of the page to the chart, in millimetres of an A4 page. */
const CHART_TOP_MM = MARGIN_MM + HEADING_MM * 1.2 + UNDER_HEADING_MM;

/** The shape (width ÷ height) "Fit a landscape page" aims for: the room a landscape A4 or A3 sheet leaves under the title. */
export const PAGE_ASPECT = (297 - 2 * MARGIN_MM) / (210 - CHART_TOP_MM - MARGIN_MM);

/** The most points a picture is drawn with: the largest canvas some browsers draw (iPhones: 16.7 million) is never passed. */
export const MAX_AREA = 16_000_000;
/** The longest side of a canvas every browser draws. */
export const MAX_SIDE = 16_384;

/** The dots per inch the page is drawn at: 300, or less when a sheet that large would pass MAX_AREA (A3: 287). */
export function pageDpi(paper: ChartPaper): number {
  const [w, h] = PAPER_MM[paper].map((mm) => mm / 25.4);
  return Math.min(300, Math.floor(Math.sqrt(MAX_AREA / (w * h))));
}

/** How many times its own size the PNG is: three, or less for a chart too large to draw that big. */
export function pngScale(layout: ChartLayout): number {
  return Math.min(3, Math.sqrt(MAX_AREA / (layout.width * layout.height)), MAX_SIDE / layout.width, MAX_SIDE / layout.height);
}

export interface PagePlan {
  /** The page, in points of the picture. */
  width: number;
  height: number;
  dpi: number;
  /** The title: its baseline's left end, and its size. */
  heading: { x: number; y: number; size: number };
  /** Where the chart goes: its top left, and the scale it is drawn at. */
  chart: { x: number; y: number; scale: number };
}

/**
 * The PDF's page: the sheet, landscape, at `dpi`, with a 10 mm margin, the title at the top left and the chart under
 * it, as large as fits, centred across. An A3 page is an A4 page made larger, so it prints the same, bigger.
 */
export function pagePlan(layout: ChartLayout, paper: ChartPaper, dpi = pageDpi(paper)): PagePlan {
  const mm = (dpi / 25.4) * (paper === 'a3' ? Math.SQRT2 : 1); // points per millimetre of an A4 page
  const [wMm, hMm] = PAPER_MM[paper];
  const width = Math.round((wMm * dpi) / 25.4);
  const height = Math.round((hMm * dpi) / 25.4);
  const margin = MARGIN_MM * mm;
  const size = HEADING_MM * mm;
  const top = CHART_TOP_MM * mm;
  const roomW = width - 2 * margin;
  const roomH = height - top - margin;
  const scale = Math.min(roomW / layout.width, roomH / layout.height);
  return {
    width,
    height,
    dpi,
    heading: { x: margin, y: margin + size * 0.85, size },
    chart: { x: margin + (roomW - layout.width * scale) / 2, y: top, scale },
  };
}

/** The PDF's page as SVG, `heading` at the top. */
export function pageSvg(layout: ChartLayout, plan: PagePlan, heading: string, logo: string | null = null): string {
  const { width, height, chart } = plan;
  const title = `<text x="${n(plan.heading.x)}" y="${n(plan.heading.y)}" font-size="${n(plan.heading.size)}" font-weight="700" fill="${PALETTE.ink}">${esc(heading)}</text>`;
  const body = `<g transform="translate(${n(chart.x)} ${n(chart.y)}) scale(${chart.scale})">${chartBody(layout, logo)}</g>`;
  return `${open(width, height, `0 0 ${width} ${height}`)}<title>${esc(heading)}</title><rect width="${width}" height="${height}" fill="#ffffff"/>${title}${body}</svg>`;
}

// ---------- the logo, drawn on the canvas ----------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the logo goes on a canvas the chart was drawn on at `scale`, from (x, y): in its square, inset. */
export function logoRect(layout: ChartLayout, scale: number, x = 0, y = 0): Rect | null {
  const square = layout.boxes.find((b) => b.logo)?.logo;
  if (!square) return null;
  const inner = (square.size - 2 * LOGO_INSET) * scale;
  return { x: x + (square.x + LOGO_INSET) * scale, y: y + (square.y + LOGO_INSET) * scale, w: inner, h: inner };
}

/** A picture of w × h fitted inside `r`, whole, and centred (as preserveAspectRatio="xMidYMid meet"). */
export function containIn(r: Rect, w: number, h: number): Rect {
  const k = Math.min(r.w / w, r.h / h);
  return { x: r.x + (r.w - w * k) / 2, y: r.y + (r.h - h * k) / 2, w: w * k, h: h * k };
}

// ---------- names ----------

/** "Organization chart — TrendLIX — 15/10/2026": the PDF's title. `date` is DD/MM/YYYY. */
export const chartTitle = (company: string, date: string) => `Organization chart — ${company.trim()} — ${date}`;

/**
 * The downloaded file's name: "Organization chart - TrendLIX - 15-10-2026.pdf". Characters a file name can't have
 * (/ \ : * ? " < > | and control characters) become spaces; a long company name is cut at 80 characters.
 */
export function chartFileName(company: string, date: string, extension: 'pdf' | 'png' | 'svg'): string {
  const clean = Array.from(
    withoutControls(company.normalize('NFC'))
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, ''),
  )
    .slice(0, 80)
    .join('')
    .trim();
  return `${['Organization chart', clean, date.replace(/\//g, '-')].filter(Boolean).join(' - ')}.${extension}`;
}
