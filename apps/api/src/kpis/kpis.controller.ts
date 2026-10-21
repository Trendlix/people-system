import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { KpiOverviewService } from './kpi-overview.service.js';
import { KpiSchedulerService } from './kpi-scheduler.service.js';
import { KpiScorecardsService } from './kpi-scorecards.service.js';
import { KpiSettingsService } from './kpi-settings.service.js';
import { KpiTemplatesService } from './kpi-templates.service.js';
import {
  KpiCalibrateDto,
  KpiDraftDto,
  KpiExportQueryDto,
  KpiHeatmapQueryDto,
  KpiListQueryDto,
  KpiMonthQueryDto,
  KpiPicksDto,
  KpiPublishDraftsDto,
  KpiSettingsDto,
  KpiSignDto,
  KpiTemplateContentDto,
} from './kpis.dto.js';

// The KPIs' routes (owner, 21 October 2026: "lets start with the KPI's First"; packages/shared kpis.ts has every answer's
// shape). The settings: everyone reads the deadlines, HR and a Super Admin change them. The templates: HR and a Super
// Admin build them; HR, the CEO and Admin read them all; a manager and the people under a job title its published
// versions (checked by the service). The scorecards: everyone signed in reaches their own, those they score and what
// waits for them, each checked by the service (anyone else is told a scorecard isn't there); HR, the CEO and a Super
// Admin read every one (HR not a C-level person's), with the month's overview and its Excel; HR opens last month's
// scorecards at once. The role library (owner, 21 October 2026: "can you add templetes for all departments and job
// roles"): HR and a Super Admin list its roles, start a draft from one, draft every job title without a template from
// its matched role, and publish the drafts they choose at once.

@Controller('kpis/settings')
export class KpiSettingsController {
  constructor(private readonly settings: KpiSettingsService) {}

  @Get()
  view() {
    return this.settings.view();
  }

  @Roles('hr', 'super_admin')
  @Patch()
  update(@Body() dto: KpiSettingsDto, @CurrentUser() user: SessionUser) {
    return this.settings.update(dto, user);
  }
}

@Controller('kpis/templates')
export class KpiTemplatesController {
  constructor(private readonly templates: KpiTemplatesService) {}

  @Roles('hr', 'ceo', 'admin')
  @Get()
  list() {
    return this.templates.list();
  }

  @Roles('hr', 'super_admin')
  @Get('samples')
  samples() {
    return this.templates.samples();
  }

  /** The role library: [{ key, name, kind }], for "From the role library". */
  @Roles('hr', 'super_admin')
  @Get('library')
  library() {
    return this.templates.library();
  }

  /** "Draft templates for every job title": { made: [{ jobTitleId, templateId, title, department, libraryKey, … reason }], skipped: [{ jobTitleId, title, why }] }. */
  @Roles('hr', 'super_admin')
  @Post('draft-all')
  @HttpCode(200)
  draftAll(@CurrentUser() user: SessionUser) {
    return this.templates.draftAll(user);
  }

  /** "Publish selected drafts": { templateIds } → { published: [...], problems: [{ templateId, title, problems }] }. */
  @Roles('hr', 'super_admin')
  @Post('publish-drafts')
  @HttpCode(200)
  publishDrafts(@Body() dto: KpiPublishDraftsDto, @CurrentUser() user: SessionUser) {
    return this.templates.publishDrafts(dto, user);
  }

  @Get('job-titles/:jobTitleId')
  jobTitle(@Param('jobTitleId', ParseUUIDPipe) jobTitleId: string, @CurrentUser() user: SessionUser) {
    return this.templates.jobTitlePage(jobTitleId, user);
  }

  /** { from: blank | published | sample (sampleCode) | template (templateId) | library (libraryKey) } → the new draft. */
  @Roles('hr', 'super_admin')
  @Post('job-titles/:jobTitleId/draft')
  createDraft(@Param('jobTitleId', ParseUUIDPipe) jobTitleId: string, @Body() dto: KpiDraftDto, @CurrentUser() user: SessionUser) {
    return this.templates.createDraft(jobTitleId, dto, user);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.templates.one(id, user);
  }

  /** A draft's content: { attendancePoints, metrics: [{ pillar, name, definition, howMeasured, jdDuty, targetPoints, criteria: [{ label, points }] }] }. */
  @Roles('hr', 'super_admin')
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KpiTemplateContentDto, @CurrentUser() user: SessionUser) {
    return this.templates.update(id, dto, user);
  }

  @Roles('hr', 'super_admin')
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.templates.publish(id, user);
  }

  @DeletesRecords()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.templates.remove(id, user);
  }
}

@Controller('kpis')
export class KpiScorecardsController {
  constructor(
    private readonly scorecards: KpiScorecardsService,
    private readonly overviews: KpiOverviewService,
    private readonly scheduler: KpiSchedulerService,
  ) {}

  /** { self, team, hr }: what waits for the caller. */
  @Get('counts')
  counts(@CurrentUser() user: SessionUser) {
    return this.scorecards.counts(user);
  }

  @Get('scorecards/mine')
  mine(@CurrentUser() user: SessionUser) {
    return this.scorecards.mine(user);
  }

  @Get('scorecards/waiting')
  waiting(@CurrentUser() user: SessionUser) {
    return this.scorecards.waiting(user);
  }

  /** ?scope=team|all&month=YYYY-MM&status=&departmentId=. */
  @Get('scorecards')
  list(@Query() query: KpiListQueryDto, @CurrentUser() user: SessionUser) {
    return this.scorecards.list(query, user);
  }

  @Get('scorecards/:id')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.scorecards.one(id, user);
  }

  /** The employee's self-rating: { picks: [{ metricId, choice, comment }], comment, submit }. */
  @Post('scorecards/:id/self')
  @HttpCode(200)
  selfRate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KpiPicksDto, @CurrentUser() user: SessionUser) {
    return this.scorecards.selfRate(id, dto, user);
  }

  /** The scorer's scoring: { picks, comment, submit }. */
  @Post('scorecards/:id/score')
  @HttpCode(200)
  score(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KpiPicksDto, @CurrentUser() user: SessionUser) {
    return this.scorecards.score(id, dto, user);
  }

  /** HR's calibration: { changes: [{ metricId, choice, reason }], comment }. */
  @Post('scorecards/:id/calibrate')
  @HttpCode(200)
  calibrate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KpiCalibrateDto, @CurrentUser() user: SessionUser) {
    return this.scorecards.calibrate(id, dto, user);
  }

  /** "I've read it": { comment }. */
  @Post('scorecards/:id/sign')
  @HttpCode(200)
  sign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KpiSignDto, @CurrentUser() user: SessionUser) {
    return this.scorecards.sign(id, dto, user);
  }

  /** ?scope=team|all&to=YYYY-MM&months=6. */
  @Get('heatmap')
  heatmap(@Query() query: KpiHeatmapQueryDto, @CurrentUser() user: SessionUser) {
    return this.overviews.heatmap(query, user);
  }

  @Roles('hr', 'ceo', 'super_admin')
  @Get('overview')
  overview(@Query() query: KpiMonthQueryDto, @CurrentUser() user: SessionUser) {
    return this.overviews.overview(query.month, user);
  }

  /** The month's scorecards as an Excel workbook: "KPIs October 2026.xlsx". */
  @Roles('hr', 'ceo', 'super_admin')
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async export(@Query() query: KpiExportQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.overviews.workbook(query.month, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** Opens last month's scorecards still missing, now: { month, opened }. */
  @Roles('hr')
  @Post('open')
  @HttpCode(200)
  open(@CurrentUser() user: SessionUser) {
    return this.scheduler.openNow(user);
  }
}

