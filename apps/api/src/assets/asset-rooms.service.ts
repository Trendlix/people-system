import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssetRoomView } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateRoomDto, UpdateRoomDto } from './assets.dto.js';

// The rooms assets are kept in (the spec's "locations"; owner's brief, 21 October 2026: "call them Rooms or Places so
// they don't clash with Check-in Setup's check-in locations"): Studio A, the storeroom, Office 2 … Everyone with Assets
// access reads them (to see and filter where things are); an Assets manager adds, renames and archives them (archived:
// no longer offered, kept on the assets in it); only a Super Admin deletes one (the system's rule), and only while no
// asset or count names it. Each name once, whatever its case. Every change in the audit log ('asset_room').

export const ROOM_ENTITY = 'asset_room';
const ROOM_NOT_FOUND = 'Room not found.';
const SAME_NAME = 'A room with this name already exists.';
const IN_USE = 'Assets are in this room: move them first, or archive it instead.';

const isDuplicate = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class AssetRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every room, by name (archived ones after), with the assets in it now (disposed ones aside). */
  async list(): Promise<AssetRoomView[]> {
    const [rooms, counts] = await Promise.all([
      this.prisma.assetRoom.findMany({ select: { id: true, name: true, notes: true, archivedAt: true }, orderBy: { name: 'asc' } }),
      this.prisma.asset.groupBy({ by: ['roomId'], where: { roomId: { not: null }, status: { not: 'disposed' } }, _count: { _all: true } }),
    ]);
    const inRoom = new Map(counts.map((c) => [c.roomId, c._count._all]));
    return rooms
      .map((r) => ({ id: r.id, name: r.name, notes: r.notes, archived: r.archivedAt !== null, assets: inRoom.get(r.id) ?? 0 }))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  }

  private async view(id: string): Promise<AssetRoomView> {
    const view = (await this.list()).find((r) => r.id === id);
    if (!view) throw new NotFoundException(ROOM_NOT_FOUND);
    return view;
  }

  async create(dto: CreateRoomDto, userId: string): Promise<AssetRoomView> {
    let id: string;
    try {
      ({ id } = await this.prisma.assetRoom.create({ data: { name: dto.name, notes: dto.notes ?? null }, select: { id: true } }));
    } catch (err) {
      if (isDuplicate(err)) throw new ConflictException(SAME_NAME);
      throw err;
    }
    await this.audit.record({ userId, action: 'create', entityType: ROOM_ENTITY, entityId: id, diff: { name: dto.name, ...(dto.notes && { notes: dto.notes }) } });
    return this.view(id);
  }

  async update(id: string, dto: UpdateRoomDto, userId: string): Promise<AssetRoomView> {
    const before = await this.prisma.assetRoom.findUnique({ where: { id }, select: { name: true, notes: true, archivedAt: true } });
    if (!before) throw new NotFoundException(ROOM_NOT_FOUND);
    const diff = changes({ name: before.name, notes: before.notes, archived: before.archivedAt !== null }, { name: dto.name, notes: dto.notes, archived: dto.archived });
    if (Object.keys(diff).length) {
      try {
        await this.prisma.assetRoom.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.archived !== undefined && { archivedAt: dto.archived ? (before.archivedAt ?? new Date()) : null }),
          },
        });
      } catch (err) {
        if (isDuplicate(err)) throw new ConflictException(SAME_NAME);
        throw err;
      }
      await this.audit.record({ userId, action: 'update', entityType: ROOM_ENTITY, entityId: id, diff });
    }
    return this.view(id);
  }

  /** Only a Super Admin, and only a room no asset (disposed ones too) or count names. */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const room = await this.prisma.assetRoom.findUnique({ where: { id }, select: { name: true, _count: { select: { assets: true, counts: true } } } });
    if (!room) throw new NotFoundException(ROOM_NOT_FOUND);
    if (room._count.assets || room._count.counts) throw new ConflictException(IN_USE);
    try {
      await this.prisma.assetRoom.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw new ConflictException(IN_USE);
      throw err;
    }
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ROOM_ENTITY, entityId: id, diff: { name: room.name } });
  }
}
