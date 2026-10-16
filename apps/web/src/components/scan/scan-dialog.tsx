'use client';

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Select } from '@/components/select';
import {
  addScanner,
  canDuplex,
  COLOUR_LABELS,
  COLOUR_MODES,
  DEFAULT_RESOLUTION,
  defaultSettings,
  formatSize,
  helperStatus,
  hostOf,
  isCancelled,
  isUnreachable,
  listScanners,
  localNetworkPermission,
  scan,
  SCAN_HELPER_DOWNLOADS,
  scanErrorMessage,
  SOURCE_LABELS,
  SOURCES,
  TIMEOUTS,
  tooLargeAdvice,
  type NetworkPermission,
  type ScanOptions,
  type ScanPurpose,
  type ScanResult,
  type ScanSettings,
  type ScanSource,
  type Scanner,
} from '@/lib/scan-helper';
import { useBlobAddress } from './blob-address';

// Scanning from an office scanner, then checking the scan before it is used (owner's words: "from the scanner directly,
// check it, then confirm it"). A Scan button opens a pop-up window (a native modal <dialog>: focus stays in it, Esc
// closes it, and focus goes back to the button) that talks to the TrendLIX Scan Helper on this computer (lib/scan-helper):
//   1. is the helper running? If not, how to install it (once per computer), and Try again;
//   2. the scanners it found, the one chosen last time first (kept in this browser), Refresh, and Add by IP address;
//   3. the settings, limited to what the chosen scanner can do: glass or feeder, two-sided, colour, resolution;
//   4. Scan, which can be cancelled; then the PDF in the browser's own viewer, with its pages and size;
//   5. Use this scan (the PDF goes to `onScanned`, e.g. put on a file box), or Scan again.
// Closing the window stops whatever it was waiting for.

const SCANNER_KEY = 'trendlix-scan:scanner';
const SCANNED_KEY = 'trendlix-scan:scanned';

/** What this browser remembers: the scanner chosen last, and whether it has scanned before. Nothing when storage is blocked. */
function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // a private window, or storage blocked: it is not remembered, which is all
  }
}

type Phase =
  /** Looking for the helper. `asking`: the browser may be asking whether this site may reach the local network. */
  | { at: 'checking'; asking: boolean }
  /** The helper does not answer (`checking`: looking again after Try again). */
  | { at: 'missing'; checking: boolean }
  /** The browser does not let this site reach the local network. */
  | { at: 'blocked'; checking: boolean }
  | { at: 'ready' }
  | { at: 'scanning'; source: ScanSource }
  | { at: 'preview'; scan: ScanResult; settings: ScanSettings; scanner: Scanner };

const pagesText = (pages: number | null) => (pages ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : null);

function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`${className} shrink-0 animate-spin text-accent motion-reduce:animate-none`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ScannerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0">
      <path d="M2.5 11.5h15v3.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-3.5Z" />
      <path d="M2.5 11.5 15.5 4" />
      <path d="M5.5 14h3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0">
      <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 15.5h12" />
    </svg>
  );
}

/** A choice among a few (glass or feeder, colour…), as a radio button in a box that shows when it is chosen. */
function Choice({ name, checked, onChoose, children }: { name: string; checked: boolean; onChoose: () => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
      <input type="radio" name={name} checked={checked} onChange={onChoose} className="size-4 accent-accent" />
      {children}
    </label>
  );
}

/** The scan as it came from the scanner: the PDF in the browser's own viewer, its name, pages and size. */
function ScanPreview({ result, problem }: { result: ScanResult; problem: string | null }) {
  const frame = useBlobAddress(result.file);
  const link = useBlobAddress(result.file);
  const details = [pagesText(result.pages), formatSize(result.file.size)].filter(Boolean).join(' · ');
  return (
    <div className="space-y-3">
      <p className="text-sm">Check the scan: every page there, the right way up, and readable. Then use it, or scan again.</p>
      <iframe ref={frame} title={`The scan, ${result.file.name}`} className="h-[min(60dvh,40rem)] w-full rounded-md border border-line bg-white" />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <p className="min-w-0 break-words">
          <span className="font-medium">{result.file.name}</span>
          <span className="text-muted"> · {details}</span>
        </p>
        <a ref={link} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center font-semibold text-accent hover:underline">
          Open in a new tab<span className="sr-only">: the scan</span>
        </a>
      </div>
      {result.warning && (
        <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {result.warning}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

interface ScanWindowProps {
  title: string;
  hint?: React.ReactNode;
  purpose: ScanPurpose;
  maxBytes?: number;
  onScanned: (result: ScanResult) => void;
  onClosed: () => void;
}

/** The pop-up window, only in the page while it is open: shown as a modal as soon as it is added, at the end of the page. */
function ScanWindow({ title, hint, purpose, maxBytes, onScanned, onClosed }: ScanWindowProps) {
  const titleId = useId();
  const fid = useId();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const attach = useCallback((el: HTMLDialogElement | null) => {
    dialog.current = el;
    if (el && !el.open) el.showModal();
  }, []);

  const [phase, setPhase] = useState<Phase>({ at: 'checking', asking: false });
  const [permission, setPermission] = useState<NetworkPermission>('unknown');
  const [version, setVersion] = useState('');
  const [scannedBefore, setScannedBefore] = useState(() => remembered(SCANNED_KEY) === '1');
  const [scanners, setScanners] = useState<Scanner[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [scannerId, setScannerId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ address: string; busy: boolean; error: string } | null>(null);
  /** Said to screen readers as the window moves on (what is seen says it too). */
  const [said, say] = useState('');

  const scanner = scanners?.find((s) => s.id === scannerId) ?? null;

  // Everything the window is waiting for, stopped when it closes; the scan on its own too, for Cancel scan.
  const live = useRef(new Set<AbortController>());
  const scanning = useRef<AbortController | null>(null);
  function begin(): AbortController {
    const c = new AbortController();
    live.current.add(c);
    return c;
  }
  const done = (c: AbortController) => live.current.delete(c);

  const close = () => dialog.current?.close();

  // ---------- the helper ----------

  async function connect() {
    const c = begin();
    try {
      const allowed = await localNetworkPermission();
      if (c.signal.aborted) return;
      setPermission(allowed);
      if (allowed === 'prompt') setPhase((p) => (p.at === 'checking' ? { at: 'checking', asking: true } : p));
      const status = await helperStatus({ signal: c.signal, timeout: allowed === 'prompt' ? TIMEOUTS.statusAsking : TIMEOUTS.status });
      if (!status) {
        setPhase(allowed === 'denied' ? { at: 'blocked', checking: false } : { at: 'missing', checking: false });
        say(allowed === 'denied' ? 'The browser is blocking access to the Scan Helper.' : "The TrendLIX Scan Helper isn't running on this computer.");
        return;
      }
      setVersion(status.version);
      setPermission(await localNetworkPermission()); // the browser may have asked, and been answered, meanwhile
      setPhase({ at: 'ready' });
    } catch {
      return; // cancelled: the window was closed
    } finally {
      done(c);
    }
    await find(false);
  }

  function retry() {
    setPhase((p) => (p.at === 'missing' || p.at === 'blocked' ? { ...p, checking: true } : p));
    void connect();
  }

  const start = useEffectEvent(() => void connect());
  useEffect(() => {
    start();
    const all = live.current;
    return () => {
      all.forEach((c) => c.abort());
      all.clear();
    };
  }, []);

  // ---------- scanners ----------

  /** Chooses a scanner, with the settings it starts with. `chosen`: by the person, so it is remembered for next time. */
  function pick(next: Scanner | null, chosen: boolean) {
    setScannerId(next?.id ?? null);
    setSettings(next ? defaultSettings(next, purpose) : null);
    if (next && chosen) remember(SCANNER_KEY, next.id);
  }

  async function find(refresh: boolean) {
    const c = begin();
    setFinding(true);
    setError(null);
    setNote(null);
    say(refresh ? 'Looking for scanners again…' : 'Looking for scanners…');
    try {
      const found = await listScanners(refresh, { signal: c.signal });
      setScanners(found);
      // the scanner chosen stays chosen; else the one chosen last time, else the first
      const keep = found.find((s) => s.id === scannerId) ?? found.find((s) => s.id === remembered(SCANNER_KEY)) ?? found[0] ?? null;
      if (keep?.id !== scannerId) pick(keep, false);
      say(found.length === 0 ? 'No scanner was found.' : found.length === 1 ? `One scanner found: ${found[0].name}.` : `${found.length} scanners found.`);
    } catch (e) {
      if (isCancelled(e)) return;
      if (isUnreachable(e)) {
        setPhase({ at: 'missing', checking: false });
        return;
      }
      setError(scanErrorMessage(e));
    } finally {
      done(c);
      setFinding(false);
    }
  }

  const addToggle = useRef<HTMLButtonElement>(null);
  const addField = useRef<HTMLInputElement>(null);

  function stopAdding() {
    setAdding(null);
    requestAnimationFrame(() => addToggle.current?.focus());
  }

  function toggleAdding() {
    if (adding) return stopAdding();
    setAdding({ address: '', busy: false, error: '' });
    requestAnimationFrame(() => addField.current?.focus());
  }

  async function add() {
    if (!adding || adding.busy) return;
    const address = adding.address.trim();
    if (!address) {
      setAdding({ ...adding, error: "Type the scanner's IP address, e.g. 192.168.1.50." });
      addField.current?.focus();
      return;
    }
    const c = begin();
    setAdding({ ...adding, busy: true, error: '' });
    try {
      const added = await addScanner(address, { signal: c.signal });
      setScanners((list) => [...(list ?? []).filter((s) => s.id !== added.id), added]);
      pick(added, true);
      setAdding(null);
      setError(null);
      setNote(`${added.name} was added, and is chosen.`);
      requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>(`input[name="${fid}scanner"]:checked`)?.focus());
    } catch (e) {
      if (isCancelled(e)) return;
      if (isUnreachable(e)) {
        setAdding(null);
        setPhase({ at: 'missing', checking: false });
        return;
      }
      setAdding((a) => a && { ...a, busy: false, error: scanErrorMessage(e) });
      addField.current?.focus();
    } finally {
      done(c);
    }
  }

  // ---------- scanning ----------

  async function startScan() {
    if (!scanner || !settings) return;
    const options: ScanOptions = { scannerId: scanner.id, ...settings, duplex: settings.duplex && canDuplex(scanner, settings.source) };
    const c = begin();
    scanning.current = c;
    setError(null);
    setNote(null);
    setAdding(null);
    setPhase({ at: 'scanning', source: options.source });
    say('Scanning…');
    try {
      const result = await scan(options, { signal: c.signal });
      remember(SCANNED_KEY, '1');
      remember(SCANNER_KEY, scanner.id);
      setScannedBefore(true);
      setPhase({ at: 'preview', scan: result, settings: options, scanner });
      say(`The scan is ready: ${[pagesText(result.pages), formatSize(result.file.size)].filter(Boolean).join(', ')}. Check it, then use it or scan again.`);
    } catch (e) {
      if (isUnreachable(e)) {
        setPhase({ at: 'missing', checking: false });
        return;
      }
      setPhase({ at: 'ready' });
      if (isCancelled(e)) setNote('Scanning was cancelled. The scanner may still finish the page it is on.');
      else setError(scanErrorMessage(e));
    } finally {
      done(c);
      if (scanning.current === c) scanning.current = null;
    }
  }

  function use(result: ScanResult) {
    onScanned(result);
    close();
  }

  // ---------- focus ----------
  // When what the window shows changes, the keyboard's focus goes to what comes next, not lost with what was removed.

  const scanButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const useButton = useRef<HTMLButtonElement>(null);
  const againButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef<Phase['at']>(phase.at);
  useEffect(() => {
    const before = shown.current;
    shown.current = phase.at;
    if (before === phase.at) return;
    if (phase.at === 'scanning') cancelButton.current?.focus();
    else if (phase.at === 'preview') (useButton.current && !useButton.current.disabled ? useButton.current : againButton.current)?.focus();
    else if (phase.at === 'ready' && (before === 'scanning' || before === 'preview')) scanButton.current?.focus();
    else if (phase.at === 'ready' && (before === 'missing' || before === 'blocked')) heading.current?.focus();
    else if (phase.at === 'missing' || phase.at === 'blocked') retryButton.current?.focus();
  }, [phase.at]);

  // ---------- what is shown ----------

  const tooLarge = phase.at === 'preview' && maxBytes !== undefined && phase.scan.file.size > maxBytes;

  function checkingView(asking: boolean) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-3 text-sm">
          <Spinner /> Looking for the TrendLIX Scan Helper on this computer…
        </p>
        {asking && (
          <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
            Your browser may ask whether this site may access devices on your local network. Choose <b>Allow</b>, so that it can reach the Scan
            Helper.
          </p>
        )}
      </div>
    );
  }

  function missingView(checking: boolean) {
    return (
      <div className="space-y-5 text-sm">
        <div className="space-y-2">
          <h3 className="text-base font-semibold">The Scan Helper Isn&apos;t Running</h3>
          <p>
            Scanning needs the TrendLIX Scan Helper, a small app on this computer that talks to the office scanners. If it is installed, open it,
            then press Try again.
          </p>
          <p className="text-muted">If your browser asked whether this site may access devices on your local network, choose Allow, then press Try again.</p>
        </div>
        <div className="space-y-2">
          <h3 className="text-base font-semibold">Install It Once on This Computer</h3>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Download it, then unzip it.
              <span className="mt-2 flex flex-wrap gap-2">
                <a href={SCAN_HELPER_DOWNLOADS.mac} download className="btn btn-secondary">
                  <DownloadIcon /> For Mac
                </a>
                <a href={SCAN_HELPER_DOWNLOADS.windows} download className="btn btn-secondary">
                  <DownloadIcon /> For Windows
                </a>
              </span>
            </li>
            <li>
              Open it once. On a Mac, the first time, right-click it and choose <b>Open</b>, then <b>Open</b> again: macOS asks before it opens an
              app from the internet. If Windows warns you, choose <b>More info</b>, then <b>Run anyway</b>.
            </li>
            <li>
              When its window asks, type <b>Y</b> and press Enter (or run it with <b>install</b>): it then starts by itself every time you log in
              to this computer. Until then, keep its window open while you scan.
            </li>
            <li>The first time you scan, your browser may ask whether this site may access devices on your local network: choose Allow.</li>
          </ol>
        </div>
        {checking && (
          <p className="flex items-center gap-2 text-muted">
            <Spinner className="size-4" /> Looking for it again…
          </p>
        )}
      </div>
    );
  }

  function blockedView(checking: boolean) {
    return (
      <div className="space-y-2 text-sm">
        <h3 className="text-base font-semibold">Your Browser Is Blocking the Scan Helper</h3>
        <p>
          This site isn&apos;t allowed to access devices on your local network, so it can&apos;t reach the TrendLIX Scan Helper on this computer.
          To allow it, click the icon at the left of the address bar, open the site settings, and set <b>Local network access</b> to <b>Allow</b>.
          Then press Try again, or reload the page.
        </p>
        {checking && (
          <p className="flex items-center gap-2 text-muted">
            <Spinner className="size-4" /> Looking for it again…
          </p>
        )}
      </div>
    );
  }

  function settingsView(s: Scanner, st: ScanSettings) {
    const set = (change: Partial<ScanSettings>) => setSettings({ ...st, ...change });
    const sources = SOURCES.filter((x) => s.sources.includes(x));
    const colours = COLOUR_MODES.filter((x) => s.colorModes.includes(x));
    return (
      <fieldset className="space-y-4">
        <legend className="label">Settings</legend>
        {sources.length > 1 ? (
          <fieldset>
            <legend className="mb-1.5 text-sm text-muted">Paper</legend>
            <div className="flex flex-wrap gap-2">
              {sources.map((x) => (
                <Choice key={x} name={`${fid}source`} checked={st.source === x} onChoose={() => set({ source: x, duplex: x === 'feeder' && st.duplex })}>
                  {SOURCE_LABELS[x]}
                </Choice>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm">
            <span className="text-muted">Paper:</span> {SOURCE_LABELS[st.source]}
          </p>
        )}
        {canDuplex(s, st.source) && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={st.duplex} onChange={(e) => set({ duplex: e.currentTarget.checked })} className="size-4 accent-accent" />
            Two-sided: both sides of each page
          </label>
        )}
        {colours.length > 1 ? (
          <fieldset>
            <legend className="mb-1.5 text-sm text-muted">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {colours.map((x) => (
                <Choice key={x} name={`${fid}colour`} checked={st.colorMode === x} onChoose={() => set({ colorMode: x })}>
                  {COLOUR_LABELS[x]}
                </Choice>
              ))}
            </div>
          </fieldset>
        ) : (
          colours.length === 1 && (
            <p className="text-sm">
              <span className="text-muted">Colour:</span> {COLOUR_LABELS[colours[0]]}
            </p>
          )
        )}
        {s.resolutions.length > 0 && (
          <div>
            <label htmlFor={`${fid}resolution`} className="mb-1.5 block text-sm text-muted">
              Resolution
            </label>
            <Select id={`${fid}resolution`} value={st.resolution} onChange={(e) => set({ resolution: Number(e.currentTarget.value) })} className="input w-auto">
              {s.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r} dpi{r === DEFAULT_RESOLUTION ? ' (recommended)' : ''}
                </option>
              ))}
            </Select>
          </div>
        )}
      </fieldset>
    );
  }

  function readyView() {
    return (
      <div className="space-y-5">
        {hint && <p className="text-sm text-muted">{hint}</p>}
        <fieldset className="space-y-2">
          <legend className="label">Scanner</legend>
          {scanners === null ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-4" /> Looking for scanners on the network. This takes a few seconds…
            </p>
          ) : scanners.length === 0 ? (
            !finding && (
              <p className="text-sm">
                No scanner was found on the network. Check that the scanner is on and connected to the office network, then press Refresh, or add it
                by its IP address.
              </p>
            )
          ) : (
            <div className="grid gap-2">
              {scanners.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-white p-3 has-checked:border-accent has-checked:bg-accent-soft"
                >
                  <input type="radio" name={`${fid}scanner`} checked={s.id === scannerId} onChange={() => pick(s, true)} className="mt-0.5 size-4 shrink-0 accent-accent" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words">{s.name}</span>
                    <span className="block text-xs break-words text-muted">
                      {hostOf(s.url)}
                      {s.manual ? ' · added by IP address' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => void find(true)} disabled={finding} className="btn btn-secondary">
              {finding && scanners !== null ? 'Looking…' : 'Refresh'}
              {finding && scanners !== null && <Spinner className="size-4" />}
            </button>
            <button
              ref={addToggle}
              type="button"
              aria-expanded={adding !== null}
              aria-controls={`${fid}add`}
              onClick={toggleAdding}
              className="btn btn-secondary"
            >
              Add by IP address
            </button>
          </div>
          {adding && (
            <div id={`${fid}add`} className="space-y-2 rounded-lg border border-line bg-canvas p-3">
              <label htmlFor={`${fid}address`} className="label">
                The scanner&apos;s IP address
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={addField}
                  id={`${fid}address`}
                  value={adding.address}
                  onChange={(e) => setAdding({ ...adding, address: e.currentTarget.value, error: '' })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void add();
                    } else if (e.key === 'Escape') {
                      // Esc closes this field first, and the window only after
                      e.preventDefault();
                      e.stopPropagation();
                      stopAdding();
                    }
                  }}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="192.168.1.50"
                  aria-describedby={`${fid}address-hint`}
                  aria-invalid={adding.error ? true : undefined}
                  className="input max-w-xs min-w-0 flex-1 tabular-nums"
                />
                <button type="button" onClick={() => void add()} aria-disabled={adding.busy} className="btn btn-primary aria-disabled:cursor-wait aria-disabled:opacity-60">
                  {adding.busy ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={stopAdding} className="btn btn-secondary">
                  Cancel
                </button>
              </div>
              <p id={`${fid}address-hint`} className="hint">
                As shown in the scanner&apos;s network settings, e.g. 192.168.1.50. A name or an eSCL address works too.
              </p>
              {adding.error && (
                <p role="alert" className="text-sm text-danger">
                  {adding.error}
                </p>
              )}
            </div>
          )}
        </fieldset>
        {scanner && settings && settingsView(scanner, settings)}
        {!scannedBefore && permission !== 'granted' && (
          <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
            The first time you scan, your browser may ask whether this site may access devices on your local network. Choose <b>Allow</b>, or the
            scan can&apos;t start.
          </p>
        )}
        {note && (
          <p role="status" className="text-sm text-ok">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  function scanningView(source: ScanSource) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <Spinner className="size-10" />
        <p className="font-medium">
          {source === 'feeder' ? 'Scanning… the pages are going through the document feeder.' : 'Scanning… keep the page on the glass until it is done.'}
        </p>
        <p className="text-sm text-muted">This can take up to two minutes.</p>
      </div>
    );
  }

  const body =
    phase.at === 'checking' ? (
      checkingView(phase.asking)
    ) : phase.at === 'missing' ? (
      missingView(phase.checking)
    ) : phase.at === 'blocked' ? (
      blockedView(phase.checking)
    ) : phase.at === 'ready' ? (
      readyView()
    ) : phase.at === 'scanning' ? (
      scanningView(phase.source)
    ) : (
      <ScanPreview
        result={phase.scan}
        problem={tooLarge && maxBytes !== undefined ? tooLargeAdvice(phase.scan.file.size, maxBytes, phase.settings, phase.scanner) : null}
      />
    );

  const actions =
    phase.at === 'checking' ? (
      <button type="button" onClick={close} className="btn btn-secondary">
        Cancel
      </button>
    ) : phase.at === 'missing' || phase.at === 'blocked' ? (
      <>
        <button type="button" onClick={close} className="btn btn-secondary">
          Close
        </button>
        {/* aria-disabled rather than disabled while it looks, so that the button keeps the keyboard's focus */}
        <button
          ref={retryButton}
          type="button"
          onClick={() => !phase.checking && retry()}
          aria-disabled={phase.checking}
          className="btn btn-primary aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {phase.checking ? 'Checking…' : 'Try again'}
        </button>
      </>
    ) : phase.at === 'ready' ? (
      <>
        <button type="button" onClick={close} className="btn btn-secondary">
          Cancel
        </button>
        <button ref={scanButton} type="button" onClick={() => void startScan()} disabled={!scanner || !settings || adding?.busy} className="btn btn-primary">
          <ScannerIcon /> Scan
        </button>
      </>
    ) : phase.at === 'scanning' ? (
      <button ref={cancelButton} type="button" onClick={() => scanning.current?.abort()} className="btn btn-secondary">
        Cancel scan
      </button>
    ) : (
      <>
        <button ref={againButton} type="button" onClick={() => setPhase({ at: 'ready' })} className="btn btn-secondary">
          Scan again
        </button>
        <button ref={useButton} type="button" onClick={() => use(phase.scan)} disabled={tooLarge} className="btn btn-primary">
          Use this scan
        </button>
      </>
    );

  // What is done in the window stays in it: a file dragged or pasted here is not given to a file area the Scan button is in.
  const keep = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      onClose={onClosed}
      onPaste={keep}
      onDragEnter={keep}
      onDragOver={keep}
      onDragLeave={keep}
      onDrop={keep}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-hidden rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/70 open:flex open:flex-col sm:max-h-[calc(100dvh-4rem)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line py-2 pr-2 pl-5">
        <h2 ref={heading} id={titleId} tabIndex={-1} className="min-w-0 self-center font-semibold break-words outline-none">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">{body}</div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-3">
        {version && <p className="w-full text-xs text-muted sm:mr-auto sm:w-auto">TrendLIX Scan Helper {version}</p>}
        {actions}
      </div>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </dialog>,
    document.body,
  );
}

/**
 * A Scan button (`label`, "Scan" by default; `context`: said to screen readers after it, e.g. "the front") that opens the
 * scan window titled `title`. `purpose`: what is scanned, for the colour it starts with (colour for a photo or an ID card,
 * greyscale for a document). `maxBytes`: the largest file the form takes; a larger scan cannot be used, and the window
 * says how to make it smaller. `onScanned`: the PDF chosen with Use this scan. Closing the window puts the focus back on
 * the button.
 */
export function ScanButton({
  onScanned,
  title = 'Scan a Document',
  hint,
  purpose = 'document',
  maxBytes,
  label = 'Scan',
  context,
  className = 'btn btn-secondary',
  disabled,
}: {
  onScanned: (result: ScanResult) => void;
  title?: string;
  /** Said above the scanner, e.g. how to put the paper on the scanner. */
  hint?: React.ReactNode;
  purpose?: ScanPurpose;
  maxBytes?: number;
  label?: string;
  context?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  function closed() {
    setOpen(false);
    opener.current?.focus(); // browsers do this too, but not all of them reliably
  }

  return (
    <>
      <button ref={opener} type="button" aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)} className={className}>
        <ScannerIcon />
        {label}
        {context && <span className="sr-only"> {context}</span>}
      </button>
      {open && <ScanWindow title={title} hint={hint} purpose={purpose} maxBytes={maxBytes} onScanned={onScanned} onClosed={closed} />}
    </>
  );
}
