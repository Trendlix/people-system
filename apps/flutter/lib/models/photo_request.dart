// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"), as their profile lists it (GET /api/employees/:id `photoRequests`, apps/web lib/types.ts
// `PhotoRequest`): HR approves it, and it becomes the picture beside their name, or rejects it with a note or none; they
// may cancel it while it waits. The photo itself: GET /api/photo-requests/:id/photo.

String? _str(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;

class PhotoRequest {
  const PhotoRequest({required this.id, required this.status, required this.note, required this.requestedAt, required this.decidedAt, required this.decisionNote});

  static PhotoRequest? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = _str(json['id']);
    if (id == null) return null;
    return PhotoRequest(
      id: id,
      status: _str(json['status']) ?? 'pending',
      note: _str(json['note']),
      requestedAt: DateTime.tryParse('${json['requestedAt']}'),
      decidedAt: DateTime.tryParse('${json['decidedAt']}'),
      decisionNote: _str(json['decisionNote']),
    );
  }

  final String id;

  /// pending, approved, rejected or cancelled.
  final String status;
  final String? note;
  final DateTime? requestedAt;
  final DateTime? decidedAt;
  final String? decisionNote;

  bool get pending => status == 'pending';
}

/// The profile's photo requests: the one waiting first, then the latest ones (People's order).
List<PhotoRequest> photoRequestsOf(Object? json) => [
  if (json is List)
    for (final r in json) ?PhotoRequest.fromJson(r),
];
