import type { PhotoCrop } from '@trendlix/shared';
import { cropStyle } from '@/lib/photo-crop';

// The picture beside an employee's name, on the Employees list and the profile, and in the crop window's preview
// ([id]/photo-crop.tsx): no server code here, so pages and client components alike can show it.

/** "Omar Khaled Mahmoud" → "OM": first letters of the first and last names. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

/** Where a personal photo is loaded from (app/employee-photo), under the web domain with the session. */
export const photoHref = (photoId: string) => `/employee-photo/${photoId}`;

/**
 * The person's personal photo from the employee file, for those who see it (HR, CEO), else their initials. The initials
 * stay underneath, so a photo that can't be loaded leaves them showing. With a crop, exactly the square HR chose to make
 * the face bigger (owner's request, 16 October 2026); without one, the whole photo, centred.
 */
export function Avatar({ name, photoId, crop, size = 'sm' }: { name: string; photoId?: string | null; crop?: PhotoCrop | null; size?: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'size-20 text-2xl' : 'size-9 text-xs';
  return (
    <span aria-hidden="true" className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-bold text-accent ${box}`}>
      {initials(name)}
      {photoId && (
        // eslint-disable-next-line @next/next/no-img-element -- a file of the employee file, behind the session: not for the image optimizer
        <img
          src={photoHref(photoId)}
          alt=""
          loading="lazy"
          decoding="async"
          // a cropped picture is larger than the circle: not held to its width (max-w-none)
          className={crop ? 'absolute max-w-none' : 'absolute inset-0 size-full object-cover'}
          style={crop ? cropStyle(crop) : undefined}
        />
      )}
    </span>
  );
}
