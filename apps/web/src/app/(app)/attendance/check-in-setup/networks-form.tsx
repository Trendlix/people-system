'use client';

import { useState } from 'react';
import { OFFICE_NETWORKS_MAX, officeNetworksFrom, type OfficeNetwork } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';

// Attendance → Check-in Setup → Office Networks (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip,
// whatever is right"): the office's public addresses, each a name and an IPv4 address, an IPv4 range or an IPv6 range,
// and the switch "Lock check-ins to the office network" (Office staff only, unless HR lets them check in from anywhere;
// check-in and check-out both; off the network they are refused and ask for a correction). Add the network I'm on now
// adds this page's own address (the IPv4 address, or the /64 of an IPv6 one). The switch can be turned on only when the
// website and the server share the key (the status above it says what is missing) and there is a network. The shared
// checks run as it is typed, and again on saving (setup.ts networksBody, then the API).

type Row = OfficeNetwork & { key: number };

export function NetworksForm({
  action,
  networks,
  lock,
  ready,
  currentIp,
  currentRange,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  networks: readonly OfficeNetwork[];
  lock: boolean;
  /** The key is on both sides and this page's address was signed: the switch can be turned on. */
  ready: boolean;
  /** This page's address, and the network to add for it; none when it couldn't be read. */
  currentIp: string | null;
  currentRange: string | null;
}) {
  const fid = useFieldIds();
  const [rows, setRows] = useState<Row[]>(() => networks.map((n, i) => ({ ...n, key: i })));
  const [next, setNext] = useState(networks.length);
  const [locked, setLocked] = useState(lock && ready);
  const [touched, setTouched] = useState(false);
  const { state, pending, form } = useKeptForm(action);
  const filled = rows.filter((r) => r.label.trim() || r.range.trim());
  const { problems } = officeNetworksFrom(filled);
  const listed = currentRange !== null && filled.some((r) => r.range.trim() === currentRange);

  function add(row: OfficeNetwork) {
    setRows((rs) => [...rs, { ...row, key: next }]);
    setNext((n) => n + 1);
    setTouched(true);
  }
  const change = (key: number, field: 'label' | 'range', value: string) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    setTouched(true);
  };
  const drop = (key: number) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setTouched(true);
  };

  return (
    <form {...form} className="space-y-5">
      <FormErrors errors={state.errors} />
      <fieldset className="space-y-3">
        <legend className="font-semibold">The Office&apos;s Addresses</legend>
        {rows.length === 0 && <p className="text-sm text-muted">No office network yet.</p>}
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.key} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <label htmlFor={fid(`label-${r.key}`)} className="label">
                  Name<span className="sr-only"> of network {i + 1}</span>
                </label>
                <input
                  id={fid(`label-${r.key}`)}
                  name="networkLabel"
                  autoComplete="off"
                  placeholder="Main office line"
                  value={r.label}
                  onChange={(e) => change(r.key, 'label', e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor={fid(`range-${r.key}`)} className="label">
                  Address or range<span className="sr-only"> of network {i + 1}</span>
                </label>
                <input
                  id={fid(`range-${r.key}`)}
                  name="networkRange"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="41.33.10.2"
                  value={r.range}
                  onChange={(e) => change(r.key, 'range', e.target.value)}
                  aria-describedby={fid('range-hint')}
                  className="input font-mono"
                />
              </div>
              <button type="button" onClick={() => drop(r.key)} className="btn btn-secondary">
                Remove<span className="sr-only"> network {r.label || i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => add({ label: '', range: '' })} disabled={rows.length >= OFFICE_NETWORKS_MAX} className="btn btn-secondary">
            Add a network
          </button>
          <button
            type="button"
            onClick={() => currentRange && add({ label: 'Office', range: currentRange })}
            disabled={!currentRange || listed || rows.length >= OFFICE_NETWORKS_MAX}
            className="btn btn-secondary"
          >
            Add the network I&apos;m on now
          </button>
          <p className="text-sm text-muted">
            {currentIp ? (
              <>
                You are on <span className="font-mono">{currentIp}</span>
                {currentRange && currentRange !== currentIp && (
                  <>
                    {' '}
                    (its network <span className="font-mono">{currentRange}</span>)
                  </>
                )}
                {listed ? ', already in the list.' : '.'}
              </>
            ) : (
              'Your address couldn’t be read on this page.'
            )}
          </p>
        </div>
        <p id={fid('range-hint')} className="hint max-w-3xl">
          The office&apos;s public address: an IPv4 address (41.33.10.2), an IPv4 range (41.33.10.0/24) or an IPv6 range (an IPv6 office line has its
          /64, e.g. 2001:db8:1234:5678::/64). Not the Wi-Fi&apos;s name, and not an address inside the office (192.168…): the system sees the line&apos;s
          public one. Easiest: in the office, on its Wi-Fi, press Add the network I&apos;m on now. The office line needs a fixed IP from the internet
          provider: if its address changes, check-ins are refused until it is added here.
        </p>
        <div aria-live="polite">
          {touched && problems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-danger">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      <div className="border-t border-line-soft pt-5">
        {/* a hidden "false" so turning it off is sent too */}
        <input type="hidden" name="lock" value="false" />
        <label className={`flex min-h-11 w-fit items-center gap-3 text-sm font-semibold ${ready ? 'cursor-pointer' : 'opacity-60'}`}>
          <input
            type="checkbox"
            role="switch"
            name="lock"
            value="true"
            checked={locked}
            disabled={!ready}
            onChange={(e) => setLocked(e.target.checked)}
            aria-describedby={fid('lock-hint')}
            className="size-5 accent-accent"
          />
          Lock check-ins to the office network
        </label>
        <p id={fid('lock-hint')} className="hint max-w-3xl">
          On: Office staff check in and out only on these networks, or at a sub-location they are linked to; anywhere else the press is refused, and
          they ask for an attendance correction (or HR records the time). Hybrid, Outdoor, Indoor and outdoor and Work from home staff, and anyone HR lets check in from anywhere on their profile,
          check in from anywhere. A check-in on an office network counts as at the office either way.
          {!ready && (lock ? ' It can’t stay on until the key is ready: saving now switches it off.' : ' It can be turned on once the key is ready (above).')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending}>Save networks</SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
