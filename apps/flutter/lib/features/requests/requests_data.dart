import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import '../../api/people_client.dart';
import '../../models/request_forms.dart';
import '../../models/requests.dart';
import '../../providers.dart';
import '../dashboard/dashboard_data.dart';

// What the Requests tab reads from People and sends to it: one's own requests of each kind, each request on its own,
// and what each form starts from (the leave types and who may cover, the month's permission hours, the work from home
// allowance, the official duty's and the compensatory day's forms, the reimbursement types, the resignation form). Every
// rule stays People's: a form shows what People answers, and People checks everything again when it is sent.

/// Where each kind lives in People's API (apps/api, under /api).
abstract final class RequestPaths {
  /// One's own, newest first.
  static String list(RequestKind kind) => switch (kind) {
    RequestKind.leave => '/api/me/leave/requests',
    RequestKind.permission => '/api/me/permissions',
    RequestKind.correction => '/api/me/attendance/corrections',
    RequestKind.wfh => '/api/me/wfh',
    RequestKind.od => '/api/me/official-duty',
    RequestKind.compensatory => '/api/me/compensatory',
    RequestKind.home => '/api/me/home-locations',
    RequestKind.claim => '/api/me/reimbursements',
    RequestKind.resignation => '/api/me/resignation',
  };

  /// One request, as its employee (and those who decide it) read it.
  static String one(RequestKind kind, String id) {
    final i = Uri.encodeComponent(id);
    return switch (kind) {
      RequestKind.leave => '/api/leave/requests/$i',
      RequestKind.permission => '/api/leave/permissions/$i',
      RequestKind.correction => '/api/attendance/corrections/$i',
      RequestKind.wfh => '/api/wfh/$i',
      RequestKind.od => '/api/official-duty/$i',
      RequestKind.compensatory => '/api/compensatory/$i',
      RequestKind.home => '/api/home-locations/$i',
      RequestKind.claim => '/api/reimbursements/$i',
      RequestKind.resignation => '/api/resignation-requests/$i',
    };
  }

  /// Where a new one is sent.
  static String create(RequestKind kind) => list(kind);

  /// Its employee's own action on it: cancel (withdraw for a check-in location or a resignation, remove for an approved
  /// check-in location).
  static String action(RequestKind kind, String id, String action) => '${list(kind)}/${Uri.encodeComponent(id)}/$action';
}

/// Whether People answered that it has no such thing (an API from before it): the part is left out, not failed.
bool isUnavailable(Object? error) => error is ApiException && error.status == 404;

/// One's own requests of a kind, newest first.
final myRequestsProvider = FutureProvider.autoDispose.family<List<PeopleRequest>, RequestKind>((ref, kind) async {
  if (kind == RequestKind.resignation) return (await ref.watch(myResignationProvider.future)).requests;
  return requestsOf<PeopleRequest>(kind, await ref.read(peopleClientProvider).get(RequestPaths.list(kind)));
});

/// One's resignation requests and the form (GET /api/me/resignation).
final myResignationProvider = FutureProvider.autoDispose<MyResignation>(
  (ref) async => MyResignation.fromJson(await ref.read(peopleClientProvider).get(RequestPaths.list(RequestKind.resignation))),
);

/// One request, read again for its page.
final oneRequestProvider = FutureProvider.autoDispose.family<PeopleRequest, (RequestKind, String)>(
  (ref, key) async => requestOf(key.$1, await ref.read(peopleClientProvider).get(RequestPaths.one(key.$1, key.$2))),
);

/// The types of leave on now (GET /api/leave/types).
final leaveTypesProvider = FutureProvider.autoDispose<List<LeaveType>>(
  (ref) async => leaveTypesOf(await ref.read(peopleClientProvider).get('/api/leave/types')),
);

/// Who is off, who must cover and who may stand in for a new leave's days: "from=…&to=…&typeId=…[&halfDay=true]".
/// None from an API from before it.
final leaveCoverageProvider = FutureProvider.autoDispose.family<LeaveFormCoverage?, String>((ref, query) async {
  try {
    return LeaveFormCoverage.fromJson(await ref.read(peopleClientProvider).get('/api/me/leave/coverage?$query'));
  } on ApiException catch (e) {
    if (isUnavailable(e)) return null;
    rethrow;
  }
});

/// A month's permission hours ("2026-10").
final permissionMonthProvider = FutureProvider.autoDispose.family<PermissionMonth, String>(
  (ref, month) async => PermissionMonth.fromJson(await ref.read(peopleClientProvider).get('/api/me/permissions/allowance?month=$month')),
);

/// The work from home allowance.
final wfhAllowanceProvider = FutureProvider.autoDispose<WfhAllowance>(
  (ref) async => WfhAllowance.fromJson(await ref.read(peopleClientProvider).get('/api/me/wfh/allowance')),
);

/// The official duty's form.
final odFormProvider = FutureProvider.autoDispose<OdForm>(
  (ref) async => OdForm.fromJson(await ref.read(peopleClientProvider).get('/api/me/official-duty/form')),
);

/// The compensatory day's form.
final compensatoryFormProvider = FutureProvider.autoDispose<CompensatoryForm>(
  (ref) async => CompensatoryForm.fromJson(await ref.read(peopleClientProvider).get('/api/me/compensatory/form')),
);

/// The reimbursement types one may claim, with their caps used in the expense's month and year (YYYY-MM-DD).
final reimbursementTypesProvider = FutureProvider.autoDispose.family<List<ReimbursementType>, String>(
  (ref, expenseDate) async => reimbursementTypesOf(await ref.read(peopleClientProvider).get('/api/me/reimbursement-types?expenseDate=$expenseDate')),
);

/// Whether the signed-in person is C-level: their requests go to the CEO where others' go to HR (their profile's).
final confidentialProvider = FutureProvider.autoDispose<bool>((ref) async => (await ref.watch(ownProfileProvider.future))?.raw['confidential'] == true);

/// After a request is sent, cancelled or withdrawn: everything that counts it is read again.
void requestsChanged(WidgetRef ref) {
  ref
    ..invalidate(myRequestsProvider)
    ..invalidate(myResignationProvider)
    ..invalidate(oneRequestProvider)
    ..invalidate(balancesProvider)
    ..invalidate(openRequestsProvider)
    ..invalidate(leaveCoverageProvider)
    ..invalidate(permissionMonthProvider)
    ..invalidate(wfhAllowanceProvider)
    ..invalidate(odFormProvider)
    ..invalidate(compensatoryFormProvider)
    ..invalidate(reimbursementTypesProvider)
    ..invalidate(attendanceMonthProvider);
}

/// Sends a request as JSON; People's answer, or its refusal as an ApiException in its words.
Future<Object?> sendJson(WidgetRef ref, String path, [Map<String, Object?>? body]) => ref.read(peopleClientProvider).post(path, body);

// ---------- photos (a leave's document, a receipt, a signed letter) ----------

/// A photo to send with a request. People reads its type from its bytes (JPEG, PNG or WebP), never from its name.
class PickedPhoto {
  const PickedPhoto({required this.name, required this.bytes});

  final String name;
  final Uint8List bytes;
}

/// Where photos come from: the camera, or the phone's photos.
abstract interface class PhotoSource {
  /// A photo, or none when the person closed the camera or the picker.
  Future<PickedPhoto?> pick({required bool camera});
}

/// The phone's camera and photos (image_picker): made a JPEG, its long side at most 2200 px, as the website shrinks them.
class DevicePhotos implements PhotoSource {
  const DevicePhotos();

  @override
  Future<PickedPhoto?> pick({required bool camera}) async {
    final x = await ImagePicker().pickImage(source: camera ? ImageSource.camera : ImageSource.gallery, imageQuality: 88, maxWidth: 2200, maxHeight: 2200);
    if (x == null) return null;
    return PickedPhoto(name: x.name, bytes: await x.readAsBytes());
  }
}

final photoSourceProvider = Provider<PhotoSource>((ref) => const DevicePhotos());

/// Sends a request with files as People's forms take them (multipart/form-data): its fields as text, each file under its
/// field's name. People's answer, or its refusal as an ApiException in its words, as the client's own calls.
Future<Object?> sendForm(WidgetRef ref, String path, Map<String, String> fields, List<(String, PickedPhoto)> files) async {
  final client = ref.read(peopleClientProvider);
  final request = http.MultipartRequest('POST', Uri.parse('${client.baseUrl}$path'))
    ..headers.addAll({'accept': 'application/json', 'user-agent': client.userAgent})
    ..fields.addAll(fields);
  final token = client.token == null ? null : await client.token!();
  final sentSession = token != null && token.isNotEmpty;
  if (sentSession) request.headers['authorization'] = 'Bearer $token';
  for (final (field, photo) in files) {
    request.files.add(http.MultipartFile.fromBytes(field, photo.bytes, filename: photo.name));
  }
  http.Response res;
  try {
    res = await http.Response.fromStream(await client.httpClient.send(request).timeout(client.timeout));
  } on TimeoutException {
    throw ApiException(0, const [PeopleClient.unreachableText]);
  } on Exception {
    throw ApiException(0, const [PeopleClient.unreachableText]);
  }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    if (res.body.isEmpty) return null;
    try {
      return jsonDecode(res.body);
    } on FormatException {
      throw ApiException(res.statusCode, const ['People sent an answer the app couldn’t read.']);
    }
  }
  if (res.statusCode == 401 && sentSession) client.onSessionEnded?.call();
  throw ApiException(res.statusCode, PeopleClient.messagesOf(res.statusCode, res.body));
}
