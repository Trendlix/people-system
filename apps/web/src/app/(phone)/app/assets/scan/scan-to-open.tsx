'use client';

import { codeFromLabel } from '@trendlix/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { QrScanner, useCanScan } from '../../../../(app)/assets/qr-scanner';

// Scan a label to open its asset (Assets step 5; the brief: "Look up: scanning an asset's label opens its page"): the
// camera reads the label's QR code and the asset opens in the phone layout; or its code is typed. Where the phone's
// browser can't read QR codes, only the typed code (the phone's own camera app opens a label's address too).

export function ScanToOpen() {
  const router = useRouter();
  const can = useCanScan();
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const open = (text: string) => {
    const code = codeFromLabel(text);
    if (!code) {
      setSaid('That isn’t an asset’s label. Try again, or type the code, e.g. PK-CAM-0003.');
      return;
    }
    setSaid(`Opening ${code}…`);
    router.push(APP_ASSET_PATHS.asset(code));
  };
  return (
    <div className="space-y-4">
      <QrScanner onCode={open} label="Scan a label" stopAfterOne />
      {!can && <p className="text-sm text-muted">This phone&apos;s browser can&apos;t read QR codes here. Type the code from the label, or scan it with the phone&apos;s camera app.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) open(typed);
        }}
        className="flex gap-2"
      >
        <label htmlFor="scan-code" className="sr-only">
          Asset code
        </label>
        <input
          id="scan-code"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={200}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Or type the code, e.g. PK-CAM-0003"
          className="input min-h-12 flex-1 font-mono"
        />
        <button type="submit" className="btn btn-secondary min-h-12">
          Open
        </button>
      </form>
      {said && (
        <p role="status" className="text-sm text-muted">
          {said}
        </p>
      )}
    </div>
  );
}
