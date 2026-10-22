import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { CHOOSE_MODE_PATH, mustChoose } from '@/lib/session-mode';

/**
 * A developer who is also an employee and hasn't chosen yet how to use the system (owner, 22 October 2026: "when a
 * developer signin, give hin a switched to use the account as the main role assigned to him or as a developer, to not
 * confuse him"): every page sends them to the choice page, so nothing opens until they choose (the API answers them as a
 * developer meanwhile: read only, nothing real shown). Put in a layout, inside a Suspense boundary; renders nothing.
 */
export async function ModeGate() {
  try {
    if (mustChoose(await getCurrentUser())) redirect(CHOOSE_MODE_PATH);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  return null;
}
