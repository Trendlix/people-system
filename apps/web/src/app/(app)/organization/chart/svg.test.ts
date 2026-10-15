// The org chart as SVG, the PDF's page, and the files' names.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OrgChart } from '@/lib/types';
import {
  chartFileName,
  chartSvg,
  chartTitle,
  containIn,
  esc,
  logoRect,
  MAX_AREA,
  PAGE_ASPECT,
  pageDpi,
  pagePlan,
  pageSvg,
  PALETTE,
  pngScale,
} from './svg';
import { FONTS, type Measure } from './text';
import { layoutChart, type ChartLayout, type ChartOptions } from './tree';

const measure: Measure = (text, font) => Array.from(text).length * FONTS[font].size * 0.55;
const RLE = String.fromCharCode(0x202b);
const PDF = String.fromCharCode(0x202c);

const chart: OrgChart = {
  company: { nameEn: 'Trend & Co <Egypt>', nameAr: 'تريند', hasLogo: true, logoVersion: 1 },
  showsPeople: true,
  departments: [
    {
      id: 'd1',
      nameEn: 'Marketing',
      nameAr: 'التسويق',
      jobTitles: [{ id: 't1', titleEn: 'Head of Marketing', titleAr: 'رئيس التسويق', headcount: 1 }],
      teams: [{ id: 'd2', nameEn: 'Content Team', nameAr: null, jobTitles: [{ id: 't2', titleEn: 'Writer', titleAr: null, headcount: 0 }] }],
    },
    { id: 'd3', nameEn: 'Finance', nameAr: null, jobTitles: [], teams: [] },
  ],
};
const OPTIONS: ChartOptions = { people: false, codes: false, arabic: true, arrangement: 'stacked', aspect: PAGE_ASPECT, logo: true };
const layout = layoutChart(chart, OPTIONS, measure);

describe('the chart as SVG', () => {
  it('uses the theme’s colours, as globals.css has them', () => {
    const css = readFileSync(new URL('../../../globals.css', import.meta.url), 'utf8');
    const names: Record<keyof typeof PALETTE, string> = {
      ink: 'ink',
      muted: 'muted',
      line: 'line',
      canvas: 'canvas',
      card: 'card',
      accent: 'accent',
      accentSoft: 'accent-soft',
      sidebar: 'sidebar',
      sidebarText: 'sidebar-text',
    };
    for (const [key, name] of Object.entries(names)) {
      expect(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1].toLowerCase(), name).toBe(PALETTE[key as keyof typeof PALETTE]);
    }
  });

  it('is a whole SVG file, its size that of the chart, larger when scaled with the same drawing', () => {
    const svg = chartSvg(layout, { title: 'Organization chart' });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain(`width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"`);
    expect(svg).toContain('<title>Organization chart</title>');
    const big = chartSvg(layout, { scale: 3 });
    expect(big).toContain(`width="${layout.width * 3}" height="${layout.height * 3}" viewBox="0 0 ${layout.width} ${layout.height}"`);
    // every element closed
    expect(svg.match(/<text /g)?.length).toBe(svg.match(/<\/text>/g)?.length);
    expect(svg.match(/<text /g)?.length).toBe(layout.boxes.reduce((n, b) => n + b.lines.length + (b.pill ? 1 : 0), 0) + layout.note.length);
  });

  it('writes the names safely, Arabic ones right-aligned, right to left, in an Arabic font', () => {
    const svg = chartSvg(layout);
    expect(svg).toContain('>Trend &amp; Co &lt;Egypt&gt;</text>');
    expect(svg).not.toContain('<Egypt>');
    const arabic = /<text ([^>]*)>([^<]*التسويق[^<]*)<\/text>/.exec(svg)!;
    expect(arabic[1]).toContain('text-anchor="end"');
    expect(arabic[1]).toContain('xml:lang="ar"');
    expect(arabic[1]).toContain('font-family="Tahoma');
    expect(arabic[1]).not.toContain('direction'); // see svg.ts: the marks, rather than direction="rtl"
    expect(arabic[2]).toBe(`${RLE}التسويق${PDF}`);
    // English text in the chart's own font, from the left
    expect(/<text ([^>]*)>Finance<\/text>/.exec(svg)![1]).not.toContain('text-anchor');
  });

  it('draws a job title no one holds dashed, and the logo only when it is given', () => {
    const svg = chartSvg(layout);
    expect(svg.match(/stroke-dasharray/g)).toHaveLength(1);
    expect(svg).not.toContain('<image');
    const withLogo = chartSvg(layout, { logo: 'data:image/png;base64,AAAA' });
    expect(withLogo).toContain('<image x="');
    expect(withLogo).toContain('href="data:image/png;base64,AAAA" xlink:href="data:image/png;base64,AAAA"');
  });

  it('escapes what XML can’t hold', () => {
    expect(esc(`a & b < c > "d" 'e'`)).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
    expect(esc(`one${String.fromCharCode(1)}two${String.fromCharCode(0xffff)}`)).toBe('one two ');
  });
});

describe('the PDF’s page', () => {
  it('is drawn at 300 dpi, or less for A3 so the picture stays under what every browser draws', () => {
    expect(pageDpi('a4')).toBe(300);
    expect(pageDpi('a3')).toBe(287);
    const a3 = pagePlan(layout, 'a3');
    expect(a3.width * a3.height).toBeLessThanOrEqual(MAX_AREA);
  });

  it('is a landscape sheet with the title at the top and the chart under it, as large as fits, centred across', () => {
    const plan = pagePlan(layout, 'a4');
    expect([plan.width, plan.height]).toEqual([3508, 2480]);
    const mm = 300 / 25.4;
    expect(plan.heading.x).toBeCloseTo(10 * mm, 6);
    const { x, y, scale } = plan.chart;
    expect(y).toBeGreaterThan(plan.heading.y);
    expect(x).toBeGreaterThanOrEqual(10 * mm - 0.01);
    expect(x + layout.width * scale).toBeLessThanOrEqual(plan.width - 10 * mm + 0.01);
    expect(y + layout.height * scale).toBeLessThanOrEqual(plan.height - 10 * mm + 0.01);
    // it touches the margins one way or the other
    const fillsAcross = Math.abs(layout.width * scale - (plan.width - 20 * mm)) < 0.01;
    const fillsDown = Math.abs(y + layout.height * scale - (plan.height - 10 * mm)) < 0.01;
    expect(fillsAcross || fillsDown).toBe(true);
    expect(x - 10 * mm).toBeCloseTo(plan.width - 10 * mm - (x + layout.width * scale), 6);
  });

  it('on A3 is the A4 page made larger', () => {
    const a4 = pagePlan(layout, 'a4', 300);
    const a3 = pagePlan(layout, 'a3', 300);
    expect(a3.width / a4.width).toBeCloseTo(Math.SQRT2, 2);
    expect(a3.heading.size / a4.heading.size).toBeCloseTo(Math.SQRT2, 6);
    expect(a3.chart.scale / a4.chart.scale).toBeCloseTo(Math.SQRT2, 2);
  });

  it('aims "Fit a landscape page" at the room under the title', () => {
    expect(PAGE_ASPECT).toBeCloseTo(277 / 179.4, 6);
  });

  it('puts the title and the chart in one SVG of the page’s size', () => {
    const plan = pagePlan(layout, 'a4');
    const svg = pageSvg(layout, plan, chartTitle('TrendLIX', '15/10/2026'));
    expect(svg).toContain(`width="3508" height="2480" viewBox="0 0 3508 2480"`);
    expect(svg).toContain('>Organization chart — TrendLIX — 15/10/2026</text>');
    expect(svg).toContain(`<g transform="translate(${Math.round(plan.chart.x * 10) / 10} ${Math.round(plan.chart.y * 10) / 10}) scale(${plan.chart.scale})">`);
  });
});

describe('the PNG and the logo on a canvas', () => {
  it('makes the PNG three times the chart’s size, or less for a chart too large to draw that big', () => {
    expect(pngScale(layout)).toBe(3);
    const huge = { ...layout, width: 6000, height: 3000 } as ChartLayout;
    const k = pngScale(huge);
    expect(k).toBeLessThan(3);
    expect(huge.width * k * huge.height * k).toBeLessThanOrEqual(MAX_AREA + 1);
  });

  it('puts the logo in its square, inset, scaled and moved with the chart', () => {
    const square = layout.boxes[0].logo!;
    expect(logoRect(layout, 1)).toEqual({ x: square.x + 5, y: square.y + 5, w: square.size - 10, h: square.size - 10 });
    expect(logoRect(layout, 2, 100, 50)).toEqual({ x: 100 + (square.x + 5) * 2, y: 50 + (square.y + 5) * 2, w: (square.size - 10) * 2, h: (square.size - 10) * 2 });
    expect(logoRect(layoutChart(chart, { ...OPTIONS, logo: false }, measure), 1)).toBeNull();
  });

  it('fits a picture inside a box whole, centred', () => {
    expect(containIn({ x: 0, y: 0, w: 40, h: 40 }, 200, 100)).toEqual({ x: 0, y: 10, w: 40, h: 20 });
    expect(containIn({ x: 10, y: 10, w: 40, h: 40 }, 50, 100)).toEqual({ x: 20, y: 10, w: 20, h: 40 });
  });
});

describe('names', () => {
  it('titles the PDF with the company and the date, DD/MM/YYYY', () => {
    expect(chartTitle(' TrendLIX ', '15/10/2026')).toBe('Organization chart — TrendLIX — 15/10/2026');
  });

  it('names the file after the company and the date, with nothing a file name can’t have', () => {
    expect(chartFileName('TrendLIX', '15/10/2026', 'pdf')).toBe('Organization chart - TrendLIX - 15-10-2026.pdf');
    expect(chartFileName('Trend/LIX: "Egypt" <HQ>', '01/02/2026', 'png')).toBe('Organization chart - Trend LIX Egypt HQ - 01-02-2026.png');
    expect(chartFileName(`  ..Hidden${String.fromCharCode(9)}Co.  `, '15/10/2026', 'svg')).toBe('Organization chart - Hidden Co - 15-10-2026.svg');
    expect(chartFileName('تريندلكس', '15/10/2026', 'pdf')).toBe('Organization chart - تريندلكس - 15-10-2026.pdf');
    expect(chartFileName('', '15/10/2026', 'pdf')).toBe('Organization chart - 15-10-2026.pdf');
    const long = chartFileName('A'.repeat(200), '15/10/2026', 'pdf');
    expect(long).toBe(`Organization chart - ${'A'.repeat(80)} - 15-10-2026.pdf`);
  });
});
