'use client';

import Image from 'next/image';
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { OrgChart } from '@/lib/types';
import { dataAddress, pdfFile, pngFile, saveFile, svgFile } from './export';
import { countChart, layoutChart, plural, type Arrangement } from './tree';
import { chartFileName, chartSvg, chartTitle, PAGE_ASPECT, type ChartPaper } from './svg';
import { canvasMeasure } from './text';

// The org chart, its options and its downloads (owner's request, 15 October 2026). It is drawn in the browser only:
// text is measured there, with the fonts the chart uses, so the server shows "Drawing the chart…" until then.

type Format = 'pdf' | 'png' | 'svg';

const FORMAT_NAMES: Record<Format, string> = { pdf: 'PDF', png: 'PNG', svg: 'SVG' };

const ARRANGEMENTS: { value: Arrangement; label: string }[] = [
  { value: 'balanced', label: 'Fit a landscape page' },
  { value: 'stacked', label: 'Teams under their department' },
  { value: 'spread', label: 'Teams side by side' },
];

const ZOOMS = [
  { value: 'fit', label: 'Fit to width' },
  { value: '0.5', label: '50%' },
  { value: '0.75', label: '75%' },
  { value: '1', label: '100%' },
  { value: '1.5', label: '150%' },
];

const PAPERS: { value: ChartPaper; label: string }[] = [
  { value: 'a4', label: 'A4 landscape' },
  { value: 'a3', label: 'A3 landscape' },
];

const choice =
  'flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/**
 * Printing gives only the chart (the print copy below, with its title), on a landscape page: everything else on the
 * page is left out, and what holds the chart loses its margins and widths.
 */
const PRINT_CSS = `@media print {
  @page { size: landscape; margin: 10mm; }
  body :not(.org-chart-print, .org-chart-print *, :has(.org-chart-print)) { display: none !important; }
  body :has(.org-chart-print) { display: block !important; margin: 0 !important; padding: 0 !important; border: 0 !important; max-width: none !important; min-height: 0 !important; background: none !important; }
  body { background: #fff !important; }
}`;

const noChange = () => () => {};

/** The company's logo, once fetched (null until then, and when there is none): the file for a canvas, and its data: address for the SVG. */
function useLogo(version: number | null) {
  const [logo, setLogo] = useState<{ version: number; blob: Blob; address: string } | null>(null);
  useEffect(() => {
    if (version === null) return;
    let live = true;
    fetch(`/company-logo?v=${encodeURIComponent(String(version))}`)
      .then(async (res) => {
        if (!res.ok) return;
        const blob = await res.blob();
        const address = await dataAddress(blob);
        if (live) setLogo({ version, blob, address });
      })
      .catch(() => {
        // the chart is drawn without it
      });
    return () => {
      live = false;
    };
  }, [version]);
  return logo?.version === version ? logo : null;
}

export function OrgChartView({ chart }: { chart: OrgChart }) {
  const inBrowser = useSyncExternalStore(noChange, () => true, () => false);
  const [people, setPeople] = useState(false);
  const [codes, setCodes] = useState(false);
  const [arabic, setArabic] = useState(false);
  const [arrangement, setArrangement] = useState<Arrangement>('balanced');
  const [zoom, setZoom] = useState('fit');
  const [paper, setPaper] = useState<ChartPaper>('a4');
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const [today] = useState(() => formatDate(new Date()));
  const logo = useLogo(chart.company.logoVersion);
  const id = useId();

  const measure = useMemo(() => (inBrowser ? canvasMeasure() : null), [inBrowser]);
  const withPeople = people && chart.showsPeople;
  const layout = useMemo(
    () =>
      measure &&
      layoutChart(chart, { people: withPeople, codes: withPeople && codes, arabic, arrangement, aspect: PAGE_ASPECT, logo: chart.company.hasLogo }, measure),
    [measure, chart, withPeople, codes, arabic, arrangement],
  );
  const address = useMemo(
    () => layout && `data:image/svg+xml;charset=utf-8,${encodeURIComponent(chartSvg(layout, { logo: logo?.address ?? null }))}`,
    [layout, logo],
  );

  const counts = countChart(chart);
  const company = chart.company.nameEn;
  const summary = [
    plural(counts.departments, 'department', 'departments'),
    plural(counts.teams, 'team', 'teams'),
    plural(counts.jobTitles, 'job title', 'job titles'),
    `${plural(counts.people, 'person', 'people')} in them now`,
    counts.vacant > 0 && `${counts.vacant} vacant`,
  ]
    .filter(Boolean)
    .join(' · ');
  const alt = `Organization chart of ${company}: ${summary}.`;

  async function download(format: Format) {
    if (!layout) return;
    setBusy(format);
    setError('');
    setSaid(`Making the ${FORMAT_NAMES[format]}…`);
    try {
      const date = formatDate(new Date());
      const title = chartTitle(company, date);
      const file =
        format === 'svg'
          ? svgFile(layout, logo?.address ?? null, title)
          : format === 'png'
            ? await pngFile(layout, logo?.blob ?? null)
            : await pdfFile(layout, logo?.blob ?? null, paper, title);
      saveFile(file, chartFileName(company, date, format));
      setSaid(`The ${FORMAT_NAMES[format]} is downloaded.`);
    } catch (err) {
      setSaid('');
      setError(`The ${FORMAT_NAMES[format]} could not be made. ${err instanceof Error ? err.message : 'Please try again.'}`);
    } finally {
      setBusy(null);
    }
  }

  const size = layout && {
    width: zoom === 'fit' ? layout.width : Math.round(layout.width * Number(zoom)),
    maxWidth: zoom === 'fit' ? '100%' : 'none',
    height: 'auto',
  };

  return (
    <div className="space-y-4">
      <section aria-label="Chart options" className="card space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <fieldset>
            <legend className="label">Show</legend>
            <div className="flex flex-wrap gap-2">
              {chart.showsPeople && (
                <label className={choice}>
                  <input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} className="size-4 accent-accent" />
                  People’s names
                </label>
              )}
              {withPeople && (
                <label className={choice}>
                  <input type="checkbox" checked={codes} onChange={(e) => setCodes(e.target.checked)} className="size-4 accent-accent" />
                  Employee codes
                </label>
              )}
              <label className={choice}>
                <input type="checkbox" checked={arabic} onChange={(e) => setArabic(e.target.checked)} className="size-4 accent-accent" />
                Arabic names and titles
              </label>
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-arrangement`} className="label">
              Arrangement
            </label>
            <Select
              id={`${id}-arrangement`}
              value={arrangement}
              onChange={(e) => setArrangement(e.target.value as Arrangement)}
              aria-describedby={`${id}-arrangement-hint`}
              className="input w-auto"
            >
              {ARRANGEMENTS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={`${id}-zoom`} className="label">
              Zoom
            </label>
            <Select id={`${id}-zoom`} value={zoom} onChange={(e) => setZoom(e.target.value)} className="input w-auto">
              {ZOOMS.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p id={`${id}-arrangement-hint`} className="hint">
          {arrangement === 'balanced'
            ? 'Puts the teams of the longest departments side by side, so the chart takes the shape of a landscape page.'
            : arrangement === 'stacked'
              ? 'Each department is one column, with its teams one under another.'
              : 'Each department’s teams are side by side under it: wider, and shorter.'}
        </p>

        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <div className="mr-1">
            <label htmlFor={`${id}-paper`} className="label">
              PDF page
            </label>
            <Select id={`${id}-paper`} value={paper} onChange={(e) => setPaper(e.target.value as ChartPaper)} className="input w-auto">
              {PAPERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <button type="button" disabled={!layout || busy !== null} onClick={() => download('pdf')} className="btn btn-primary">
            {busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}
          </button>
          <button type="button" disabled={!layout || busy !== null} onClick={() => download('png')} className="btn btn-secondary">
            {busy === 'png' ? 'Making PNG…' : 'Download PNG'}
          </button>
          <button type="button" disabled={!layout || busy !== null} onClick={() => download('svg')} className="btn btn-secondary">
            {busy === 'svg' ? 'Making SVG…' : 'Download SVG'}
          </button>
          <button type="button" disabled={!layout} onClick={() => window.print()} className="btn btn-secondary">
            Print
          </button>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      </section>

      <p className="text-sm text-muted">{summary}</p>

      {layout && address && size ? (
        <>
          <div className="card overflow-x-auto p-2">
            <Image src={address} alt={alt} width={layout.width} height={layout.height} unoptimized loading="eager" style={size} className="block" />
          </div>
          {/* what is printed: the chart under its title, as large as the page allows */}
          <div className="org-chart-print hidden print:block">
            <p className="mb-3 text-base font-semibold">{chartTitle(company, today)}</p>
            <Image
              src={address}
              alt={alt}
              width={layout.width}
              height={layout.height}
              unoptimized
              loading="eager"
              className="block h-auto w-full object-contain"
              style={{ maxHeight: '170mm' }}
            />
          </div>
          <style>{PRINT_CSS}</style>
        </>
      ) : (
        <p className="py-8 text-sm text-muted">Drawing the chart…</p>
      )}
    </div>
  );
}
