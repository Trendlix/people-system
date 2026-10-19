// Where the org chart puts everything: departments side by side in their order, what belongs to each under it, the lines
// between them, and the shape it takes for a landscape page.
import { describe, expect, it } from 'vitest';
import type { OrgChart, OrgChartDepartment, OrgChartJobTitle, OrgChartPerson, OrgChartTeam } from '@/lib/types';
import { FONTS, type Measure } from './text';
import {
  COLUMN,
  countChart,
  DEPT_GAP,
  INDENT,
  JOIN,
  layoutChart,
  MARGIN,
  ROW_GAP,
  SPINE,
  spreadWidth,
  TEAM_GAP,
  type ChartBox,
  type ChartLayout,
  type ChartOptions,
} from './tree';

/** Every character half its font size wide, and a little more: close to Arial, and easy to reason about. */
const measure: Measure = (text, font) => Array.from(text).length * FONTS[font].size * 0.55;

let seq = 0;
const title = (titleEn: string, headcount = 1, more: Partial<OrgChartJobTitle> = {}): OrgChartJobTitle => ({
  id: `title-${++seq}`,
  titleEn,
  titleAr: null,
  headcount,
  ...more,
});
const team = (nameEn: string, jobTitles: OrgChartJobTitle[] = [], nameAr: string | null = null): OrgChartTeam => ({ id: `team-${++seq}`, nameEn, nameAr, jobTitles });
const department = (nameEn: string, jobTitles: OrgChartJobTitle[] = [], teams: OrgChartTeam[] = [], nameAr: string | null = null): OrgChartDepartment => ({
  id: `dept-${++seq}`,
  nameEn,
  nameAr,
  jobTitles,
  teams,
});
const chartOf = (departments: OrgChartDepartment[], company: Partial<OrgChart['company']> = {}): OrgChart => ({
  company: { nameEn: 'TrendLIX', nameAr: 'تريندلكس', hasLogo: false, logoVersion: null, ...company },
  showsPeople: true,
  departments,
});
const person = (fullNameEn: string, employeeCode: string, fullNameAr = 'موظف'): OrgChartPerson => ({ id: `p-${++seq}`, employeeCode, fullNameEn, fullNameAr });

const OPTIONS: ChartOptions = { people: false, codes: false, arabic: false, arrangement: 'stacked', aspect: 1.5, logo: false };
const lay = (chart: OrgChart, options: Partial<ChartOptions> = {}) => layoutChart(chart, { ...OPTIONS, ...options }, measure);

/** Marketing (Head of Marketing; Content Team with two titles; Media Team, empty), Finance (one title), HR (nothing). */
function sample() {
  const head = title('Head of Marketing', 1, { titleAr: 'رئيس التسويق' });
  const writer = title('Writer', 2, { people: [person('Adel Hassan', 'EMP-0001', 'عادل حسن'), person('Zeinab Ali', 'EMP-0002', 'زينب علي')] });
  const senior = title('Senior Writer', 0, { people: [] });
  const content = team('Content Team', [senior, writer], 'فريق المحتوى');
  const media = team('Media Team');
  const marketing = department('Marketing', [head], [content, media], 'التسويق');
  const finance = department('Finance', [title('Accountant', 3)]);
  const hr = department('Human Resources');
  return { chart: chartOf([marketing, finance, hr]), marketing, finance, hr, head, writer, senior, content, media };
}

const boxOf = (layout: ChartLayout, id: string) => {
  const box = layout.boxes.find((b) => b.id === id);
  if (!box) throw new Error(`No box for ${id}`);
  return box;
};
const bottom = (b: ChartBox) => b.y + b.h;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const hasLink = (layout: ChartLayout, x1: number, y1: number, x2: number, y2: number) =>
  layout.links.some((l) => near(l.x1, x1) && near(l.y1, y1) && near(l.x2, x2) && near(l.y2, y2));

describe('the org chart’s layout', () => {
  it('puts the departments side by side in their saved order, each a column, with the company over their middle', () => {
    const { chart, marketing, finance, hr } = sample();
    const layout = lay(chart);
    const departments = layout.boxes.filter((b) => b.kind === 'department');
    expect(departments.map((d) => d.id)).toEqual([marketing.id, finance.id, hr.id]);
    departments.forEach((d, i) => {
      expect(d.x).toBe(MARGIN + i * (COLUMN + DEPT_GAP));
      expect(d.w).toBe(COLUMN);
      expect(d.y).toBe(departments[0].y);
    });
    expect(layout.width).toBe(2 * MARGIN + 3 * COLUMN + 2 * DEPT_GAP);
    expect(layout.columns.map((c) => c.id)).toEqual([marketing.id, finance.id, hr.id]);

    const company = layout.boxes[0];
    expect(company.kind).toBe('company');
    const middle = (departments[0].x + COLUMN / 2 + departments[2].x + COLUMN / 2) / 2;
    expect(company.x + company.w / 2).toBeCloseTo(middle, 6);
    expect(bottom(company)).toBeLessThan(departments[0].y);
  });

  it('stacks a department’s own job titles, then its teams with theirs, each stepped in, one under another', () => {
    const { chart, marketing, head, content, senior, writer, media } = sample();
    const layout = lay(chart);
    const d = boxOf(layout, marketing.id);
    // the order they are drawn in: the department, then everything under it, top to bottom
    const order = layout.boxes.map((b) => b.id);
    const at = order.indexOf(marketing.id);
    expect(order.slice(at, at + 6)).toEqual([marketing.id, head.id, content.id, senior.id, writer.id, media.id]);

    const [h, c, s, w, m] = [head, content, senior, writer, media].map((x) => boxOf(layout, x.id));
    expect([h.x, h.w]).toEqual([d.x + INDENT, COLUMN - INDENT]); // the department's own job title
    expect([c.x, c.w]).toEqual([d.x + INDENT, COLUMN - INDENT]); // its teams
    expect([m.x, m.w]).toEqual([d.x + INDENT, COLUMN - INDENT]);
    expect([s.x, s.w]).toEqual([d.x + 2 * INDENT, COLUMN - 2 * INDENT]); // the team's job titles
    expect([w.x, w.w]).toEqual([d.x + 2 * INDENT, COLUMN - 2 * INDENT]);
    let above = d;
    for (const box of [h, c, s, w, m]) {
      expect(box.y).toBe(bottom(above) + ROW_GAP);
      above = box;
    }
    expect(layout.columns[0].bottom).toBe(bottom(m));
  });

  it('joins every box to the one it belongs to, and the departments to the company', () => {
    const { chart, marketing, head, content, writer, media, hr } = sample();
    const layout = lay(chart);
    const d = boxOf(layout, marketing.id);
    for (const child of [head, content, media].map((x) => boxOf(layout, x.id))) {
      expect(hasLink(layout, d.x + SPINE, child.y + JOIN, child.x, child.y + JOIN)).toBe(true);
    }
    // down the department's side, from under it to its last child
    expect(hasLink(layout, d.x + SPINE, bottom(d), d.x + SPINE, boxOf(layout, media.id).y + JOIN)).toBe(true);
    const c = boxOf(layout, content.id);
    const w = boxOf(layout, writer.id);
    expect(hasLink(layout, c.x + SPINE, w.y + JOIN, w.x, w.y + JOIN)).toBe(true);

    // the company's line down, the line across over the departments, and one down to each
    const company = layout.boxes[0];
    const trunk = company.x + company.w / 2;
    const bus = layout.links.find((l) => near(l.x1, trunk) && near(l.y1, bottom(company)))!.y2;
    const last = boxOf(layout, hr.id);
    expect(hasLink(layout, d.x + COLUMN / 2, bus, last.x + COLUMN / 2, bus)).toBe(true);
    for (const x of [d, last]) expect(hasLink(layout, x.x + COLUMN / 2, bus, x.x + COLUMN / 2, x.y)).toBe(true);
    // never a line of no length
    for (const l of layout.links) expect(l.x1 !== l.x2 || l.y1 !== l.y2).toBe(true);
  });

  it('shows a department with nothing in it, and a job title no one holds as 0, dashed', () => {
    const { chart, marketing, content, senior, hr } = sample();
    const layout = lay(chart);
    const empty = boxOf(layout, hr.id);
    expect(layout.columns[2]).toMatchObject({ id: hr.id, bottom: bottom(empty) });
    expect(empty.pill?.text).toBe('0');

    const vacant = boxOf(layout, senior.id);
    expect(vacant.vacant).toBe(true);
    expect(vacant.pill).toMatchObject({ text: '0', look: 'vacant' });
    // a department counts the people in all its job titles, its teams' too; a team, its own
    expect(boxOf(layout, marketing.id).pill?.text).toBe('3');
    expect(boxOf(layout, content.id).pill?.text).toBe('2');
  });

  it('keeps every box inside the chart, and every line of text inside its box', () => {
    const { chart } = sample();
    for (const options of [{}, { people: true, codes: true, arabic: true }, { arrangement: 'spread' as const, arabic: true }]) {
      const layout = lay(chart, options);
      for (const b of layout.boxes) {
        expect(b.x).toBeGreaterThanOrEqual(MARGIN);
        expect(b.x + b.w).toBeLessThanOrEqual(layout.width - MARGIN + 0.01);
        expect(bottom(b)).toBeLessThan(layout.height);
        for (const l of b.lines) {
          const w = measure(l.text, l.font);
          const [left, right] = l.align === 'start' ? [l.x, l.x + w] : l.align === 'end' ? [l.x - w, l.x] : [l.x - w / 2, l.x + w / 2];
          expect(left).toBeGreaterThanOrEqual(b.x);
          expect(right).toBeLessThanOrEqual(b.x + b.w);
          expect(l.y).toBeGreaterThan(b.y);
          expect(l.y).toBeLessThan(bottom(b));
        }
        if (b.pill) expect(b.pill.x + b.pill.w).toBeLessThanOrEqual(b.x + b.w);
      }
      // the key at the foot, under everything
      const lowest = Math.max(...layout.boxes.map(bottom));
      expect(layout.note.length).toBeGreaterThan(0);
      for (const l of layout.note) expect(l.y).toBeGreaterThan(lowest);
    }
  });

  it('wraps a long job title onto more lines (three at most), and its box grows', () => {
    const short = title('Writer');
    const long = title('Head of Digital Marketing, Brand Communications and Corporate Social Responsibility Strategy');
    const layout = lay(chartOf([department('Marketing', [short, long])]));
    const [s, l] = [boxOf(layout, short.id), boxOf(layout, long.id)];
    const lines = l.lines.filter((x) => x.font === 'title');
    expect(lines.length).toBe(3);
    expect(lines[2].text.endsWith('…')).toBe(true);
    expect(lines[2].y - lines[0].y).toBe(2 * FONTS.title.lineHeight);
    expect(l.h).toBeGreaterThan(s.h + FONTS.title.lineHeight);
  });

  it('adds the people under each job title only when asked, with their codes and Arabic names when asked too', () => {
    const { chart, writer } = sample();
    const plain = boxOf(lay(chart), writer.id);
    expect(plain.lines.some((l) => l.font === 'person')).toBe(false);
    expect(plain.rule).toBeNull();

    const named = boxOf(lay(chart, { people: true }), writer.id);
    expect(named.lines.filter((l) => l.font === 'person').map((l) => l.text)).toEqual(['Adel Hassan', 'Zeinab Ali']);
    expect(named.rule).not.toBeNull();
    expect(named.h).toBeGreaterThan(plain.h);
    expect(named.lines.some((l) => l.font === 'code' || l.font === 'personAr')).toBe(false);

    const full = boxOf(lay(chart, { people: true, codes: true, arabic: true }), writer.id);
    const codes = full.lines.filter((l) => l.font === 'code');
    expect(codes.map((l) => [l.text, l.align, l.x])).toEqual([
      ['EMP-0001', 'end', full.x + full.w - 10],
      ['EMP-0002', 'end', full.x + full.w - 10],
    ]);
    // a code on the same line as its name
    expect(codes[0].y).toBe(full.lines.find((l) => l.text === 'Adel Hassan')!.y);
    expect(full.lines.filter((l) => l.font === 'personAr').map((l) => [l.text, l.align])).toEqual([
      ['عادل حسن', 'end'],
      ['زينب علي', 'end'],
    ]);

    // without the names from the API (not HR, the CEO or Finance), nothing to add
    const nameless = { ...writer, people: undefined };
    const hidden = lay(chartOf([department('Content', [nameless])]), { people: true });
    expect(boxOf(hidden, writer.id).lines.some((l) => l.font === 'person')).toBe(false);
  });

  it('adds the Arabic names and titles under the English, right-aligned, only when asked', () => {
    const { chart, marketing, head, content } = sample();
    const english = lay(chart);
    expect(english.boxes.flatMap((b) => b.lines).some((l) => FONTS[l.font].arabic)).toBe(false);

    const both = lay(chart, { arabic: true });
    const ar = (id: string) => boxOf(both, id).lines.filter((l) => FONTS[l.font].arabic);
    expect(ar(marketing.id).map((l) => [l.text, l.font, l.align])).toEqual([['التسويق', 'departmentAr', 'end']]);
    expect(ar(head.id).map((l) => l.text)).toEqual(['رئيس التسويق']);
    expect(ar(content.id).map((l) => l.text)).toEqual(['فريق المحتوى']);
    expect(ar('company').map((l) => l.text)).toEqual(['تريندلكس']);
    // under the English
    const d = boxOf(both, marketing.id);
    expect(ar(marketing.id)[0].y).toBeGreaterThan(d.lines[0].y);
    expect(d.h).toBeGreaterThan(boxOf(english, marketing.id).h);
  });

  it('draws each department’s head and each team’s lead under its name (19 October 2026), unless asked not to', () => {
    const { chart, marketing, content, media } = sample();
    const hazem = person('Hazem Magdy', 'EMP-0001', 'حازم مجدي');
    const sara = person('Sara Ali', 'EMP-0012', 'سارة علي');
    marketing.head = hazem;
    content.head = sara;
    media.head = null;
    const layout = lay(chart);
    const leadOf = (l: ChartLayout, id: string) => boxOf(l, id).lines.filter((x) => x.font === 'lead' || x.font === 'leadAr');
    expect(leadOf(layout, marketing.id).map((l) => [l.text, l.tone, l.align])).toEqual([['Head: Hazem Magdy', 'paleOnDark', 'start']]);
    expect(leadOf(layout, content.id).map((l) => [l.text, l.tone])).toEqual([['Team lead: Sara Ali', 'muted']]);
    // none for a team without a lead
    expect(leadOf(layout, media.id)).toEqual([]);
    // under the name, and the box grows to hold it
    const d = boxOf(layout, marketing.id);
    expect(leadOf(layout, marketing.id)[0].y).toBeGreaterThan(d.lines[0].y);
    const without = lay(chart, { leads: false });
    expect(leadOf(without, marketing.id)).toEqual([]);
    expect(d.h).toBeGreaterThan(boxOf(without, marketing.id).h);
    // the Arabic name under it, right-aligned, with the Arabic names
    const ar = leadOf(lay(chart, { arabic: true }), content.id);
    expect(ar.map((l) => [l.text, l.font, l.align])).toEqual([
      ['Team lead: Sara Ali', 'lead', 'start'],
      ['سارة علي', 'leadAr', 'end'],
    ]);
    // an API from before leads: nothing, as before
    delete marketing.head;
    expect(leadOf(lay(chart), marketing.id)).toEqual([]);
  });

  it('cuts a long lead’s name short to fit its box', () => {
    const d = department('Marketing');
    d.head = person('Mohamed Abdel Rahman Abdel Aziz El Sayed Mostafa Ibrahim', 'EMP-0003');
    const line = boxOf(lay(chartOf([d])), d.id).lines.find((l) => l.font === 'lead')!;
    expect(line.text.startsWith('Head: Mohamed')).toBe(true);
    expect(line.text.endsWith('…')).toBe(true);
    expect(measure(line.text, 'lead')).toBeLessThanOrEqual(COLUMN - 20);
  });

  it('puts each department’s teams side by side when asked, the department over their middle', () => {
    const { chart, marketing, finance, content, media, writer } = sample();
    const layout = lay(chart, { arrangement: 'spread' });
    expect(layout.spread).toEqual([marketing.id]); // Finance and HR have no teams
    const [col] = layout.columns;
    expect(col.w).toBe(spreadWidth(2));
    expect(spreadWidth(2)).toBe(2 * COLUMN + TEAM_GAP);
    const d = boxOf(layout, marketing.id);
    expect(d.x + d.w / 2).toBeCloseTo(col.x + col.w / 2, 6);

    const [c, m] = [boxOf(layout, content.id), boxOf(layout, media.id)];
    expect(c.y).toBe(m.y);
    expect([c.x, m.x]).toEqual([col.x, col.x + COLUMN + TEAM_GAP]);
    expect([c.w, m.w]).toEqual([COLUMN, COLUMN]);
    // a team's job titles stacked under it
    const w = boxOf(layout, writer.id);
    expect([w.x, w.w]).toEqual([c.x + INDENT, COLUMN - INDENT]);
    // a line down to each team from the line across over them
    expect(hasLink(layout, c.x + COLUMN / 2, c.y - 12, c.x + COLUMN / 2, c.y)).toBe(true);
    expect(hasLink(layout, c.x + COLUMN / 2, c.y - 12, m.x + COLUMN / 2, c.y - 12)).toBe(true);
    // and down the department's side, past its own job title, to that line
    expect(hasLink(layout, d.x + SPINE, bottom(d), d.x + SPINE, c.y - 12)).toBe(true);
    expect(boxOf(layout, finance.id).x).toBe(col.x + col.w + DEPT_GAP);
    // shorter than with everything stacked
    expect(col.bottom).toBeLessThan(lay(chart).columns[0].bottom);
  });

  it('fits a landscape page: the tallest department’s teams go side by side while that helps', () => {
    const titles = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => title(`${prefix} ${i + 1}`));
    const big = department('Operations', [], [team('North', titles('North', 6)), team('South', titles('South', 6)), team('East', titles('East', 6))]);
    const small = [department('Finance', titles('Accountant', 1)), department('Legal', titles('Counsel', 1))];
    const tall = chartOf([big, ...small]);
    const stacked = lay(tall);
    expect(stacked.width / stacked.height).toBeLessThan(1.5);

    const fitted = lay(tall, { arrangement: 'balanced' });
    expect(fitted.spread).toEqual([big.id]);
    const off = (l: ChartLayout) => Math.abs(Math.log(l.width / l.height / 1.5));
    expect(off(fitted)).toBeLessThan(off(stacked));

    // a chart already wide is left as it is
    const wide = chartOf(Array.from({ length: 8 }, (_, i) => department(`Department ${i + 1}`, titles('Role', 1), [team('A'), team('B')])));
    expect(lay(wide, { arrangement: 'balanced' })).toEqual(lay(wide));

    // the tallest has a single team: nothing to put side by side, so nothing changes
    const lone = chartOf([department('Operations', [], [team('North', titles('North', 18))]), ...small]);
    expect(lay(lone, { arrangement: 'balanced' }).spread).toEqual([]);
  });

  it('leaves room for the logo beside the company’s name', () => {
    const { chart } = sample();
    const company = lay(chartOf(chart.departments, { hasLogo: true }), { logo: true }).boxes[0];
    expect(company.logo).not.toBeNull();
    const logo = company.logo!;
    expect(logo.y).toBeGreaterThan(company.y);
    expect(logo.y + logo.size).toBeLessThan(bottom(company));
    for (const l of company.lines.filter((x) => x.align === 'start')) expect(l.x).toBeGreaterThan(logo.x + logo.size);
    expect(company.lines[0].text).toBe('TrendLIX');
    expect(company.lines.at(-1)?.text).toBe('3 departments · 4 job titles · 6 people');
    expect(lay(chart).boxes[0].logo).toBeNull();
  });

  it('counts the departments, teams, job titles, people and vacancies', () => {
    expect(countChart(sample().chart)).toEqual({ departments: 3, teams: 2, jobTitles: 4, people: 6, vacant: 1 });
    expect(countChart(chartOf([]))).toEqual({ departments: 0, teams: 0, jobTitles: 0, people: 0, vacant: 0 });
  });

  it('draws the company alone when there are no departments yet', () => {
    const layout = lay(chartOf([]));
    expect(layout.boxes.map((b) => b.kind)).toEqual(['company']);
    expect(layout.links).toEqual([]);
    expect(layout.width).toBe(layout.boxes[0].w + 2 * MARGIN);
  });
});
