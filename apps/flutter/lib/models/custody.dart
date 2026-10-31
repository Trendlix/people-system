// The employee's own custody (owner, 31 October 2026: "show the employee assets, the ones he received from the company";
// "every employee sees his assets"): GET /api/me/custody (packages/shared custody.ts `MyCustodyView`), read only and
// never a value. What they hold now (each item with its record, since when, its return date or long term, its condition
// when it went out and what went with it) and their custody records with their signed forms.

/// A record's kind (custody.ts CUSTODY_KIND_LABELS).
const custodyKindLabels = {'shoot': 'Shoot', 'assignment': 'Long-term assignment'};

/// A record's state (custody.ts CUSTODY_STATUS_LABELS).
const custodyStatusLabels = {'open': 'Out', 'partial': 'Partly returned', 'closed': 'Closed'};

/// An asset's condition when it went out (assets.ts ASSET_CONDITION_LABELS).
const assetConditionLabels = {'new': 'New', 'excellent': 'Excellent', 'good': 'Good', 'used': 'Used', 'needs_repair': 'Needs repair'};

/// An asset's group (assets.ts ASSET_GROUP_RULES' labels).
const assetGroupLabels = {
  'studio': 'Studio installed',
  'kit': 'Production kit',
  'it': 'IT and devices',
  'office': 'Office furniture and equipment',
  'consumable': 'Consumables and stock',
};

/// An asset's type (assets.ts ASSET_TYPES' labels); a code not listed is shown as it is.
const assetTypeLabels = {
  'CAM': 'Camera',
  'LEN': 'Lens',
  'LGT': 'Lighting',
  'GRP': 'Stands and grip',
  'AUD': 'Audio',
  'MON': 'Monitor',
  'GMB': 'Gimbal',
  'DRN': 'Drone',
  'ACC': 'Accessory',
  'BAT': 'Batteries',
  'BKD': 'Backdrop system',
  'RIG': 'Rigging',
  'PWR': 'Power distribution',
  'LAP': 'Laptop',
  'WKS': 'Workstation',
  'PHN': 'Phone',
  'TAB': 'Tablet',
  'DRV': 'Storage drive',
  'NET': 'Network',
  'DSK': 'Desk',
  'CHR': 'Chair',
  'CAB': 'Cabinet',
  'PRN': 'Printer',
  'AC': 'Air conditioner',
  'APL': 'Appliance',
  'VEH': 'Vehicle',
  'GEL': 'Gels',
  'TAP': 'Tape',
  'PAP': 'Backdrop paper',
  'SUP': 'Supplies',
  'OTH': 'Other',
};

String? _text(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
bool _bool(Object? v) => v == true;
Map _map(Object? v) => v is Map ? v : const {};
List _list(Object? v) => v is List ? v : const [];

/// A line of an item's accessories checklist that went out with it (asset-accessories.ts AccessoryOut).
class AccessoryOut {
  const AccessoryOut({required this.name, required this.quantity, this.serial});

  static AccessoryOut? fromJson(Object? json) {
    final m = _map(json);
    final name = _text(m['name']);
    return name == null ? null : AccessoryOut(name: name, quantity: m['quantity'] is num ? (m['quantity'] as num).toInt() : 1, serial: _text(m['serial']));
  }

  final String name;
  final int quantity;
  final String? serial;

  /// "Charger", "Battery × 2", "Battery (S/N B-12)".
  String get text => [name, if (quantity > 1) '× $quantity', if (serial != null) '(S/N $serial)'].join(' ');
}

/// An asset they hold now (custody.ts HeldItemView), with the record it went out on.
class HeldAsset {
  const HeldAsset({
    required this.itemId,
    required this.code,
    required this.name,
    required this.group,
    required this.type,
    this.brand,
    this.model,
    this.serial,
    required this.custodyCode,
    required this.kind,
    this.dueDate,
    this.since,
    required this.overdue,
    required this.daysOverdue,
    this.conditionOut,
    this.accessories,
    this.accessoriesOut = const [],
  });

  static HeldAsset? fromJson(Object? json) {
    final m = _map(json);
    final asset = _map(m['asset']);
    final custody = _map(m['custody']);
    final code = _text(asset['code']);
    if (code == null) return null;
    return HeldAsset(
      itemId: '${m['itemId'] ?? code}',
      code: code,
      name: _text(asset['name']) ?? code,
      group: '${asset['group'] ?? ''}',
      type: '${asset['type'] ?? ''}',
      brand: _text(asset['brand']),
      model: _text(asset['model']),
      serial: _text(asset['serial']),
      custodyCode: '${custody['code'] ?? ''}',
      kind: '${custody['kind'] ?? 'assignment'}',
      dueDate: _text(custody['dueDate']),
      since: DateTime.tryParse('${m['since'] ?? ''}'),
      overdue: _bool(m['overdue']),
      daysOverdue: _int(m['daysOverdue']),
      conditionOut: _text(m['conditionOut']),
      accessories: _text(m['accessories']),
      accessoriesOut: [for (final a in _list(m['accessoriesOut'])) ?AccessoryOut.fromJson(a)],
    );
  }

  final String itemId;
  final String code;
  final String name;

  /// assets.ts AssetGroup: studio, kit, it, office, consumable.
  final String group;

  /// assets.ts AssetType: CAM, LAP, PHN…
  final String type;
  final String? brand;
  final String? model;
  final String? serial;
  final String custodyCode;

  /// shoot (back by its return date) or assignment (long term, back at clearance).
  final String kind;

  /// YYYY-MM-DD, a shoot's only.
  final String? dueDate;

  /// When it was handed over.
  final DateTime? since;
  final bool overdue;
  final int daysOverdue;
  final String? conditionOut;

  /// What went with it, as written (before the checklist).
  final String? accessories;

  /// The checklist's lines that went out with it.
  final List<AccessoryOut> accessoriesOut;

  String get typeLabel => assetTypeLabels[type] ?? type;
  String? get groupLabel => assetGroupLabels[group];
  String? get conditionLabel => conditionOut == null ? null : assetConditionLabels[conditionOut] ?? conditionOut;

  /// "Sony · FX6", "Dell"; null without either.
  String? get makeAndModel {
    final parts = [?brand, ?model];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  /// What went with it, in words: the checklist's lines, else what was written; null: nothing.
  String? get withIt => accessoriesOut.isNotEmpty ? accessoriesOut.map((a) => a.text).join(', ') : accessories;
}

/// A signed form kept on a record (custody.ts CustodyFileRef).
class CustodyFile {
  const CustodyFile({required this.id, required this.fileName, required this.sizeBytes});

  static CustodyFile? fromJson(Object? json) {
    final m = _map(json);
    final id = _text(m['id']);
    return id == null ? null : CustodyFile(id: id, fileName: _text(m['fileName']) ?? 'Signed form', sizeBytes: _int(m['sizeBytes']));
  }

  final String id;
  final String fileName;
  final int sizeBytes;
}

/// One of their custody records (custody.ts CustodyRowView with its files).
class CustodyRecord {
  const CustodyRecord({
    required this.id,
    required this.code,
    required this.kind,
    required this.status,
    this.purpose,
    this.dueDate,
    this.outAt,
    this.closedAt,
    required this.items,
    required this.out,
    required this.signed,
    required this.overdue,
    required this.daysOverdue,
    this.files = const [],
  });

  static CustodyRecord? fromJson(Object? json) {
    final m = _map(json);
    final code = _text(m['code']);
    if (code == null) return null;
    return CustodyRecord(
      id: '${m['id'] ?? code}',
      code: code,
      kind: '${m['kind'] ?? 'assignment'}',
      status: '${m['status'] ?? 'open'}',
      purpose: _text(m['purpose']),
      dueDate: _text(m['dueDate']),
      outAt: DateTime.tryParse('${m['outAt'] ?? ''}'),
      closedAt: DateTime.tryParse('${m['closedAt'] ?? ''}'),
      items: _int(m['items']),
      out: _int(m['out']),
      signed: _bool(m['signed']),
      overdue: _bool(m['overdue']),
      daysOverdue: _int(m['daysOverdue']),
      files: [for (final f in _list(m['files'])) ?CustodyFile.fromJson(f)],
    );
  }

  final String id;
  final String code;
  final String kind;

  /// open, partial or closed.
  final String status;
  final String? purpose;
  final String? dueDate;
  final DateTime? outAt;
  final DateTime? closedAt;

  /// How many items went out on it, and how many are still out.
  final int items;
  final int out;
  final bool signed;
  final bool overdue;
  final int daysOverdue;
  final List<CustodyFile> files;

  String get kindLabel => custodyKindLabels[kind] ?? kind;
  String get statusLabel => custodyStatusLabels[status] ?? status;
}

/// GET /api/me/custody: what they hold, their records, how many items are past their return date.
class MyCustody {
  const MyCustody({this.current = const [], this.records = const [], this.overdue = 0});

  factory MyCustody.fromJson(Object? json) {
    final m = _map(json);
    return MyCustody(
      current: [for (final h in _list(m['current'])) ?HeldAsset.fromJson(h)],
      records: [for (final r in _list(m['records'])) ?CustodyRecord.fromJson(r)],
      overdue: _int(m['overdue']),
    );
  }

  final List<HeldAsset> current;
  final List<CustodyRecord> records;
  final int overdue;
}
