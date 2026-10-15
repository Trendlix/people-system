import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, DeletesRecords, Public, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { attachment } from '../templates/template-file.js';
import { AcceptOfferDto, AnswerOfferDto, CreateOfferDto, DeclineOfferDto, ListOffersDto, OfferDocumentQueryDto, SendOfferDto, UpdateOfferDto, WithdrawOfferDto } from './offers.dto.js';
import { OffersService } from './offers.service.js';
import { PublicOffersService, type ResponseOrigin } from './public-offers.service.js';

// Job offers (owner's request, 15 October 2026). HR drafts, sends, withdraws offers and records answers given another
// way; HR and the CEO read them (the amounts only for those who see salaries); only a Super Admin deletes one. The
// candidate answers on the offer's page, without signing in, by the link's secret (PublicOffersController).

/** A file as the browser gets it: a PDF shown, a Word file downloaded. */
function fileOf(f: { data: Buffer; type: string; fileName: string; inline: boolean }): StreamableFile {
  return new StreamableFile(f.data, { type: f.type, length: f.data.length, disposition: f.inline ? contentDisposition(f.fileName) : attachment(f.fileName) });
}

@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  /** Newest first; ?status= (a shown status, or open) and ?q= (names, email, number) filter. At most 500. */
  @Roles('hr', 'ceo')
  @Get()
  list(@Query() query: ListOffersDto, @CurrentUser() user: SessionUser) {
    return this.offers.list(query, user);
  }

  @Roles('hr')
  @Post()
  create(@Body() dto: CreateOfferDto, @CurrentUser() user: SessionUser) {
    return this.offers.create(dto, user);
  }

  @Roles('hr', 'ceo')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.offers.get(id, user);
  }

  @Roles('hr')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfferDto, @CurrentUser() user: SessionUser) {
    return this.offers.update(id, dto, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.offers.remove(id, user);
  }

  /** The offer's document (?format=pdf|docx, the Word file unless sent): a draft filled in afresh, else the copy as sent. */
  @Roles('hr', 'ceo')
  @Get(':id/document')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async document(@Param('id', ParseUUIDPipe) id: string, @Query() query: OfferDocumentQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    return fileOf(await this.offers.document(id, query.format ?? 'docx', user));
  }

  /** Sends the offer by email, or makes its link for HR to send: { offer, link }. */
  @Roles('hr')
  @Post(':id/send')
  @HttpCode(200)
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendOfferDto, @CurrentUser() user: SessionUser) {
    return this.offers.send(id, dto, user);
  }

  @Roles('hr')
  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WithdrawOfferDto, @CurrentUser() user: SessionUser) {
    return this.offers.withdraw(id, dto, user);
  }

  /** An answer the candidate gave another way, recorded by HR. */
  @Roles('hr')
  @Post(':id/answer')
  @HttpCode(200)
  answer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerOfferDto, @CurrentUser() user: SessionUser) {
    return this.offers.answer(id, dto, user);
  }

  /** Makes the profile, employment and draft contract from an accepted offer, when that failed before. */
  @Roles('hr')
  @Post(':id/hire')
  @HttpCode(200)
  hire(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.offers.hire(id, user);
  }
}

/** Where the request came from, when the web app doesn't say. */
const originOf = (req: Request): ResponseOrigin => ({ ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });

/** The offer's page, by the link's secret: no sign-in. */
@Public()
@Controller('public/offers')
export class PublicOffersController {
  constructor(private readonly offers: PublicOffersService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  view(@Param('token') token: string) {
    return this.offers.view(token);
  }

  /** The offer as sent: the PDF shown in the browser, or the Word file. */
  @Get(':token/document')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async document(@Param('token') token: string): Promise<StreamableFile> {
    return fileOf(await this.offers.file(token));
  }

  @Post(':token/accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  accept(@Param('token') token: string, @Body() dto: AcceptOfferDto, @Req() req: Request) {
    return this.offers.accept(token, dto, originOf(req));
  }

  @Post(':token/decline')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  decline(@Param('token') token: string, @Body() dto: DeclineOfferDto, @Req() req: Request) {
    return this.offers.decline(token, dto, originOf(req));
  }
}
