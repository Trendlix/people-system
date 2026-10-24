'use client';

import { isMapsKey, MAP_ID_PROBLEM, MAPS_KEY_PROBLEM, mapIdOf, mapsKeyOf, mapsSettingsProblems, type MapsSettingsView } from '@trendlix/shared';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { freshMapsConfig } from '@/components/map/provider';
import { formatDateTime } from '@/lib/format';
import { KEY_CHECK_PATH, keyCheckResultOf, keyCheckStart, keyCheckText, type KeyCheckResult } from '@/lib/google-maps';
import { MAP_ID_HINT, MAPS_REMOVE_CONFIRM, type MapsFormState, type MapsIntent } from './maps-setup';

// Check-in Setup → Google Maps' form (owner, 24 October 2026: "Google Maps"): the browser key and the Map ID, Save,
// Remove the key, and Check the key. The key is never shown again once saved: "…Ab3x · Replace" opens an empty box, and
// only its last four characters come from the server. Check the key loads a map with the key in a frame of its own (the
// website's /maps-key/check, sent the key by postMessage once loaded: the key typed, else the saved one) and says plainly
// whether it works or why Google refused it; it is never saved by it.

type Action = (prev: MapsFormState, fd: FormData) => Promise<MapsFormState>;

/** How long a check may take before it is called off (Google's map, then one place search). */
const CHECK_TIMEOUT_MS = 30_000;

export function MapsSettingsForm({ action, view }: { action: Action; view: MapsSettingsView }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [running, setRunning] = useState<MapsIntent | null>(null);
  const fid = useFieldIds();
  const keyBox = useRef<HTMLInputElement>(null);
  const mapIdBox = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const [replacing, setReplacing] = useState(false);
  // a save (or a removal) that went through closes the box it had open, and the key typed in it goes
  const [seenSaved, setSeenSaved] = useState(state.saved);
  if (state.saved !== seenSaved) {
    setSeenSaved(state.saved);
    setReplacing(false);
  }

  // ---------- Check the key ----------
  const [check, setCheck] = useState<{ id: string; start: ReturnType<typeof keyCheckStart> } | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<KeyCheckResult | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!check) return;
    let settled = false;
    const settle = (r: KeyCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setResult(r);
      setChecking(false);
    };
    const onMessage = (e: MessageEvent) => {
      // only this check's frame, on the website's own address, and only its own message
      if (e.source !== frame.current?.contentWindow || e.origin !== window.location.origin) return;
      const r = keyCheckResultOf(e.data, check.id);
      if (r) settle(r);
    };
    const timeout = setTimeout(() => settle({ ok: false, code: 'Timeout' }), CHECK_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    return () => {
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
  }, [check]);

  async function runCheck() {
    setResult(null);
    setCheckProblem(null);
    const typed = mapsKeyOf(keyBox.current?.value);
    const mapId = mapIdOf(mapIdBox.current?.value);
    if (mapId && mapsSettingsProblems({ key: null, mapId }).length) return setCheckProblem(MAP_ID_PROBLEM);
    let key = typed;
    if (key && !isMapsKey(key)) return setCheckProblem(MAPS_KEY_PROBLEM);
    if (!key) {
      if (!view.keySet) return setCheckProblem('Paste the key first, then check it.');
      setChecking(true);
      // the saved key, as the pages get it
      const config = await freshMapsConfig();
      if (config.provider !== 'google') {
        setChecking(false);
        return setCheckProblem('The saved key couldn’t be read back: paste it again, then check it.');
      }
      key = config.key;
    }
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setChecking(true);
    setCheck({ id, start: keyCheckStart(id, key, mapId) });
  }

  /** Sends the form to the action with the button pressed (React leaves the fields as they are: no reset). */
  function dispatch(fd: FormData) {
    setRunning(fd.get('intent') === 'remove' ? 'remove' : 'save');
    startTransition(() => formAction(fd));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    dispatch(new FormData(e.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null));
  }

  function removeKey() {
    if (!window.confirm(MAPS_REMOVE_CONFIRM)) return;
    const fd = new FormData();
    fd.set('intent', 'remove');
    dispatch(fd);
  }

  const busy = (intent: MapsIntent) => pending && running === intent;
  const showKeyBox = !view.keySet || replacing;

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="space-y-5">
      <FormErrors errors={state.errors} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          {!showKeyBox ? (
            <>
              <p id={fid('key-label')} className="label">
                Browser API key
              </p>
              <div role="group" aria-labelledby={fid('key-label')} className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
                <span className="font-mono font-medium">…{view.keyEnding}</span>
                <span aria-hidden="true" className="text-muted">
                  ·
                </span>
                <button type="button" onClick={() => setReplacing(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
                  Replace<span className="sr-only"> the key</span>
                </button>
              </div>
              <p className="hint">Saved, and never shown in full again.</p>
            </>
          ) : (
            <>
              <label htmlFor={fid('browserKey')} className="label">
                Browser API key
              </label>
              <input
                ref={keyBox}
                id={fid('browserKey')}
                name="browserKey"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={100}
                autoFocus={replacing}
                placeholder="AIza…"
                aria-describedby={fid('browserKey-hint')}
                className="input font-mono"
              />
              <p id={fid('browserKey-hint')} className="hint">
                {view.keySet ? 'Leave it empty to keep the saved key.' : 'The key made in Google Cloud for the maps, 39 characters starting AIza.'}
                {view.keySet && (
                  <>
                    {' '}
                    <button type="button" onClick={() => setReplacing(false)} className="font-semibold text-accent underline-offset-2 hover:underline">
                      Keep the saved one
                    </button>
                  </>
                )}
              </p>
            </>
          )}
          {view.keySet && (
            <button type="button" onClick={removeKey} disabled={pending} className="btn btn-secondary mt-2 min-h-9 px-3">
              {busy('remove') ? 'Removing…' : 'Remove the key'}
            </button>
          )}
        </div>
        <div>
          <label htmlFor={fid('mapId')} className="label">
            Map ID <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            ref={mapIdBox}
            id={fid('mapId')}
            name="mapId"
            defaultValue={view.mapId ?? ''}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={100}
            aria-describedby={fid('mapId-hint')}
            className="input font-mono"
          />
          <p id={fid('mapId-hint')} className="hint">
            {MAP_ID_HINT}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="intent" value="save" disabled={pending} className="btn btn-primary">
          {busy('save') ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => void runCheck()} disabled={checking} className="btn btn-secondary">
          {checking ? 'Checking…' : 'Check the key'}
        </button>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
      <p className="hint max-w-3xl">Check the key loads a map with the key in the box (or the saved one, when the box is empty) and searches one place with it. It saves nothing.</p>

      <div aria-live="polite" className="empty:hidden">
        {checkProblem && <p className="text-sm text-danger">{checkProblem}</p>}
        {result && !checking && <p className={`text-sm font-semibold ${result.ok ? 'text-ok' : 'text-danger'}`}>{keyCheckText(result)}</p>}
      </div>
      {check && (
        <iframe
          ref={frame}
          key={check.id}
          src={KEY_CHECK_PATH}
          // loaded: the key's script goes to it, to the website's own address only
          onLoad={() => frame.current?.contentWindow?.postMessage(check.start, window.location.origin)}
          title="The map loaded with the key, to check it"
          className="h-48 w-full max-w-xl rounded-lg border border-line bg-line-soft"
        />
      )}

      {view.updatedAt && (
        <p className="text-xs text-muted">
          Last saved {formatDateTime(view.updatedAt)}
          {view.updatedBy ? ` by ${view.updatedBy.name}` : ''}.
        </p>
      )}
    </form>
  );
}
