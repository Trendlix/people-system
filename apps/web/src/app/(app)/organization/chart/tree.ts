import type { OrgChart, OrgChartDepartment, OrgChartJobTitle, OrgChartTeam } from '@/lib/types';
import { FIT, FONTS, truncate, wrapText, type FontName, type Measure } from './text';

// Where everything on the org chart goes (owner's request, 15 October 2026: the company's org chart from the Departments
// & Job Titles page, to export). The company at the top; under it the departments side by side, in the order an Admin
// set; under each department its own job titles (e.g. Head of Marketing), then its teams in their order, each with its
// job titles. A department with nothing in it still shows; a job title no one holds shows 0 and a dashed border.
//
// About eight departments make a wide chart for a landscape page, so a department's teams go one of two ways: stacked
// under it in one column (narrow and tall), or side by side under it (wide and short). "Fit a landscape page" puts the
// tallest department's teams side by side, then the next tallest, while that brings the chart nearer the page's shape.
//
// Pure: sizes in pixels (SVG user units), text widths from the `measure` given. Drawn by svg.ts; tested in tree.test.ts.

export type Arrangement = 'balanced' | 'stacked' | 'spread';

export interface ChartOptions {
  /** The people under each job title (when the API sent them: HR, the CEO and Finance). */
  people: boolean;
  /** Each person's employee code beside their name. */
  codes: boolean;
  /** The Arabic names and titles under the English. */
  arabic: boolean;
  arrangement: Arrangement;
  /** For 'balanced': the shape, width ÷ height, to come near (the page's). */
  aspect: number;
  /** Room for the company's logo. */
  logo: boolean;
}

/** How a text is coloured: see TONES in svg.ts. */
export type Tone = 'ink' | 'muted' | 'white' | 'paleOnDark';

/** One line of text. `y` is its baseline; `align` says which end of the text is at `x`. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
  font: FontName;
  align: 'start' | 'middle' | 'end';
  tone: Tone;
}

/** The headcount in a rounded tag at a box's top right. */
export interface Pill {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  look: 'onDark' | 'onLight' | 'onSoft' | 'vacant';
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type BoxKind = 'company' | 'department' | 'team' | 'title';

export interface ChartBox {
  kind: BoxKind;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A job title no one holds now: drawn dashed. */
  vacant: boolean;
  lines: TextLine[];
  pill: Pill | null;
  /** The line between a job title and its people. */
  rule: Segment | null;
  /** The square the company's logo goes in. */
  logo: { x: number; y: number; size: number } | null;
}

export interface ChartLayout {
  width: number;
  height: number;
  /** The company first, then each department followed by everything under it. */
  boxes: ChartBox[];
  /** The lines that join the boxes. */
  links: Segment[];
  /** The key at the foot of the chart. */
  note: TextLine[];
  /** The departments whose teams are side by side. */
  spread: string[];
  /** Each department's column: where it is and how far down it reaches. */
  columns: { id: string; x: number; w: number; bottom: number }[];
}

// ---------- sizes ----------

export const MARGIN = 24;
/** A department's width, and so a column's. */
export const COLUMN = 220;
/** How far a box steps in under the one it belongs to. */
export const INDENT = 20;
/** Where the line down the side of a box's children runs, from the box's left edge. */
export const SPINE = 10;
/** How far down a box the line from that spine meets it: beside its first line. */
export const JOIN = 16;
export const DEPT_GAP = 28;
export const TEAM_GAP = 16;
export const ROW_GAP = 10;
/** From the company down to the line over the departments, and from that line down to them. */
export const LEVEL_GAP = 22;
/** From a department (or its last job title) down to the line over its teams side by side, and from it to them. */
export const BUS_GAP = 12;
const PAD_X = 10;
const PAD_Y = 8;
const COMPANY_PAD = 14;
const COMPANY_MIN = 260;
const COMPANY_MAX = 460;
export const LOGO = 44;
const PILL_H = 18;
const PILL_MIN = 24;
const PILL_GAP = 6;
const NOTE_GAP = 20;

/** The key at the foot of the chart, so a printed copy explains itself. */
export const NOTE =
  'The number on a job title is how many people hold it now; on a department or team, the people in all its job titles. A dashed box is a job title no one holds.';

// ---------- counting ----------

export interface ChartCounts {
  departments: number;
  teams: number;
  jobTitles: number;
  /** People in a job title now: each job title's headcount, added up. */
  people: number;
  vacant: number;
}

const titlesIn = (unit: OrgChartTeam, teams: OrgChartTeam[] = []) => [unit, ...teams].flatMap((u) => u.jobTitles);
const peopleIn = (titles: OrgChartJobTitle[]) => titles.reduce((n, t) => n + t.headcount, 0);

export function countChart(chart: OrgChart): ChartCounts {
  const titles = chart.departments.flatMap((d) => titlesIn(d, d.teams));
  return {
    departments: chart.departments.length,
    teams: chart.departments.reduce((n, d) => n + d.teams.length, 0),
    jobTitles: titles.length,
    people: peopleIn(titles),
    vacant: titles.filter((t) => t.headcount === 0).length,
  };
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------- boxes ----------

interface Ctx {
  chart: OrgChart;
  options: ChartOptions;
  measure: Measure;
  boxes: ChartBox[];
  links: Segment[];
}

/** The baseline of a line of `font` whose top is at `top`: the letters centred in the line's height. */
export const baseline = (top: number, font: FontName) => top + (FONTS[font].lineHeight + FONTS[font].size * 0.7) / 2;

function link(c: Ctx, x1: number, y1: number, x2: number, y2: number) {
  if (x1 !== x2 || y1 !== y2) c.links.push({ x1, y1, x2, y2 });
}

/** Adds the lines one under another from `top`; answers where they end. */
function addLines(into: TextLine[], texts: string[], font: FontName, x: number, top: number, align: TextLine['align'], tone: Tone): number {
  let at = top;
  for (const text of texts) {
    into.push({ text, x, y: baseline(at, font), font, align, tone });
    at += FONTS[font].lineHeight;
  }
  return at;
}

/** A headcount tag whose right edge is at `right`. */
function pillAt(count: number, look: Pill['look'], right: number, top: number, measure: Measure): Pill {
  const text = String(count);
  const w = Math.max(PILL_MIN, Math.ceil(measure(text, 'count')) + 12);
  return { x: right - w, y: top, w, h: PILL_H, text, look };
}

function titleBox(c: Ctx, t: OrgChartJobTitle, x: number, y: number, w: number): ChartBox {
  const { options, measure } = c;
  const vacant = t.headcount === 0;
  const pill = pillAt(t.headcount, vacant ? 'vacant' : 'onLight', x + w - PAD_X, y + PAD_Y - 1, measure);
  // the title beside the tag, the Arabic one under it, right-aligned up to the tag
  const textW = w - 2 * PAD_X - pill.w - PILL_GAP;
  const lines: TextLine[] = [];
  let at = addLines(lines, wrapText(t.titleEn, textW * FIT, 'title', measure, 3), 'title', x + PAD_X, y + PAD_Y, 'start', 'ink');
  if (options.arabic && t.titleAr) {
    at = addLines(lines, wrapText(t.titleAr, textW * FIT, 'titleAr', measure, 2), 'titleAr', x + PAD_X + textW, at, 'end', 'muted');
  }
  at = Math.max(at, pill.y + pill.h);

  let rule: Segment | null = null;
  const people = options.people ? (t.people ?? []) : [];
  if (people.length) {
    rule = { x1: x + PAD_X, y1: at + 5, x2: x + w - PAD_X, y2: at + 5 };
    at += 10;
    const full = w - 2 * PAD_X;
    for (const p of people) {
      const code = options.codes ? p.employeeCode : '';
      const codeW = code ? measure(code, 'code') + 6 : 0;
      const line = baseline(at, 'person');
      lines.push({ text: truncate(p.fullNameEn, (full - codeW) * FIT, 'person', measure), x: x + PAD_X, y: line, font: 'person', align: 'start', tone: 'ink' });
      if (code) lines.push({ text: code, x: x + w - PAD_X, y: line, font: 'code', align: 'end', tone: 'muted' });
      at += FONTS.person.lineHeight;
      if (options.arabic && p.fullNameAr) {
        at = addLines(lines, [truncate(p.fullNameAr, full * FIT, 'personAr', measure)], 'personAr', x + w - PAD_X, at, 'end', 'muted');
      }
    }
  }
  return { kind: 'title', id: t.id, x, y, w, h: at + PAD_Y - y, vacant, lines, pill, rule, logo: null };
}

/** A department (blue, white text) or a team (pale blue), with the people in all its job titles. */
function unitBox(c: Ctx, kind: 'department' | 'team', unit: OrgChartTeam, people: number, x: number, y: number, w: number): ChartBox {
  const { options, measure } = c;
  const dept = kind === 'department';
  const pill = pillAt(people, dept ? 'onDark' : 'onSoft', x + w - PAD_X, y + PAD_Y + 1, measure);
  const textW = w - 2 * PAD_X - pill.w - PILL_GAP;
  const lines: TextLine[] = [];
  const top = y + PAD_Y + 1;
  let at = addLines(lines, wrapText(unit.nameEn, textW * FIT, dept ? 'department' : 'team', measure, 2), dept ? 'department' : 'team', x + PAD_X, top, 'start', dept ? 'white' : 'ink');
  if (options.arabic && unit.nameAr) {
    const font = dept ? 'departmentAr' : 'teamAr';
    at = addLines(lines, wrapText(unit.nameAr, textW * FIT, font, measure, 2), font, x + PAD_X + textW, at, 'end', dept ? 'paleOnDark' : 'muted');
  }
  at = Math.max(at, pill.y + pill.h);
  return { kind, id: unit.id, x, y, w, h: at + PAD_Y + 1 - y, vacant: false, lines, pill, rule: null, logo: null };
}

/** The company at the top, at x = 0 (moved over its departments once they are placed): its logo, names and numbers. */
function companyBox(c: Ctx): ChartBox {
  const { chart, options, measure } = c;
  const counts = countChart(chart);
  const textX = COMPANY_PAD + (options.logo ? LOGO + 12 : 0);
  const room = (COMPANY_MAX - textX - COMPANY_PAD) * FIT;
  const name = wrapText(chart.company.nameEn, room, 'company', measure, 2);
  const nameAr = options.arabic && chart.company.nameAr ? wrapText(chart.company.nameAr, room, 'companyAr', measure, 2) : [];
  const note = truncate(
    [plural(counts.departments, 'department', 'departments'), plural(counts.jobTitles, 'job title', 'job titles'), plural(counts.people, 'person', 'people')].join(' · '),
    room,
    'companyNote',
    measure,
  );
  const widest = Math.max(
    ...name.map((l) => measure(l, 'company')),
    ...nameAr.map((l) => measure(l, 'companyAr')),
    measure(note, 'companyNote'),
  );
  const w = Math.min(COMPANY_MAX, Math.max(COMPANY_MIN, Math.ceil(textX + widest / FIT + COMPANY_PAD)));
  const textH = name.length * FONTS.company.lineHeight + nameAr.length * FONTS.companyAr.lineHeight + FONTS.companyNote.lineHeight + 2;
  const h = Math.max(options.logo ? LOGO : 0, textH) + 2 * COMPANY_PAD;
  const y = MARGIN;
  const lines: TextLine[] = [];
  let at = y + (h - textH) / 2;
  at = addLines(lines, name, 'company', textX, at, 'start', 'white');
  at = addLines(lines, nameAr, 'companyAr', w - COMPANY_PAD, at, 'end', 'paleOnDark');
  addLines(lines, [note], 'companyNote', textX, at + 2, 'start', 'paleOnDark');
  const logo = options.logo ? { x: COMPANY_PAD, y: y + (h - LOGO) / 2, size: LOGO } : null;
  return { kind: 'company', id: 'company', x: 0, y, w, h, vacant: false, lines, pill: null, rule: null, logo };
}

/** The box moved right by dx. */
function moved(box: ChartBox, dx: number): ChartBox {
  return {
    ...box,
    x: box.x + dx,
    lines: box.lines.map((l) => ({ ...l, x: l.x + dx })),
    logo: box.logo && { ...box.logo, x: box.logo.x + dx },
  };
}

// ---------- blocks ----------

/**
 * A department or team at (x, y), `w` wide, with everything under it stacked: its job titles, then its teams (each with
 * its own job titles), each stepped in, hanging from a line down its left side. Answers how far down it reaches.
 */
function stack(c: Ctx, kind: 'department' | 'team', unit: OrgChartTeam, teams: OrgChartTeam[], x: number, y: number, w: number): number {
  const head = unitBox(c, kind, unit, peopleIn(titlesIn(unit, teams)), x, y, w);
  c.boxes.push(head);
  const spine = x + SPINE;
  let cursor = head.y + head.h + ROW_GAP;
  let last = 0;
  for (const t of unit.jobTitles) {
    const box = titleBox(c, t, x + INDENT, cursor, w - INDENT);
    c.boxes.push(box);
    last = box.y + JOIN;
    link(c, spine, last, box.x, last);
    cursor = box.y + box.h + ROW_GAP;
  }
  for (const team of teams) {
    last = cursor + JOIN;
    link(c, spine, last, x + INDENT, last);
    cursor = stack(c, 'team', team, [], x + INDENT, cursor, w - INDENT) + ROW_GAP;
  }
  if (last) link(c, spine, head.y + head.h, spine, last);
  return cursor - ROW_GAP;
}

/** The width of a department whose teams are side by side: a column each. */
export const spreadWidth = (teams: number) => Math.max(COLUMN, teams * COLUMN + (teams - 1) * TEAM_GAP);

/**
 * A department at (x, y) with its teams side by side under it, `w` wide: the department over the middle, its own job
 * titles under it, then a line across to each team, which has its job titles stacked under it.
 */
function spread(c: Ctx, d: OrgChartDepartment, x: number, y: number, w: number): number {
  const dx = x + (w - COLUMN) / 2;
  const head = unitBox(c, 'department', d, peopleIn(titlesIn(d, d.teams)), dx, y, COLUMN);
  c.boxes.push(head);
  const spine = dx + SPINE;
  let cursor = head.y + head.h + ROW_GAP;
  for (const t of d.jobTitles) {
    const box = titleBox(c, t, dx + INDENT, cursor, COLUMN - INDENT);
    c.boxes.push(box);
    link(c, spine, box.y + JOIN, box.x, box.y + JOIN);
    cursor = box.y + box.h + ROW_GAP;
  }
  const bus = cursor - ROW_GAP + BUS_GAP;
  const top = bus + BUS_GAP;
  let bottom = top;
  const centres = d.teams.map((team, i) => {
    const tx = x + i * (COLUMN + TEAM_GAP);
    bottom = Math.max(bottom, stack(c, 'team', team, [], tx, top, COLUMN));
    link(c, tx + COLUMN / 2, bus, tx + COLUMN / 2, top);
    return tx + COLUMN / 2;
  });
  link(c, spine, head.y + head.h, spine, bus);
  link(c, Math.min(spine, ...centres), bus, Math.max(spine, ...centres), bus);
  return bottom;
}

/** The whole chart with these departments' teams side by side. */
function build(chart: OrgChart, options: ChartOptions, measure: Measure, sideBySide: ReadonlySet<string>): ChartLayout {
  const c: Ctx = { chart, options, measure, boxes: [], links: [] };
  const company = companyBox(c);
  const blocks = chart.departments.map((d) => {
    const wide = sideBySide.has(d.id) && d.teams.length > 0;
    return { d, wide, w: wide ? spreadWidth(d.teams.length) : COLUMN };
  });
  const contentW = blocks.reduce((n, b) => n + b.w, 0) + DEPT_GAP * Math.max(0, blocks.length - 1);
  const innerW = Math.max(contentW, company.w);
  const bus = company.y + company.h + LEVEL_GAP;
  const top = bus + LEVEL_GAP;

  let x = MARGIN + (innerW - contentW) / 2; // under the middle of the company when it is the wider
  const columns: ChartLayout['columns'] = [];
  for (const { d, wide, w } of blocks) {
    const bottom = wide ? spread(c, d, x, top, w) : stack(c, 'department', d, d.teams, x, top, w);
    link(c, x + w / 2, bus, x + w / 2, top);
    columns.push({ id: d.id, x, w, bottom });
    x += w + DEPT_GAP;
  }

  // the company over the middle of its first and last departments, inside the chart
  const centres = columns.map((col) => col.x + col.w / 2);
  const middle = centres.length ? (centres[0] + centres[centres.length - 1]) / 2 : MARGIN + innerW / 2;
  const placed = moved(company, Math.min(Math.max(middle - company.w / 2, MARGIN), MARGIN + innerW - company.w));
  if (centres.length) {
    const trunk = placed.x + placed.w / 2;
    link(c, trunk, placed.y + placed.h, trunk, bus);
    link(c, Math.min(trunk, ...centres), bus, Math.max(trunk, ...centres), bus);
  }

  const bottom = Math.max(placed.y + placed.h, ...columns.map((col) => col.bottom));
  const note: TextLine[] = [];
  const end = addLines(note, wrapText(NOTE, innerW * FIT, 'note', measure, 3), 'note', MARGIN, bottom + NOTE_GAP, 'start', 'muted');
  return {
    width: innerW + 2 * MARGIN,
    height: Math.ceil(end + MARGIN),
    boxes: [placed, ...c.boxes],
    links: c.links,
    note,
    spread: blocks.filter((b) => b.wide).map((b) => b.d.id),
    columns,
  };
}

/** How far a chart's shape is from `aspect` (width ÷ height), either way. */
const offShape = (l: ChartLayout, aspect: number) => Math.abs(Math.log(l.width / l.height / aspect));

/** Text widths remembered: the chart is laid out more than once when it is fitted to the page. */
function remembered(measure: Measure): Measure {
  const known = new Map<string, number>();
  return (text, font) => {
    const key = `${font}\u0000${text}`;
    let w = known.get(key);
    if (w === undefined) known.set(key, (w = measure(text, font)));
    return w;
  };
}

/** The org chart laid out as `options` say. */
export function layoutChart(chart: OrgChart, options: ChartOptions, measure: Measure): ChartLayout {
  const m = remembered(measure);
  if (options.arrangement === 'stacked') return build(chart, options, m, new Set());
  if (options.arrangement === 'spread') return build(chart, options, m, new Set(chart.departments.map((d) => d.id)));

  // Fit a landscape page: while the chart is taller than the page's shape, put the teams of the department that reaches
  // furthest down side by side, as long as that brings the chart nearer the shape. The tallest department sets the
  // chart's height, so when its teams can't go side by side (it has fewer than two, or they already are), nothing can.
  const wide = new Set<string>();
  let best = build(chart, options, m, wide);
  while (best.width / best.height < options.aspect && best.columns.length) {
    const tallest = best.columns.reduce((a, b) => (b.bottom > a.bottom ? b : a));
    const d = chart.departments.find((x) => x.id === tallest.id);
    if (!d || wide.has(d.id) || d.teams.length < 2) break;
    const tried = build(chart, options, m, new Set([...wide, d.id]));
    if (offShape(tried, options.aspect) >= offShape(best, options.aspect)) break;
    wide.add(d.id);
    best = tried;
  }
  return best;
}
