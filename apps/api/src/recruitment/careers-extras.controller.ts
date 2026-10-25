import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LINKEDIN_IP_TOKEN } from '@trendlix/shared';
import type { Request } from 'express';
import { verifySignedIp } from '../attendance/signed-ip.js';
import { CurrentUser, NotForDevelopers, Public, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { wantsDownload } from '../pdf/pdf-file.js';
import { attachment } from '../templates/template-file.js';
import { ApplicationsService } from './applications.service.js';
import { CvPrefillDto, LinkedInFinishDto, LinkedInOpenDto, LinkedInSettingsDto, LinkedInStartDto, PortfolioSettingsDto } from './careers-extras.dto.js';
import { CV_UPLOAD } from './cv-file.js';
import { CvPrefillService } from './cv-prefill.service.js';
import { CareersKeyGuard } from './careers-key.guard.js';
import { CvUploadFilter } from './cv-upload.filter.js';
import { GeneralCvsService } from './general-cvs.service.js';
import { LinkedInSignInService } from './linkedin-signin.service.js';
import { PortfolioSettingsService } from './portfolio-settings.service.js';
import { MANAGES, READS } from './recruitment-access.js';

// The careers forms' new addresses (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to complete the
// data? and for creatives, they need to add their portfolios"; asked, all three): reading the CV on the spot and
// LinkedIn's sign-in, without signing in; their settings in Recruitment Settings ("Portfolio on the Forms": HR, the CEO
// and a Super Admin read, HR and a Super Admin change; "LinkedIn Sign-in": a Super Admin's, never a developer's); and the
// PDF case study sent as a portfolio, opened as the CV is (never by a developer).

/** The address a sign-in's start or return counts against: one the website signed for LinkedIn's, else the connection's. */
function linkedinIp(req: Request): string | null {
  // CAREERS_KEY, as the careers forms sign it since they moved to www.trendlix.com (25 October 2026)
  const signed = verifySignedIp(req.headers, LINKEDIN_IP_TOKEN, process.env.CAREERS_KEY, Date.now());
  return signed.ip ?? req.ip ?? null;
}

/** The careers page's: the CV read for the form, and LinkedIn's sign-in. */
@Public()
@UseGuards(CareersKeyGuard)
@Controller('public')
export class CareersExtrasController {
  constructor(
    private readonly prefills: CvPrefillService,
    private readonly linkedin: LinkedInSignInService,
  ) {}

  /** A multipart form with the CV as `cv`: what it gives the form; nothing kept. */
  @Post('cv-prefill')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseFilters(CvUploadFilter)
  @UseInterceptors(FileInterceptor('cv', CV_UPLOAD))
  prefill(@Body() dto: CvPrefillDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.prefills.prefill(file, dto.ip?.trim() || null, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, headers: req.headers });
  }

  /** { form, src, origin }: LinkedIn's sign-in address and the browser's half of the state (or why not). */
  @Post('linkedin/start')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  start(@Body() dto: LinkedInStartDto, @Req() req: Request) {
    return this.linkedin.start(dto, linkedinIp(req));
  }

  /** { state, binding, code?, error? }: the form to go back to, with what LinkedIn gave sealed (or why not). */
  @Post('linkedin/finish')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  finish(@Body() dto: LinkedInFinishDto, @Req() req: Request) {
    return this.linkedin.finish(dto, linkedinIp(req));
  }

  /** { ticket, form }: the name and email to fill in, read once by the form (400 when it expired). */
  @Post('linkedin/open')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  open(@Body() dto: LinkedInOpenDto) {
    return this.linkedin.open(dto);
  }
}

/** Recruitment Settings' "Portfolio on the Forms" and "LinkedIn Sign-in" (25 October 2026). */
@Controller('recruitment/settings')
export class CareersSettingsController {
  constructor(
    private readonly portfolios: PortfolioSettingsService,
    private readonly linkedin: LinkedInSignInService,
  ) {}

  @Roles(...READS)
  @Get('portfolio')
  portfolio() {
    return this.portfolios.view();
  }

  /** Every position's setting; HR and a Super Admin, audited. */
  @Roles(...MANAGES)
  @Put('portfolio')
  savePortfolio(@Body() dto: PortfolioSettingsDto, @CurrentUser() user: SessionUser) {
    return this.portfolios.save(dto, user);
  }

  /** A Super Admin's: never the secret, only whether one is set. */
  @Roles('super_admin')
  @NotForDevelopers()
  @Get('linkedin')
  @Header('Cache-Control', 'private, no-store')
  linkedinSettings(@CurrentUser() user: SessionUser) {
    return this.linkedin.settings(user);
  }

  /** A Super Admin's, audited (the secret only as "changed"). */
  @Roles('super_admin')
  @NotForDevelopers()
  @Put('linkedin')
  @Header('Cache-Control', 'private, no-store')
  saveLinkedIn(@Body() dto: LinkedInSettingsDto, @CurrentUser() user: SessionUser) {
    return this.linkedin.saveSettings(dto, user);
  }
}

/** The PDF case study sent as a portfolio: shown in the browser, or saved with ?download=1; never a developer. */
@Controller('recruitment')
export class PortfolioFilesController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly generalCvs: GeneralCvsService,
  ) {}

  /** For those who may open the applicant. */
  @NotForDevelopers()
  @Get('applications/:id/portfolio-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async application(@Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.applications.portfolioFile(id, user);
    return new StreamableFile(file.data, { type: 'application/pdf', length: file.data.length, disposition: wantsDownload(download) ? attachment(file.fileName) : contentDisposition(file.fileName) });
  }

  /** HR, the CEO and a Super Admin. */
  @NotForDevelopers()
  @Get('general-cvs/:id/portfolio-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async generalCv(@Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.generalCvs.portfolioFile(id, user);
    return new StreamableFile(file.data, { type: 'application/pdf', length: file.data.length, disposition: wantsDownload(download) ? attachment(file.fileName) : contentDisposition(file.fileName) });
  }
}
