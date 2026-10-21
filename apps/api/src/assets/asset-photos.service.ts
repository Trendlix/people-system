import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ASSET_PHOTOS_MAX, type AssetPhotoRef } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import { detectLogoType, type LogoType } from '../company/logo-type.js';
import type { Prisma } from '../generated/prisma/client.js';
import { safeFileName } from '../paperwork/paperwork-file.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetsCaller } from './assets-access.js';
import { AssetsService } from './assets.service.js';

// An asset's photos (owner's brief, 21 October 2026: "Photos upload, up to 6 per asset, to the system's file storage
// like the employee documents, served through the API with permission checks"): kept in the database as the employee
// file's papers are, a JPEG, PNG or WebP each (known by its first bytes, never the browser's word; never SVG), at most
// 10 MB (the upload limit, as the papers'), in order: the first is the one the lists show. Anyone with Assets access sees
// them; a custodian or manager adds them, replaces one and makes one the first; only a Super Admin deletes one (the
// system's rule). Each change in the audit log ('asset_photo'), its name and size, never the picture.

export const PHOTO_ENTITY = 'asset_photo';
const PHOTO_NOT_FOUND = 'Photo not found.';
const TOO_MANY = `An asset has at most ${ASSET_PHOTOS_MAX} photos.`;
const NOT_A_PHOTO = 'Each photo must be a JPEG, PNG or WebP picture.';

const ORDER = [{ position: 'asc' }, { uploadedAt: 'asc' }] satisfies Prisma.AssetPhotoOrderByWithRelationInput[];

interface Upload {
  data: Buffer;
  type: LogoType;
  fileName: string;
}

/** An uploaded file, checked by its content. */
function photoOf(file: Express.Multer.File | undefined): Upload {
  if (!file?.buffer?.length) throw new BadRequestException(['Choose a photo.']);
  const type = detectLogoType(file.buffer);
  if (!type) throw new BadRequestException([NOT_A_PHOTO]);
  return { data: file.buffer, type, fileName: safeFileName(file.originalname, type) };
}

@Injectable()
export class AssetPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
  ) {}

  /** The asset's photos in order. */
  private async listOf(db: PrismaService | Prisma.TransactionClient, assetId: string): Promise<AssetPhotoRef[]> {
    return db.assetPhoto.findMany({ where: { assetId }, select: { id: true, position: true }, orderBy: ORDER });
  }

  /** Numbers the photos 0, 1, 2 … in the order given. */
  private async renumber(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    for (const [position, id] of ids.entries()) await tx.assetPhoto.update({ where: { id }, data: { position } });
  }

  /**
   * Adds photos after the ones it has, up to 6 in all: refused (409) when they would be more, none of them added. Two
   * uploads at once wait for each other (the asset's row is locked), so together they never pass 6 either.
   */
  async add(code: string, files: Express.Multer.File[] | undefined, caller: AssetsCaller): Promise<AssetPhotoRef[]> {
    const asset = await this.assets.idOf(code);
    const uploads = (files ?? []).map(photoOf);
    if (!uploads.length) throw new BadRequestException(['Choose a photo.']);
    const added = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${asset.id}::uuid FOR UPDATE`;
      const have = await this.listOf(tx, asset.id);
      if (have.length + uploads.length > ASSET_PHOTOS_MAX) throw new ConflictException(TOO_MANY);
      const next = have.length ? Math.max(...have.map((p) => p.position)) + 1 : 0;
      const out: { id: string; fileName: string; sizeBytes: number }[] = [];
      for (const [i, u] of uploads.entries()) {
        const row = await tx.assetPhoto.create({
          data: { assetId: asset.id, position: next + i, fileName: u.fileName, mimeType: u.type, sizeBytes: u.data.length, data: new Uint8Array(u.data), uploadedById: caller.user.id },
          select: { id: true, fileName: true, sizeBytes: true },
        });
        out.push(row);
      }
      return out;
    });
    for (const p of added) {
      await this.audit.record({ userId: caller.user.id, action: 'create', entityType: PHOTO_ENTITY, entityId: p.id, diff: { assetId: asset.id, code: asset.code, fileName: p.fileName, sizeBytes: p.sizeBytes } });
    }
    return this.listOf(this.prisma, asset.id);
  }

  /** A photo's file replaced by another (a better one), in its place. */
  async replace(code: string, photoId: string, file: Express.Multer.File | undefined, caller: AssetsCaller): Promise<AssetPhotoRef[]> {
    const asset = await this.assets.idOf(code);
    const photo = await this.photoOf(asset.id, photoId);
    const u = photoOf(file);
    await this.prisma.assetPhoto.update({ where: { id: photo.id }, data: { fileName: u.fileName, mimeType: u.type, sizeBytes: u.data.length, data: new Uint8Array(u.data), uploadedById: caller.user.id, uploadedAt: new Date() } });
    await this.audit.record({
      userId: caller.user.id,
      action: 'replace',
      entityType: PHOTO_ENTITY,
      entityId: photo.id,
      diff: { assetId: asset.id, code: asset.code, file: 'replaced', fileName: u.fileName, sizeBytes: u.data.length },
    });
    return this.listOf(this.prisma, asset.id);
  }

  /** A photo made the first, the one the lists show; the others keep their order after it. */
  async makeFirst(code: string, photoId: string, caller: AssetsCaller): Promise<AssetPhotoRef[]> {
    const asset = await this.assets.idOf(code);
    const photo = await this.photoOf(asset.id, photoId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${asset.id}::uuid FOR UPDATE`;
      const have = await this.listOf(tx, asset.id);
      await this.renumber(tx, [photo.id, ...have.filter((p) => p.id !== photo.id).map((p) => p.id)]);
    });
    await this.audit.record({ userId: caller.user.id, action: 'make_first', entityType: PHOTO_ENTITY, entityId: photo.id, diff: { assetId: asset.id, code: asset.code, fileName: photo.fileName } });
    return this.listOf(this.prisma, asset.id);
  }

  /** Only a Super Admin deletes a photo (the system's rule); the others close up after it. */
  async remove(code: string, photoId: string, caller: AssetsCaller): Promise<void> {
    assertDeletes(caller.user);
    const asset = await this.assets.idOf(code);
    const photo = await this.photoOf(asset.id, photoId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${asset.id}::uuid FOR UPDATE`;
      await tx.assetPhoto.delete({ where: { id: photo.id } });
      await this.renumber(tx, (await this.listOf(tx, asset.id)).map((p) => p.id));
    });
    await this.audit.record({ userId: caller.user.id, action: 'delete', entityType: PHOTO_ENTITY, entityId: photo.id, diff: { assetId: asset.id, code: asset.code, fileName: photo.fileName } });
  }

  /** A photo's file, for GET …/photos/:photoId. */
  async file(code: string, photoId: string): Promise<{ data: Buffer; type: string }> {
    const asset = await this.assets.idOf(code);
    const row = await this.prisma.assetPhoto.findFirst({ where: { id: photoId, assetId: asset.id }, select: { mimeType: true, data: true } });
    if (!row) throw new NotFoundException(PHOTO_NOT_FOUND);
    return { data: Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength), type: row.mimeType };
  }

  private async photoOf(assetId: string, photoId: string): Promise<{ id: string; fileName: string }> {
    const row = await this.prisma.assetPhoto.findFirst({ where: { id: photoId, assetId }, select: { id: true, fileName: true } });
    if (!row) throw new NotFoundException(PHOTO_NOT_FOUND);
    return row;
  }
}
