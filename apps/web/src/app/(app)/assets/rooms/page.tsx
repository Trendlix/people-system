import { ASSET_TEXT_LIMITS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { createRoom, deleteRoom, setRoomArchived, updateRoom } from '../actions';
import { assetsCaller, assetsNotLoaded, loadRooms } from '../data';
import { AssetsFrame } from '../frame';
import { ArchiveButton, NameNotesForm } from '../place-forms';
import { Empty, Loading, NoAccess } from '../ui';

// Rooms (owner, 21 October 2026: "i want to add this module with a special permission to the system"; the spec's
// "locations"): where the assets are kept, e.g. Studio A, the storeroom, Office 2. Called rooms, not locations, so they
// aren't taken for Check-in Setup's check-in locations. An Assets manager adds, renames and archives them (an archived
// room can't be chosen any more; its assets keep it); a Super Admin deletes one no asset is in.

export const metadata: Metadata = { title: 'Rooms · People System' };

async function Rooms() {
  const [{ can }, user] = await Promise.all([assetsCaller(), getCurrentUser()]);
  if (!can.view) return <NoAccess />;
  if (!can.manage) return <Empty>Only an Assets manager manages the rooms.</Empty>;
  const loaded = await loadRooms();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'rooms')}</Empty>;
  const rooms = [...loaded.value].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const deletes = canDelete(user);
  return (
    <div className="space-y-6">
      <section aria-labelledby="new-room" className="space-y-2">
        <h2 id="new-room" className="font-semibold">
          Add a Room
        </h2>
        <NameNotesForm
          action={createRoom}
          nameLabel="Name"
          nameHint="E.g. Studio A, Storeroom, Office 2. Each name once."
          nameMax={ASSET_TEXT_LIMITS.roomName}
          notesMax={ASSET_TEXT_LIMITS.roomNotes}
          submit="Add room"
        />
      </section>
      {rooms.length === 0 ? (
        <Empty>No rooms yet. Add the first one above.</Empty>
      ) : (
        <ul aria-label="Rooms" className="space-y-3">
          {rooms.map((r) => (
            <li key={r.id} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {r.name} {r.archived && <span className="badge ml-1 bg-line-soft text-muted">Archived</span>}
                  </h3>
                  {r.notes && <p className="text-sm text-muted">{r.notes}</p>}
                </div>
                <Link href={ASSET_PATHS.listWith({ roomId: r.id })} className="text-sm font-semibold">
                  {r.assets} {r.assets === 1 ? 'asset' : 'assets'}
                  <span className="sr-only"> in {r.name}</span>
                </Link>
              </div>
              <details className="mt-3">
                <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-accent">Rename or add notes</summary>
                <div className="mt-3">
                  <NameNotesForm
                    action={updateRoom.bind(null, r.id)}
                    saved={{ name: r.name, notes: r.notes }}
                    nameLabel="Name"
                    nameMax={ASSET_TEXT_LIMITS.roomName}
                    notesMax={ASSET_TEXT_LIMITS.roomNotes}
                    submit="Save room"
                    compact
                  />
                </div>
              </details>
              <div className="mt-2 flex flex-wrap items-start gap-4">
                <ArchiveButton action={setRoomArchived.bind(null, r.id, !r.archived)} archived={r.archived} name={r.name} />
                {deletes && r.assets === 0 && <DeleteForm action={deleteRoom.bind(null, r.id)} confirmText={`Delete the room ${r.name}? This can't be undone.`} label="Delete room" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Setup → Rooms (owner, 24 October 2026: "7 entries, the rest as tabs"; "Keep them inside Assets"): its tab names it,
// under Setup's heading (frame.tsx)
export default function RoomsPage() {
  return (
    <AssetsFrame tab={ASSET_PATHS.rooms}>
      <p className="text-muted">Where the assets are kept when nobody holds them: the studios, the storeroom, the offices.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Rooms />
        </Suspense>
      </div>
    </AssetsFrame>
  );
}
