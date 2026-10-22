import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  ASSET_CLASS_LABELS,
  ASSET_CONDITION_LABELS,
  ASSET_COUNT_RESULT_LABELS,
  ASSET_EXPORT_LABELS,
  ASSET_GROUP_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_TYPE_LABELS,
  assetExportFileName,
  bookValue,
  CUSTODY_KIND_LABELS,
  CUSTODY_STATUS_LABELS,
  MAINTENANCE_EVENT_LABELS,
  MAINTENANCE_KIND_LABELS,
  RETURN_CONDITION_LABELS,
  type AssetClass,
  type AssetCondition,
  type AssetCountResult,
  type AssetExportKind,
  type AssetStatus,
  type AssetType,
  type CustodyKind,
  type CustodyStatus,
  type MaintenanceEvent,
  type MaintenanceKind,
  type ReturnCondition,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { dayInCairo, fromDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssetSettingsService } from './asset-settings.service.js';
import type { AssetsCaller } from './assets-access.js';

// The Assets exports (Assets step 5; owner, 22 October 2026: "Assets step 5 (… exports)"; the spec's §5 Settings:
// exports), each an Excel workbook written like the system's others (bold, frozen headers, widths, an autofilter):
// the asset register, the custody records with their items, the stock moves, the maintenance log and the counts with
// their lines. Anyone with Assets access downloads them; the money columns (purchase cost, supplier, invoice, market
// value, book value, a custody item's value, a repair's cost, a disposal's amounts) are only in the CEO's, Finance's and
// a Super Admin's ("CEO and Finance"). C-level people's custody records are left out, and their names as holders, for
// those who don't see them (the custody pages' rule). Each download is in the audit log, with its kind and rows.

export const EXPORT_ENTITY = 'asset_report';

const USER = { select: { id: true, email: true } } as const;
const label = <K extends string>(labels: Record<K, string>, key: string | null | undefined): string | null => (key ? (labels[key as K] ?? key) : null);
const money = (d: Prisma.Decimal | null | undefined): number | null => (d === null || d === undefined ? null : d.toNumber());
const shownDay = (d: Date | null | undefined): string | null => (d ? fromDateOnly(d) : null);
const shownAt = (d: Date | null | undefined): string | null => (d ? `${dayInCairo(d)} ${d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' })}` : null);
const MONEY = '#,##0.00';

@Injectable()
export class AssetExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly settings: AssetSettingsService,
  ) {}

  /** The workbook of `kind`, its name and how many rows it has; the download audited. */
  async workbook(kind: AssetExportKind, caller: AssetsCaller): Promise<{ fileName: string; data: Buffer }> {
    const today = todayInCairo();
    const wb = new ExcelJS.Workbook();
    const sheet = ASSET_EXPORT_LABELS[kind].title;
    let rows = 0;
    switch (kind) {
      case 'register':
        rows = await this.register(wb, sheet, caller, today);
        break;
      case 'custody':
        rows = await this.custody(wb, sheet, caller);
        break;
      case 'stock':
        rows = await this.stock(wb, sheet);
        break;
      case 'maintenance':
        rows = await this.maintenance(wb, sheet, caller);
        break;
      case 'counts':
        rows = await this.counts(wb, sheet);
        break;
    }
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.record({ userId: caller.user.id, action: 'asset_file', entityType: EXPORT_ENTITY, diff: { export: kind, rows, values: caller.values } });
    return { fileName: assetExportFileName(kind, today), data };
  }

  private async register(wb: ExcelJS.Workbook, name: string, caller: AssetsCaller, today: string): Promise<number> {
    const [hidden, threshold, rows] = await Promise.all([
      this.confidential.hiddenFrom(caller.user).then((ids) => new Set(ids)),
      this.settings.threshold(),
      this.prisma.asset.findMany({
        select: {
          code: true,
          name: true,
          group: true,
          type: true,
          assetClass: true,
          status: true,
          condition: true,
          brand: true,
          model: true,
          serial: true,
          quantity: true,
          unit: true,
          reorderLevel: true,
          purchaseDate: true,
          usefulLifeYears: true,
          warrantyEnd: true,
          labeledAt: true,
          notes: true,
          createdAt: true,
          purchasePrice: true,
          supplier: true,
          invoiceNo: true,
          priceLow: true,
          marketValue: true,
          priceHigh: true,
          disposalMethod: true,
          disposedOn: true,
          disposalAmount: true,
          disposalBookValue: true,
          room: { select: { name: true } },
          kit: { select: { code: true, name: true } },
          holder: { select: { id: true, employeeCode: true, fullNameEn: true } },
        },
        orderBy: { code: 'asc' },
      }),
    ]);
    type Row = (typeof rows)[number];
    const columns: Column<Row>[] = [
      { header: 'Code', width: 14, value: (r) => r.code },
      { header: 'Name', width: 32, value: (r) => r.name },
      { header: 'Group', width: 24, value: (r) => label(ASSET_GROUP_LABELS, r.group) },
      { header: 'Type', width: 18, value: (r) => label(ASSET_TYPE_LABELS as Record<AssetType, string>, r.type) },
      { header: 'Class', width: 14, value: (r) => label(ASSET_CLASS_LABELS as Record<AssetClass, string>, r.assetClass) },
      { header: 'Status', width: 14, value: (r) => label(ASSET_STATUS_LABELS as Record<AssetStatus, string>, r.status) },
      { header: 'Condition', width: 14, value: (r) => label(ASSET_CONDITION_LABELS as Record<AssetCondition, string>, r.condition) },
      { header: 'Brand', width: 16, value: (r) => r.brand },
      { header: 'Model', width: 18, value: (r) => r.model },
      { header: 'Serial', width: 20, value: (r) => r.serial },
      { header: 'Room', width: 18, value: (r) => r.room?.name ?? null },
      { header: 'Kit', width: 22, value: (r) => (r.kit ? `${r.kit.code} · ${r.kit.name}` : null) },
      { header: 'Holder code', width: 12, value: (r) => (r.holder && !hidden.has(r.holder.id) ? r.holder.employeeCode : null) },
      { header: 'Holder', width: 26, value: (r) => (r.holder && !hidden.has(r.holder.id) ? r.holder.fullNameEn : null) },
      { header: 'Quantity', width: 10, numFmt: '#,##0.##', value: (r) => money(r.quantity) },
      { header: 'Unit', width: 10, value: (r) => r.unit },
      { header: 'Reorder level', width: 10, numFmt: '#,##0.##', value: (r) => money(r.reorderLevel) },
      { header: 'Purchase date', width: 12, value: (r) => shownDay(r.purchaseDate) },
      { header: 'Useful life (years)', width: 10, numFmt: '0', value: (r) => r.usefulLifeYears },
      { header: 'Warranty end', width: 12, value: (r) => shownDay(r.warrantyEnd) },
      { header: 'Labelled on', width: 12, value: (r) => (r.labeledAt ? dayInCairo(r.labeledAt) : null) },
      { header: 'Registered on', width: 12, value: (r) => dayInCairo(r.createdAt) },
      { header: 'Notes', width: 40, wrap: true, value: (r) => r.notes },
    ];
    if (caller.values) {
      const book = (r: Row) =>
        bookValue({ purchasePrice: money(r.purchasePrice), purchaseDate: fromDateOnly(r.purchaseDate), usefulLifeYears: r.usefulLifeYears, assetClass: r.assetClass }, threshold, today);
      columns.push(
        { header: 'Purchase cost (EGP)', width: 14, numFmt: MONEY, value: (r) => money(r.purchasePrice) },
        { header: 'Supplier', width: 20, value: (r) => r.supplier },
        { header: 'Invoice', width: 14, value: (r) => r.invoiceNo },
        { header: 'Market low (EGP)', width: 14, numFmt: MONEY, value: (r) => money(r.priceLow) },
        { header: 'Market value (EGP)', width: 14, numFmt: MONEY, value: (r) => money(r.marketValue) },
        { header: 'Market high (EGP)', width: 14, numFmt: MONEY, value: (r) => money(r.priceHigh) },
        { header: `Book value on ${today} (EGP)`, width: 16, numFmt: MONEY, value: (r) => (r.status === 'disposed' ? null : book(r).amount) },
        { header: 'Expensed', width: 10, value: (r) => (r.status !== 'disposed' && book(r).expensed ? 'Yes' : null) },
        { header: 'Disposal', width: 14, value: (r) => r.disposalMethod },
        { header: 'Disposed on', width: 12, value: (r) => shownDay(r.disposedOn) },
        { header: 'Disposal amount (EGP)', width: 14, numFmt: MONEY, value: (r) => money(r.disposalAmount) },
        { header: 'Book value at disposal (EGP)', width: 16, numFmt: MONEY, value: (r) => money(r.disposalBookValue) },
      );
    }
    addSheet(wb, name, columns, rows);
    return rows.length;
  }

  private async custody(wb: ExcelJS.Workbook, name: string, caller: AssetsCaller): Promise<number> {
    const hidden = await this.confidential.hiddenFrom(caller.user);
    const records = await this.prisma.custodyRecord.findMany({
      where: hidden.length ? { employeeId: { notIn: hidden } } : {},
      select: {
        code: true,
        kind: true,
        status: true,
        purpose: true,
        outAt: true,
        dueDate: true,
        closedAt: true,
        handedOverByName: true,
        employee: { select: { employeeCode: true, fullNameEn: true } },
        _count: { select: { files: true } },
        items: {
          select: {
            valueAtOut: true,
            conditionOut: true,
            returnedAt: true,
            returnCondition: true,
            returnNotes: true,
            receivedBy: USER,
            asset: { select: { code: true, name: true } },
          },
          orderBy: { asset: { code: 'asc' } },
        },
      },
      orderBy: { outAt: 'desc' },
    });
    type Item = (typeof records)[number]['items'][number] & { record: (typeof records)[number] };
    const rows: Item[] = records.flatMap((r) => r.items.map((i) => ({ ...i, record: r })));
    const names = await userNames(this.prisma, rows.map((r) => r.receivedBy));
    const columns: Column<Item>[] = [
      { header: 'Record', width: 11, value: (r) => r.record.code },
      { header: 'Kind', width: 20, value: (r) => label(CUSTODY_KIND_LABELS as Record<CustodyKind, string>, r.record.kind) },
      { header: 'Record status', width: 14, value: (r) => label(CUSTODY_STATUS_LABELS as Record<CustodyStatus, string>, r.record.status) },
      { header: 'Employee code', width: 12, value: (r) => r.record.employee.employeeCode },
      { header: 'Employee', width: 26, value: (r) => r.record.employee.fullNameEn },
      { header: 'Purpose', width: 26, wrap: true, value: (r) => r.record.purpose },
      { header: 'Handed over by', width: 22, value: (r) => r.record.handedOverByName },
      { header: 'Out at', width: 17, value: (r) => shownAt(r.record.outAt) },
      { header: 'Return date', width: 12, value: (r) => shownDay(r.record.dueDate) },
      { header: 'Signed copy attached', width: 10, value: (r) => (r.record._count.files > 0 ? 'Yes' : 'No') },
      { header: 'Asset code', width: 14, value: (r) => r.asset.code },
      { header: 'Asset', width: 28, value: (r) => r.asset.name },
      { header: 'Condition out', width: 14, value: (r) => label(ASSET_CONDITION_LABELS as Record<AssetCondition, string>, r.conditionOut) },
      { header: 'Returned at', width: 17, value: (r) => shownAt(r.returnedAt) },
      { header: 'Came back', width: 12, value: (r) => label(RETURN_CONDITION_LABELS as Record<ReturnCondition, string>, r.returnCondition) },
      { header: 'Received by', width: 22, value: (r) => (r.receivedBy ? (names.get(r.receivedBy.id)?.name ?? r.receivedBy.email) : null) },
      { header: 'Return notes', width: 30, wrap: true, value: (r) => r.returnNotes },
    ];
    if (caller.values) columns.push({ header: 'Value when out (EGP)', width: 14, numFmt: MONEY, value: (r) => money(r.valueAtOut) });
    addSheet(wb, name, columns, rows);
    return rows.length;
  }

  private async stock(wb: ExcelJS.Workbook, name: string): Promise<number> {
    const rows = await this.prisma.assetStockMove.findMany({
      select: { at: true, delta: true, quantityAfter: true, note: true, by: USER, asset: { select: { code: true, name: true, unit: true } } },
      orderBy: [{ at: 'desc' }],
    });
    const names = await userNames(this.prisma, rows.map((r) => r.by));
    type Row = (typeof rows)[number];
    const columns: Column<Row>[] = [
      { header: 'When', width: 17, value: (r) => shownAt(r.at) },
      { header: 'Asset code', width: 14, value: (r) => r.asset.code },
      { header: 'Asset', width: 28, value: (r) => r.asset.name },
      { header: 'Change', width: 10, numFmt: '+#,##0.##;-#,##0.##;0', value: (r) => r.delta.toNumber() },
      { header: 'Quantity after', width: 12, numFmt: '#,##0.##', value: (r) => r.quantityAfter.toNumber() },
      { header: 'Unit', width: 10, value: (r) => r.asset.unit },
      { header: 'Note', width: 34, wrap: true, value: (r) => r.note },
      { header: 'By', width: 22, value: (r) => (r.by ? (names.get(r.by.id)?.name ?? r.by.email) : null) },
    ];
    addSheet(wb, name, columns, rows);
    return rows.length;
  }

  private async maintenance(wb: ExcelJS.Workbook, name: string, caller: AssetsCaller): Promise<number> {
    const rows = await this.prisma.assetMaintenance.findMany({
      select: { on: true, kind: true, event: true, vendor: true, cost: true, notes: true, createdBy: USER, asset: { select: { code: true, name: true } } },
      orderBy: [{ on: 'desc' }, { createdAt: 'desc' }],
    });
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    type Row = (typeof rows)[number];
    const columns: Column<Row>[] = [
      { header: 'Date', width: 12, value: (r) => shownDay(r.on) },
      { header: 'Asset code', width: 14, value: (r) => r.asset.code },
      { header: 'Asset', width: 28, value: (r) => r.asset.name },
      { header: 'Kind', width: 16, value: (r) => label(MAINTENANCE_KIND_LABELS as Record<MaintenanceKind, string>, r.kind) },
      { header: 'What made it', width: 20, value: (r) => label(MAINTENANCE_EVENT_LABELS as Record<MaintenanceEvent, string>, r.event) },
      { header: 'Vendor', width: 20, value: (r) => r.vendor },
      { header: 'Notes', width: 40, wrap: true, value: (r) => r.notes },
      { header: 'Recorded by', width: 22, value: (r) => (r.createdBy ? (names.get(r.createdBy.id)?.name ?? r.createdBy.email) : null) },
    ];
    if (caller.values) columns.push({ header: 'Cost (EGP)', width: 12, numFmt: MONEY, value: (r) => money(r.cost) });
    addSheet(wb, name, columns, rows);
    return rows.length;
  }

  private async counts(wb: ExcelJS.Workbook, name: string): Promise<number> {
    const rows = await this.prisma.assetCountLine.findMany({
      select: {
        result: true,
        lostMarkedAt: true,
        asset: { select: { code: true, name: true } },
        count: { select: { countedAt: true, scopeLabel: true, notes: true, countedBy: USER } },
      },
      orderBy: [{ count: { countedAt: 'desc' } }, { asset: { code: 'asc' } }],
    });
    const names = await userNames(this.prisma, rows.map((r) => r.count.countedBy));
    type Row = (typeof rows)[number];
    const columns: Column<Row>[] = [
      { header: 'Counted at', width: 17, value: (r) => shownAt(r.count.countedAt) },
      { header: 'Counted', width: 26, value: (r) => r.count.scopeLabel },
      { header: 'Counted by', width: 22, value: (r) => (r.count.countedBy ? (names.get(r.count.countedBy.id)?.name ?? r.count.countedBy.email) : null) },
      { header: 'Asset code', width: 14, value: (r) => r.asset.code },
      { header: 'Asset', width: 28, value: (r) => r.asset.name },
      { header: 'Result', width: 16, value: (r) => label(ASSET_COUNT_RESULT_LABELS as Record<AssetCountResult, string>, r.result) },
      { header: 'Marked lost on', width: 12, value: (r) => (r.lostMarkedAt ? dayInCairo(r.lostMarkedAt) : null) },
      { header: 'Count notes', width: 30, wrap: true, value: (r) => r.count.notes },
    ];
    addSheet(wb, name, columns, rows);
    return rows.length;
  }
}
