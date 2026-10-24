import { MAPS_LIMITS } from '@trendlix/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// What Organization → Check-in Setup → Google Maps sends (owner, 24 October 2026: "Google Maps"). The shapes are checked
// here, the rules (a Google key's form, a Map ID's) by packages/shared mapsSettingsProblems in the service. The key is
// never echoed in a message.

/** PUT /maps-settings: the browser key (empty or left out: the saved one stays) and the Map ID (empty: none). */
export class MapsSettingsDto {
  @IsOptional() @TrimOrNull() @IsString({ message: 'Paste the key as text.' }) @MaxLength(MAPS_LIMITS.key, { message: 'That is longer than a Google Maps key: copy it again.' })
  browserKey?: string | null;

  @IsOptional() @TrimOrNull() @IsString({ message: 'Write the Map ID as text.' }) @MaxLength(MAPS_LIMITS.mapId, { message: 'That is longer than a Map ID: copy it again.' })
  mapId?: string | null;
}
