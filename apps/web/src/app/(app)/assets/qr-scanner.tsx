'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Scanning asset labels with the camera (Assets step 5; owner, 22 October 2026: "stock counts, label sheets …"; the
// brief: "a count flow that scans QR codes with the camera … the web BarcodeDetector API with a typed-code fallback"):
// the camera's picture in the page, read a few times a second by the browser's own QR reader (BarcodeDetector), each
// label read handed on once (the same one again only after a pause, so holding it in view doesn't tick it twice). No
// plugin and no new app version: inside the Trendlix People app it is the app's web view, which asks for the camera the
// app already may use (the photos). Where the browser has no QR reader (an iPhone's Safari, Firefox), the button isn't
// offered and the code is typed instead.

interface Detected {
  rawValue: string;
}
interface Detector {
  detect(source: HTMLVideoElement): Promise<Detected[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The browser's QR reader, when it has one. */
function detectorClass(): DetectorClass | null {
  if (typeof window === 'undefined') return null;
  const found = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  return typeof found === 'function' ? found : null;
}

/** Whether this browser can read QR codes from its camera. */
export function canScanLabels(): boolean {
  return detectorClass() !== null && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

const unchanging = () => () => {};

/** canScanLabels, false on the server and while the page is hydrated. */
export function useCanScan(): boolean {
  return useSyncExternalStore(unchanging, canScanLabels, () => false);
}

/** The same label read again within this long is the same scan. */
const SAME_SCAN_MS = 2500;

/** What is said when the camera can't be used. */
export function cameraProblem(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'The camera isn’t allowed. Allow it for this site (or for Trendlix People in the phone’s Settings → Apps → Permissions → Camera), or type the codes instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found. Type the codes instead.';
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it, then try again.';
  return 'The camera could not be started. Type the codes instead.';
}

/**
 * "Scan labels": the camera in the page while on, each QR code read passed to `onCode` (its text: the label's address,
 * or whatever the code holds). Nothing when the browser can't read QR codes.
 */
export function QrScanner({ onCode, label = 'Scan labels', stopAfterOne = false }: { onCode: (text: string) => void; label?: string; stopAfterOne?: boolean }) {
  const can = useCanScan();
  const [on, setOn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const handler = useRef(onCode);
  const last = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    handler.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!on) return;
    const Detector = detectorClass();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    void (async () => {
      try {
        const detector = new Detector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        const v = video.current;
        if (stopped || !v) {
          stop();
          return;
        }
        v.srcObject = stream;
        await v.play();
        const read = async () => {
          if (stopped) return;
          try {
            for (const d of await detector.detect(v)) {
              const now = Date.now();
              if (last.current && last.current.text === d.rawValue && now - last.current.at < SAME_SCAN_MS) continue;
              last.current = { text: d.rawValue, at: now };
              navigator.vibrate?.(40);
              handler.current(d.rawValue);
              if (stopAfterOne) {
                stop();
                setOn(false);
                return;
              }
            }
          } catch {
            // a frame that couldn't be read: the next one is
          }
          timer = window.setTimeout(() => void read(), 250);
        };
        void read();
      } catch (err) {
        stop();
        setProblem(cameraProblem(err));
        setOn(false);
      }
    })();
    return stop;
  }, [on, stopAfterOne]);

  if (!can) return null;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setProblem(null);
          setOn((v) => !v);
        }}
        aria-pressed={on}
        className={`btn min-h-12 ${on ? 'btn-secondary' : 'btn-primary'}`}
      >
        {on ? 'Stop scanning' : label}
      </button>
      {on && (
        <div className="overflow-hidden rounded-lg border border-line bg-ink">
          {/* the camera's picture, muted and inline so phones play it in the page */}
          <video ref={video} muted playsInline className="block aspect-[4/3] w-full max-w-md object-cover" aria-label="The camera, reading QR codes" />
        </div>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
