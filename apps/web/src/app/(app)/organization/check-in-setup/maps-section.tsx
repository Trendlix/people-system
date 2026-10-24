import { MAPS_SETTINGS_OWN_ACCOUNT } from '@trendlix/shared';
import type { Session } from '@/lib/view-as';
import { SetupSection } from '../payroll/section';
import { submitMapsSettings } from './actions';
import { loadMapsSettings } from './data';
import { MapsSettingsForm } from './maps-form';
import { MAPS_ID, MAPS_NOT_FOR_DEVELOPERS, MAPS_STEPS, mapsStatus } from './maps-setup';

// Check-in Setup → Google Maps (owner, 24 October 2026, on this page's map: "is there another map provider?", then
// "Google Maps"): a Super Admin's only. Which maps the system draws now, the key and the Map ID with Check the key, and the
// steps in the company's Google Cloud project. Until a key is saved, every map stays OpenStreetMap's, as before. A
// developer and a Super Admin viewing as someone are told why it isn't theirs (the API refuses them too).

const INTRO =
  'Every map in the system (check-in locations, home locations, on the website and in the app) on Google Maps, with a Map/Satellite switch and Google’s place search. Until a key is set, the maps are OpenStreetMap’s, as before.';

const Note = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">{children}</p>;

export async function MapsSection({ user }: { user: Session }) {
  const section = (body: React.ReactNode) => (
    <SetupSection id={MAPS_ID} title="Google Maps" intro={INTRO}>
      {body}
    </SetupSection>
  );
  if (user.developer) return section(<Note>{MAPS_NOT_FOR_DEVELOPERS}</Note>);
  if (user.viewAs) return section(<Note>{MAPS_SETTINGS_OWN_ACCOUNT}</Note>);
  const loaded = await loadMapsSettings();
  if (loaded.kind === 'unavailable') return section(<Note>Not available yet: the server does not have the Google Maps settings yet. Please try again after its next update.</Note>);
  if (loaded.kind !== 'ok') return section(<Note>The Google Maps settings could not be loaded. {loaded.kind === 'failed' ? loaded.messages.join(' ') : ''}</Note>);
  const status = mapsStatus(loaded.value);
  return section(
    <div className="space-y-6">
      <p role="status" className={`rounded-lg px-4 py-3 text-sm ${status.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-line-soft text-muted'}`}>
        {status.text}
      </p>
      <MapsSettingsForm action={submitMapsSettings} view={loaded.value} />
      <div className="border-t border-line-soft pt-5">
        <h3 className="font-semibold">Setting Up the Key in Google Cloud</h3>
        <ol className="mt-2 max-w-3xl list-decimal space-y-1.5 pl-5 text-sm">
          {MAPS_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </div>,
  );
}
