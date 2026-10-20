'use client';

import { DEVICE_PLATFORM_LABELS } from '@trendlix/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { FINGERPRINT_TEXT } from '@/lib/fingerprint';
import { formatDate, formatDateTime } from '@/lib/format';
import { biometricStatus, clearBiometric, type BiometricStatus } from '@/lib/native';
import type { FingerprintDevice } from '@/lib/types';
import { useTurnOnFingerprint } from '@/lib/use-fingerprint';
import { FingerprintIcon } from './fingerprint-icon';

// The phones that sign in to the TrendLIX People app with a fingerprint (owner, 20 October 2026: chose Face ID /
// fingerprint sign-in for the app; README: "profile → Devices with Sign out"): each phone's name and kind, when it was
// added and last used, and Sign out beside it. Your Sessions (one's own) and the Users page (an Admin's) both list them,
// as SessionList does the sessions. On Your Sessions in the app, the phone it is shown on is marked "This phone" (the
// credential its fingerprint keeps), signing it out forgets the phone's copy too, and Turn on for this phone is offered
// when the phone can and keeps none the server still takes.

export interface FingerprintDevicesProps {
  devices: FingerprintDevice[];
  /** Signs the phone out; answers the API's refusal, if any. Left out: no button (e.g. an Admin on a Super Admin's account). */
  end?: (id: string) => Promise<{ error?: string }>;
  /** Your Sessions, not viewing as someone: in the app, this phone is marked and its copy forgotten when signed out. */
  thisPhone?: boolean;
  /** Your Sessions on an app session, not viewing as someone: Turn on for this phone, when the phone can. */
  canTurnOn?: boolean;
  empty: string;
}

export function FingerprintDevices({ devices, end, thisPhone = false, canTurnOn = false, empty }: FingerprintDevicesProps) {
  const router = useRouter();
  const [status, setStatus] = useState<BiometricStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { turnOn, pending, outcome } = useTurnOnFingerprint();

  // what this phone keeps, in the app only (outside it: nothing, and nothing is marked or offered)
  useEffect(() => {
    if (!thisPhone && !canTurnOn) return;
    let live = true;
    void biometricStatus().then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [thisPhone, canTurnOn]);

  const thisId = thisPhone && status?.enrolled ? status.id : null;
  const listed = thisId !== null && devices.some((d) => d.id === thisId);
  // the phone can, and keeps no credential the server still takes (none, or one signed out or past its 90 days since)
  const offer = canTurnOn && status?.available === true && !listed && outcome?.kind !== 'unavailable' && outcome?.kind !== 'on';

  function endOne(id: string) {
    if (!end) return;
    setError(null);
    setBusy(id);
    startTransition(async () => {
      const result = await end(id);
      setBusy(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      // this phone's own: the copy behind its fingerprint goes too, so it asks for the password next time
      if (id === thisId) {
        await clearBiometric();
        setStatus(await biometricStatus());
      }
    });
  }

  function turnOnHere() {
    if (!status) return;
    setError(null);
    turnOn(status, (result) => {
      if (result.kind !== 'on') return;
      router.refresh();
      void biometricStatus().then(setStatus);
    });
  }

  return (
    <div className="space-y-3">
      {devices.length ? (
        <ul className="divide-y divide-line-soft">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="break-words">{d.deviceName}</span>
                  <span className="font-normal text-muted">· {DEVICE_PLATFORM_LABELS[d.platform] ?? d.platform}</span>
                  {d.id === thisId && <span className="badge bg-ok-soft text-ok">This phone</span>}
                </p>
                <p className="text-xs text-muted">
                  Added {formatDate(d.createdAt)} · {d.lastUsedAt ? `Last used ${formatDateTime(d.lastUsedAt)}` : 'Never used'}
                </p>
              </div>
              {end && (
                <button type="button" onClick={() => endOne(d.id)} disabled={busy !== null || pending} className="btn btn-secondary">
                  {busy === d.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {outcome?.kind === 'on' && (
        <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          {FINGERPRINT_TEXT.on}
        </p>
      )}
      {outcome?.kind === 'error' && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {outcome.message}
        </p>
      )}
      {offer && (
        <button type="button" onClick={turnOnHere} disabled={pending || busy !== null} className="btn btn-primary">
          <FingerprintIcon />
          {pending ? 'Turning on…' : 'Turn on for this phone'}
        </button>
      )}
    </div>
  );
}
