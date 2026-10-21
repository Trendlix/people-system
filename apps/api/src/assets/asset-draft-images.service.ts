import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ASSET_PRODUCT_IMAGES_MAX,
  productImageHost,
  productImageProblem,
  productImageUrlProblem,
  type AssetDraftImageView,
  type AssetUserRef,
  type ProductImageType,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { safeFileName } from '../paperwork/paperwork-file.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetsCaller } from './assets-access.js';
import type { ProductImageDto } from './assets.dto.js';

// The product images on a draft from Claude (owner, 21 October 2026: "i want claude to add product image from its specs.
// is this applicable?", then "let the mcp connector fetch the product photo and add it / yes build it"; packages/shared
// product-images.ts). Claude finds the maker's image with its web search and gives the link; the website's MCP endpoint
// fetches it (https, public addresses only, 3 redirects, 10 seconds, 5 MB) and sends the bytes here with the connector's
// token. Checked again here by their bytes (a JPEG, PNG or WebP by its magic numbers, never SVG; 100 to 8000 pixels a
// side; at most 5 MB), at most 3 a draft still waiting, the same link once. A custodian or a manager removes one on the
// website. Confirmed, they become the asset's photos (kind 'product', their source kept) in the confirm's transaction;
// discarded, they are deleted. Each change in the audit log on the draft ('asset_draft', "via Claude connector" when it
// came through it), with its source page and link, never the picture.

const DRAFT = 'asset_draft';
const DRAFT_NOT_FOUND = 'Draft not found.';
const IMAGE_NOT_FOUND = 'Product image not found.';
const TOO_MANY = `A draft has at most ${ASSET_PRODUCT_IMAGES_MAX} product images. Remove one on the draft’s page to add another.`;
const ALREADY_THERE = 'This image is already on the draft.';

const done = (status: string) =>
  status === 'confirmed' ? 'This draft was already confirmed: it is in the register.' : 'This draft was discarded: it can’t be changed or confirmed.';

const ORDER = [{ position: 'asc' }, { addedAt: 'asc' }] satisfies Prisma.AssetDraftImageOrderByWithRelationInput[];

/** What a draft's answer reads of its product images: everything but the bytes. */
export const DRAFT_IMAGE_VIEW = {
  id: true,
  position: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  sourcePageUrl: true,
  imageUrl: true,
  caption: true,
  addedAt: true,
  addedBy: { select: { id: true, email: true } },
} as const satisfies Prisma.AssetDraftImageSelect;

export const DRAFT_IMAGES = { select: DRAFT_IMAGE_VIEW, orderBy: ORDER } as const;

type ImageRow = Prisma.AssetDraftImageGetPayload<{ select: typeof DRAFT_IMAGE_VIEW }>;

/** A product image as a draft's answer has it; `person`: a user by name. */
export function draftImageView(r: ImageRow, person: (u: { id: string; email: string } | null) => AssetUserRef | null): AssetDraftImageView {
  return {
    id: r.id,
    position: r.position,
    mimeType: r.mimeType as ProductImageType,
    sizeBytes: r.sizeBytes,
    width: r.width,
    height: r.height,
    sourcePageUrl: r.sourcePageUrl,
    sourceHost: productImageHost(r.sourcePageUrl) ?? r.sourcePageUrl,
    imageUrl: r.imageUrl,
    caption: r.caption,
    addedAt: r.addedAt.toISOString(),
    addedBy: person(r.addedBy),
  };
}

/** The file's name: the link's last part (sony-fx3-front.jpg), else "product-image", with the kind's extension. */
function fileNameOf(imageUrl: string, type: ProductImageType): string {
  let last = '';
  try {
    last = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() ?? '');
  } catch {
    last = '';
  }
  return safeFileName(last || 'product-image', type);
}

/** A photo moved from a draft to its asset, for the audit log. */
export interface MovedImage {
  id: string;
  fileName: string;
  sizeBytes: number;
  sourcePageUrl: string;
  imageUrl: string;
}

@Injectable()
export class AssetDraftImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The draft locked for this transaction (two adds at once wait for each other), or 404 / 409. */
  private async lockOpen(tx: Prisma.TransactionClient, draftId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM asset_drafts WHERE id = ${draftId}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundException(DRAFT_NOT_FOUND);
    if (rows[0].status !== 'open') throw new ConflictException(done(rows[0].status));
  }

  /** The draft's product images in order, without their bytes. */
  private async list(draftId: string): Promise<AssetDraftImageView[]> {
    const rows = await this.prisma.assetDraftImage.findMany({ where: { draftId }, ...DRAFT_IMAGES });
    return rows.map((r) => draftImageView(r, (u) => (u ? { email: u.email, name: null } : null)));
  }

  /**
   * POST /assets/drafts/:id/product-images (the Claude connector's): the image the website fetched, with its link and
   * its source page, after the ones the draft has, up to 3. Answers the draft's product images after.
   */
  async add(draftId: string, file: Express.Multer.File | undefined, dto: ProductImageDto, caller: AssetsCaller): Promise<AssetDraftImageView[]> {
    const problems = [productImageUrlProblem(dto.imageUrl, 'The image link'), productImageUrlProblem(dto.sourcePageUrl, 'The source page')].filter((p): p is string => !!p);
    if (problems.length) throw new BadRequestException(problems);
    if (!file?.buffer?.length) throw new BadRequestException(['Send the image.']);
    const checked = productImageProblem(new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength));
    if ('problem' in checked) throw new BadRequestException([checked.problem]);
    const imageUrl = dto.imageUrl.trim();
    const sourcePageUrl = dto.sourcePageUrl.trim();
    const caption = dto.caption?.trim() || null;
    const fileName = fileNameOf(imageUrl, checked.type);

    const added = await this.prisma.$transaction(async (tx) => {
      await this.lockOpen(tx, draftId);
      const have = await tx.assetDraftImage.findMany({ where: { draftId }, select: { position: true, imageUrl: true } });
      if (have.some((h) => h.imageUrl === imageUrl)) throw new ConflictException(ALREADY_THERE);
      if (have.length >= ASSET_PRODUCT_IMAGES_MAX) throw new ConflictException(TOO_MANY);
      const position = have.length ? Math.max(...have.map((h) => h.position)) + 1 : 0;
      return tx.assetDraftImage.create({
        data: {
          draftId,
          position,
          fileName,
          mimeType: checked.type,
          sizeBytes: file.buffer.length,
          width: checked.width,
          height: checked.height,
          data: new Uint8Array(file.buffer),
          sourcePageUrl,
          imageUrl,
          caption,
          addedById: caller.user.id,
        },
        select: { id: true },
      });
    });
    await this.audit.record({
      userId: caller.user.id,
      action: 'add_product_image',
      entityType: DRAFT,
      entityId: draftId,
      diff: { imageId: added.id, sourcePageUrl, imageUrl, ...(caption !== null && { caption }), fileName, sizeBytes: file.buffer.length, width: checked.width, height: checked.height },
    });
    return this.list(draftId);
  }

  /** A product image taken off a draft still waiting (a custodian or a manager, on the website); the others close up. */
  async remove(draftId: string, imageId: string, caller: AssetsCaller): Promise<void> {
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.lockOpen(tx, draftId);
      const image = await tx.assetDraftImage.findFirst({ where: { id: imageId, draftId }, select: { id: true, fileName: true, sourcePageUrl: true, imageUrl: true } });
      if (!image) throw new NotFoundException(IMAGE_NOT_FOUND);
      await tx.assetDraftImage.delete({ where: { id: image.id } });
      const rest = await tx.assetDraftImage.findMany({ where: { draftId }, select: { id: true }, orderBy: ORDER });
      for (const [position, r] of rest.entries()) await tx.assetDraftImage.update({ where: { id: r.id }, data: { position } });
      return image;
    });
    await this.audit.record({
      userId: caller.user.id,
      action: 'remove_product_image',
      entityType: DRAFT,
      entityId: draftId,
      diff: { imageId: removed.id, sourcePageUrl: removed.sourcePageUrl, imageUrl: removed.imageUrl, fileName: removed.fileName },
    });
  }

  /** A product image's file, for GET …/product-images/:imageId. */
  async file(draftId: string, imageId: string): Promise<{ data: Buffer; type: string }> {
    const row = await this.prisma.assetDraftImage.findFirst({ where: { id: imageId, draftId }, select: { mimeType: true, data: true } });
    if (!row) throw new NotFoundException(IMAGE_NOT_FOUND);
    return { data: Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength), type: row.mimeType };
  }

  /**
   * The draft's product images become the new asset's photos, in their order, kind 'product' with their source, and
   * leave the draft: in the confirm's transaction (the asset has no photos yet, so the first is its main photo until a
   * real one is added: AssetPhotosService.add puts real photos before them). The bytes are copied inside the database.
   */
  async moveToAsset(tx: Prisma.TransactionClient, draftId: string, assetId: string): Promise<MovedImage[]> {
    const moved = await tx.$queryRaw<{ id: string; file_name: string; size_bytes: number; source_page_url: string; image_url: string }[]>`
      INSERT INTO asset_photos (id, asset_id, position, file_name, mime_type, size_bytes, data, uploaded_by, uploaded_at, kind, source_page_url, image_url, caption)
      SELECT gen_random_uuid(), ${assetId}::uuid, (ROW_NUMBER() OVER (ORDER BY position, added_at) - 1)::int, file_name, mime_type, size_bytes, data, added_by, added_at,
             'product', source_page_url, image_url, caption
      FROM asset_draft_images WHERE draft_id = ${draftId}::uuid
      RETURNING id, file_name, size_bytes, source_page_url, image_url`;
    if (moved.length) await tx.assetDraftImage.deleteMany({ where: { draftId } });
    return moved.map((m) => ({ id: m.id, fileName: m.file_name, sizeBytes: m.size_bytes, sourcePageUrl: m.source_page_url, imageUrl: m.image_url }));
  }

  /** The draft's product images deleted with its discard; how many. */
  async removeAll(tx: Prisma.TransactionClient, draftId: string): Promise<number> {
    return (await tx.assetDraftImage.deleteMany({ where: { draftId } })).count;
  }
}
