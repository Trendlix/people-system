import { registerForPush } from './native';
import { turnOnPushFlow, writePushToken, type PushTurnOnOutcome } from './notifications';
import { registerPushDevice } from './push-actions';

// Turning push notifications on for this phone, in the page (owner, 20 October 2026: "Push notifications: yes
// (decisions, things waiting for someone, a check-in reminder)"; apps/mobile/README.md, Phase 4), for Home's Turn on
// (`ask`: the phone's permission prompt) and the app's silent registration on each open once allowed: the phone's token
// (lib/native.ts), registered with the API by the server action, then kept on the phone for signing out
// (lib/notifications.ts, turnOnPushFlow). Never throws.

/** The page's storage, null when the browser refuses it (a private window, storage blocked). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function turnOnPush(ask: boolean): Promise<PushTurnOnOutcome> {
  return turnOnPushFlow({
    register: () => registerForPush({ ask }),
    save: (input) => registerPushDevice(input),
    keep: (token) => writePushToken(storage(), token),
  });
}
