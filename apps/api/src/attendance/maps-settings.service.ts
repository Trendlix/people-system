import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  DEVELOPER_NO_FILES,
  MAPS_KEY_NOT_YOURS,
  MAPS_SETTINGS_OWN_ACCOUNT,
  MAPS_SETTINGS_SUPER_ADMIN_ONLY,
  mapIdOf,
  mapsKeyEnding,
  mapsKeyOf,
  mapsSettingsProblems,
  receivesMapsKey,
  type MapsKeyView,
  type MapsSettingsView,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MapsSettingsDto } from './maps-settings.dto.js';

// Google Maps for every map in the system (owner, 24 October 2026, on Check-in Setup's map: "is there another map
// provider?"; offered Google Maps, Mapbox, or OpenStreetMap plus satellite: "Google Maps"; told "the key is pasted in the
// system by a Super Admin (no server or Vercel step), as Email Settings does" and "until a key is set, today's map keeps
// working"). Two parts:
// - the settings (GET/PUT /maps-settings, DELETE /maps-settings/key): a Super Admin's only, in their own session, as Email
//   Settings are; never a developer's (the controller's @NotForDevelopers, and here). The key is answered as its last
//   four characters only ("…Ab3x · Replace"); every save is audited, the key only as "changed", never its value;
// - the key at runtime (GET /maps/key): to signed-in staff whose pages show a map (packages/shared receivesMapsKey: anyone
//   with an employee profile, HR, Admin, the CEO), never to a developer, whose maps stay on OpenStreetMap; with no key
//   saved, OpenStreetMap for everyone.

export const MAPS_SETTINGS_ENTITY = 'maps_settings';

const USER = { select: { id: true, email: true } } as const;

@Injectable()
export class MapsSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A Super Admin in their own session; anyone else refused, a developer too (also refused before, by the interceptor). */
  private assertOwner(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!isSuperAdmin(user)) throw new ForbiddenException(MAPS_SETTINGS_SUPER_ADMIN_ONLY);
    if (user.viewAs) throw new ForbiddenException(MAPS_SETTINGS_OWN_ACCOUNT);
  }

  /** GET /maps-settings: whether a key is saved and its last four characters, the Map ID, and who saved them last. */
  async get(user: SessionUser): Promise<MapsSettingsView> {
    this.assertOwner(user);
    return this.view();
  }

  private async view(): Promise<MapsSettingsView> {
    const row = await this.prisma.mapsSettings.findUnique({ where: { id: 1 }, include: { updatedBy: USER } });
    const names = await userNames(this.prisma, [row?.updatedBy ?? null]);
    return {
      keySet: !!row?.browserKey,
      keyEnding: mapsKeyEnding(row?.browserKey),
      mapId: row?.mapId ?? null,
      updatedAt: row?.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ? (names.get(row.updatedBy.id) ?? null) : null,
    };
  }

  /** PUT /maps-settings: an empty or left-out key keeps the saved one; an empty Map ID clears it, a left-out one keeps it. */
  async update(dto: MapsSettingsDto, user: SessionUser): Promise<MapsSettingsView> {
    this.assertOwner(user);
    const before = await this.prisma.mapsSettings.findUnique({ where: { id: 1 } });
    const key = mapsKeyOf(dto.browserKey);
    const mapId = dto.mapId === undefined ? (before?.mapId ?? null) : mapIdOf(dto.mapId);
    const problems = mapsSettingsProblems({ key, mapId: dto.mapId === undefined ? null : mapId });
    if (problems.length) throw new BadRequestException(problems);

    const diff: Record<string, unknown> = {};
    // the key only as "changed": never its value, its length or any part of it
    if (key !== null && key !== before?.browserKey) diff.browserKey = 'changed';
    if (mapId !== (before?.mapId ?? null)) diff.mapId = { from: before?.mapId ?? null, to: mapId };
    if (!Object.keys(diff).length) return this.view();

    const data = { ...(key !== null && { browserKey: key }), mapId, updatedById: user.id, updatedAt: new Date() };
    await this.prisma.mapsSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await this.audit.record({ userId: user.id, action: 'update', entityType: MAPS_SETTINGS_ENTITY, entityId: null, diff });
    return this.view();
  }

  /** DELETE /maps-settings/key: "Remove the key": every map back on OpenStreetMap. The Map ID stays for a later key. */
  async removeKey(user: SessionUser): Promise<MapsSettingsView> {
    this.assertOwner(user);
    const before = await this.prisma.mapsSettings.findUnique({ where: { id: 1 }, select: { browserKey: true } });
    if (!before?.browserKey) return this.view();
    await this.prisma.mapsSettings.update({ where: { id: 1 }, data: { browserKey: null, updatedById: user.id, updatedAt: new Date() } });
    await this.audit.record({ userId: user.id, action: 'remove_key', entityType: MAPS_SETTINGS_ENTITY, entityId: null, diff: { browserKey: 'changed' } });
    return this.view();
  }

  /**
   * GET /maps/key: the key, for a page that draws a map, to those whose pages show one; OpenStreetMap without a key.
   * Never a developer (refused by the interceptor first) nor anyone with no page showing a map.
   */
  async keyFor(user: SessionUser): Promise<MapsKeyView> {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!receivesMapsKey(user)) throw new ForbiddenException(MAPS_KEY_NOT_YOURS);
    const row = await this.prisma.mapsSettings.findUnique({ where: { id: 1 }, select: { browserKey: true, mapId: true } });
    return row?.browserKey ? { provider: 'google', key: row.browserKey, mapId: row.mapId ?? null } : { provider: 'openstreetmap' };
  }
}
