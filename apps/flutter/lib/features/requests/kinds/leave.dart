import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../models/leave.dart';
import '../../../models/request_forms.dart';
import '../../../models/requests.dart';
import '../../../theme/tokens.dart';
import '../../dashboard/dashboard_data.dart';
import '../request_page.dart';
import '../request_text.dart';
import '../requests_data.dart';
import '../requests_words.dart';
import '../sheet_parts.dart';

// Leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): the phone design's "New request —
// New leave" sheet (Figma 11:2077), opened by Create request. A few taps: the type (annual leave first), today as the
// first day and the last day moving with it, half a day, the days counted as the law counts them and what the balance
// keeps, the colleague who covers annual or unpaid leave of more than 2 working days, the stand-in for someone who
// decides others' requests, a reason, and a photo of a document when the type needs one. People checks everything again
// (packages/shared leaves.ts leaveRequestProblems, leave-coverage.ts) and refuses in its words. Its page: the type, the
// days, the balance after it, the cover, every step, and Cancel while People allows it.

/// Leave's words (apps/web leave/leave-forms.tsx, coverage-fields.tsx, request.ts, [id]/leave-request.tsx).
abstract final class LeaveWords {
  static const title = 'New leave';
  static String intro(bool ceo) => 'Add the request details. Your direct manager decides first, then ${ceo ? 'the CEO' : 'HR'}.';
  static const noTypes = 'No type of leave is on yet. HR sets them up: ask HR.';
  static const noEmployment = 'Leave is asked for during an employment: you have no current employment on file.';
  static const freelance = 'No leave under a freelance employment: a freelancer works outside the labour law (Art. 1(1)), so the law’s leave (Arts. 124–133) isn’t theirs.';
  static const intern = 'No leave under an unpaid internship: an intern works outside the labour law, so the law’s leave (Arts. 124–133) isn’t theirs.';

  static const type = 'Type of leave';
  static const typeHint = 'The types HR set up, each with its rules from the Labour Law.';
  static String annualAvailable(int year, String n) => 'Annual balance available in $year: $n';
  static String leftOfType(String name, String n) => 'Left of ${name.toLowerCase()} this year: $n';
  static String takenTimes(int n, int max) => 'Taken $n of $max times in service.';

  static const firstDay = 'First day';
  static const firstDayHint = 'The first day off.';
  static String noticeHint(String days) => 'This type needs $days’ notice.';
  static const lastDay = 'Last day';
  static const lastDayHint = 'It moves with the first day unless you set it.';
  static const halfDay = 'Half a day';
  static const halfDayHint = 'For one day only: make the first and last day the same.';

  static const noDays = 'No days yet: choose the first and last day.';
  static String count(String days) => '$days.';
  static String countFromAnnual(String days, String after) => '$days, from the annual balance: $after left after it, as far as is approved.';
  static const countedCalendar = 'Counted in calendar days, every day from the first to the last.';
  static const countedWorking = 'Counted in working days of the shift: rest days and official holidays aren’t counted (Labour Law Art. 124).';
  static String holidaysLeftOut(String list) => 'Holidays left out: $list.';

  static const checkingCover = 'Checking who else is off…';
  static const cover = 'Colleague who covers';
  static const chooseColleague = 'Choose a colleague';
  static const nobody = 'Nobody';
  static const coverHintRequired =
      'Leave of this type for more than 2 working days needs a colleague who covers your work, someone not off on these days. They are told, and see your handover note.';
  static const coverHint = 'A colleague not off on these days. They are told, and see your handover note.';
  static const handover = 'Handover note';
  static const handoverHint = 'What the colleague who covers should know: open tasks, files, who to call. Up to 1000 characters.';
  static const standIn = 'Stand-in while you are away';
  static String standInDefault(String name) => '$name (the default)';
  static const hr = 'HR';
  static const standInHint = 'While you are on leave, they decide the requests that wait for you (your team’s leave, permission, working from home and more), then what still waits comes back to you.';
  static const standInHintCeo = 'While you are on leave, the CEO or a Super Admin decides the requests that wait for you, then they come back to you.';
  static String overLimit(String group, String hr) => 'This would take $group past its staffing limit on some of these days: $hr will need to approve it too. You can still send it.';
  static String covering(String name, String when, bool waiting) => 'You’re covering $name on $when${waiting ? ' (waiting)' : ''}: you can still send it; HR sees it.';
  static const yourTeam = 'your team';

  static const reason = 'Reason';
  static const reasonHint = 'Your direct manager and HR read it. Up to 500 characters.';
  static const reasonPlaceholder = 'Add context for this request…';
  static const documents = 'Documents';
  static const documentsRequired = 'Documents (required for this type)';
  static const documentsHint = 'A medical certificate for sick leave, proof of sitting the exam for exam leave, or another paper the leave needs.';

  // the checks, in People's words (packages/shared leaves.ts)
  static const chooseType = 'Choose the type of leave.';
  static const lastBeforeFirst = 'The last day can’t be before the first.';
  static String noHalfDay(String name) => '$name can’t be taken as a half day.';
  static const halfDayOneDay = 'A half day is for one day: make the first and last day the same.';
  static const chooseDays = 'Choose the days of the leave.';
  static const noWorkingDays = 'These dates have no working days: rest days and official holidays aren’t counted as leave.';
  static String intoNextYear(int year) => 'A leave counted by the year can’t run into the next one: end it on 31/12/$year and request the rest separately.';
  static String notice(String name, String days, String earliest) => '$name needs $days’ notice: the first day can be $earliest at the earliest.';
  static String usableFrom(String date) => 'Annual leave can be used from $date, six months after joining.';
  static String annualLeft(String days, String? counted) => 'Only $days left of the annual balance${counted == null ? '' : ', which ${counted.toLowerCase()} is counted against'}.';
  static String typeLeft(String days, String name, String perYear) => 'Only $days left of ${name.toLowerCase()}’s $perYear a year.';
  static String atMost(String name, String max, String days) => '$name is at most $max at a time; this is $days.';
  static String needsDocument(String name) => 'Attach a document: ${name.toLowerCase()} needs one.';
  static const needsCover = 'Choose the colleague who covers your work: leave of more than 2 working days needs one.';
  static String ready(String days, String name, String hr, bool overLimit) =>
      'Ready to send: $days of ${name.toLowerCase()}, to your direct manager (without one, your lead), then $hr${overLimit ? ' (over the staffing limit)' : ''}.';

  // its page
  static const typeFact = 'Type';
  static const pay = {'paid': 'Paid', 'unpaid': 'Unpaid', 'partly': 'Partly paid'};
  static const when = 'When';
  static const days = 'Days';
  static const balanceAfter = 'Annual balance after it';
  static const balanceAfterNote = 'Available once this is taken';
  static const staffing = 'Staffing limit';
  static const overTeamLimit = 'Over its team’s limit when sent';
  static const overTeamLimitNote = 'So HR approves it too, after the manager.';
  static const coveredBy = 'Covered by';
  static const nobodyNamed = 'Nobody named';
  static const coveredNote = 'Told, and sees the handover note';
  static const standInFact = 'Stand-in';
  static const standInNote = 'Decides what waits for you during these days, once approved';
  static const documentsTitle = 'Documents';
  static const noDocument = 'No document attached.';
  static const stepCancelled = 'Cancelled, the days given back';
  static const cancelTitle = 'Cancel the leave';
  static const cancelApproved = 'Approved and not started yet: you can still cancel it, and its days go back to your balance.';
  static const cancelOpen = 'While it is being decided you can cancel it, e.g. to ask again for other days.';
  static const cancelButton = 'Cancel this leave';
  static String cancelConfirm(String type, String period) => 'Cancel your ${type.toLowerCase()} ($period)? It stays on your list, cancelled; ask again with a new request.';
  static const cancelled = 'Leave cancelled. Its days are back in the balance; it stays on the list, cancelled.';
}

/// The type's rules in a line: "Paid · Working days · The annual balance · Half days allowed" (packages/shared leaves.ts
/// leaveTypeRulesText).
String leaveTypeRulesText(LeaveType t) {
  String days(double n) => '${daysNumber(n)} ${n == 1 ? 'day' : 'days'}';
  String times(int n) => n == 1 ? 'Once' : (n == 2 ? 'Twice' : '$n times');
  String months(int n) => n % 12 == 0 ? '${n ~/ 12} ${n == 12 ? 'year' : 'years'}' : '$n ${n == 1 ? 'month' : 'months'}';
  final pay = t.paid == 'partly' ? 'Paid at ${daysNumber(t.payPercent ?? 100)}%' : (LeaveWords.pay[t.paid] ?? t.paid);
  return [
    pay,
    t.calendarDays ? 'Calendar days' : 'Working days',
    switch (t.balance) {
      'annual' => 'The annual balance',
      'from_annual' => 'From the annual balance',
      'yearly' => t.daysPerYear == null ? null : '${days(t.daysPerYear!)} a year',
      'none' => 'No balance',
      _ => null,
    },
    if (t.balance == 'from_annual' && t.daysPerYear != null) 'At most ${days(t.daysPerYear!)} a year',
    if (t.maxPerRequest != null) 'At most ${days(t.maxPerRequest!)} at a time',
    if (t.maxTimesInService != null) '${times(t.maxTimesInService!)} in service',
    if (t.minServiceMonths != null) 'After ${months(t.minServiceMonths!)} of service',
    if ((t.noticeDays ?? 0) > 0) '${days(t.noticeDays!.toDouble())}’ notice',
    if (t.documentRequired) 'Document needed',
    if (t.gender == 'female') 'Female employees',
    if (t.gender == 'male') 'Male employees',
    if (t.halfDays) 'Half days allowed',
  ].whereType<String>().join(' · ');
}

/// The days a leave takes, as the law counts them: working days of the shift that aren't official holidays, or every
/// day for a calendar-days type; half a day less for a half day (packages/shared leaves.ts leaveDaysBetween).
double leaveDaysBetween(String start, String end, {required List<int> workingDays, required Set<String> holidays, required bool calendarDays, bool halfDay = false}) {
  final span = daysBetween(start, end);
  if (span < 0 || span > 800) return 0;
  var n = 0.0;
  for (var i = 0; i <= span; i++) {
    final d = addDays(start, i);
    if (calendarDays || (workingDays.contains(weekdayIndex(d)) && !holidays.contains(d))) n++;
  }
  return halfDay && n > 0 ? n - 0.5 : n;
}

/// Whether a colleague must cover it (packages/shared leave-coverage.ts coverRequired): annual or unpaid leave of more
/// than 2 counted days.
bool coverRequiredFor(LeaveType t, double days) => (t.kind == 'annual' || t.kind == 'unpaid') && days > 2;

/// The types offered to someone: those on, for everyone or their gender, in Leave Setup's order.
List<LeaveType> offeredLeaveTypes(List<LeaveType> types, String? gender) =>
    [
      for (final t in types)
        if (t.active && (t.gender == null || gender == null || t.gender == gender)) t,
    ]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

/// Opens the New leave sheet, from the tab's [context].
Future<void> showLeaveSheet(BuildContext context) {
  final ceo = ProviderScope.containerOf(context, listen: false).read(confidentialProvider).value ?? false;
  return openRequestSheet(
    context,
    title: LeaveWords.title,
    icon: kindIcons[RequestKind.leave]!,
    intro: LeaveWords.intro(ceo),
    builder: (sheetContext, sent) => _LeaveForm(sent: sent),
  );
}

class _LeaveForm extends ConsumerStatefulWidget {
  const _LeaveForm({required this.sent});

  final SentHandler sent;

  @override
  ConsumerState<_LeaveForm> createState() => _LeaveFormState();
}

class _LeaveFormState extends ConsumerState<_LeaveForm> {
  String? _typeId;
  String? _startPicked;
  String? _endPicked;

  // the days as shown, worked out in build: as picked, else the first working day from today, one day
  String _start = todayIso();
  String _end = todayIso();
  bool _halfDay = false;
  String? _coverId;
  String _standIn = '';
  List<PickedPhoto> _documents = const [];
  final _reason = TextEditingController();
  final _handover = TextEditingController();
  bool _busy = false;
  List<String> _refusal = const [];

  @override
  void dispose() {
    _reason.dispose();
    _handover.dispose();
    super.dispose();
  }

  void _setStart(String day) {
    setState(() {
      _startPicked = day;
      // the last day stays as set unless the first passes it; else it is the first
      if (_endPicked != null && daysBetween(day, _endPicked!) < 0) _endPicked = null;
      _refusal = const [];
    });
  }

  Future<void> _send(LeaveType type, LeaveFormCoverage? coverage) async {
    setState(() {
      _busy = true;
      _refusal = const [];
    });
    try {
      final reason = _reason.text.trim();
      final handover = _handover.text.trim();
      final json = await sendForm(
        ref,
        RequestPaths.create(RequestKind.leave),
        {
          'typeId': type.id,
          'startDate': _start,
          'endDate': _end,
          'halfDay': '${_halfDay && type.halfDays}',
          if (reason.isNotEmpty) 'reason': reason,
          'coverId': ?_coverId,
          if (_coverId != null && handover.isNotEmpty) 'handoverNote': handover,
          if (coverage != null && coverage.standInNeeded && _standIn.isNotEmpty) 'standIn': _standIn,
        },
        [for (final d in _documents) ('documents', d)],
      );
      if (!mounted) return;
      requestsChanged(ref);
      final made = requestOf(RequestKind.leave, json);
      widget.sent(made, sentTextOf(made));
    } on Exception catch (e) {
      if (mounted) setState(() => _refusal = refusalOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final typesAsync = ref.watch(leaveTypesProvider);
    final profileAsync = ref.watch(ownProfileProvider);
    if (typesAsync.hasError || profileAsync.hasError) {
      return SheetState.failed(
        onRetry: () => ref
          ..invalidate(leaveTypesProvider)
          ..invalidate(ownProfileProvider),
      );
    }
    final allTypes = typesAsync.value;
    if (allTypes == null || profileAsync.isLoading) return const SheetState.loading();
    final profile = profileAsync.value;
    final employment = profile?.raw['employment'];
    if (employment is! Map) return const SheetState.refused(LeaveWords.noEmployment);
    if (employment['employmentType'] == 'freelance') return const SheetState.refused(LeaveWords.freelance);
    if (employment['employmentType'] == 'intern') return const SheetState.refused(LeaveWords.intern);
    final types = offeredLeaveTypes(allTypes, profile?.raw['gender'] is String ? profile!.raw['gender'] as String : null);
    if (types.isEmpty) return const SheetState.refused(LeaveWords.noTypes);
    final type = types.firstWhere((t) => t.id == _typeId, orElse: () => types.firstWhere((t) => t.kind == 'annual', orElse: () => types.first));

    final ceo = profile?.raw['confidential'] == true;
    final hr = RequestsWords.hrStage(ceo);
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    final today = todayIso();
    final thisYear = int.parse(today.substring(0, 4));
    final soon = {
      for (final y in {thisYear, if (today.substring(5, 7) == '12') thisYear + 1}) ...?ref.watch(holidaysProvider(y)).value?.map((h) => h.date),
    };
    _start = _startPicked ?? nextWorkingDay(today, profile!.workingDays, soon);
    _end = _endPicked != null && daysBetween(_start, _endPicked!) >= 0 ? _endPicked! : _start;
    final year = int.parse(_start.substring(0, 4));
    final balances = ref.watch(balancesProvider(year)).value;
    final years = {year, int.tryParse(_end.substring(0, 4)) ?? year};
    final holidayLists = [for (final y in years) ref.watch(holidaysProvider(y)).value];
    final holidays = {
      for (final list in holidayLists) ...?list?.map((h) => h.date),
    };
    final namedHolidays = [
      for (final list in holidayLists)
        for (final h in list ?? const [])
          if (h.date.compareTo(_start) >= 0 && h.date.compareTo(_end) <= 0 && profile!.workingDays.contains(weekdayIndex(h.date))) h,
    ];
    final halfDay = _halfDay && type.halfDays && _start == _end;
    final days = leaveDaysBetween(_start, _end, workingDays: profile!.workingDays, holidays: holidays, calendarDays: type.calendarDays, halfDay: halfDay);
    final typeBalance = balances?.types.where((b) => b.typeId == type.id).firstOrNull;

    // who covers, who stands in: People's answer for these days
    final query = 'from=$_start&to=$_end&typeId=${Uri.encodeQueryComponent(type.id)}${halfDay ? '&halfDay=true' : ''}';
    final coverageAsync = daysBetween(_start, _end) >= 0 ? ref.watch(leaveCoverageProvider(query)) : const AsyncValue<LeaveFormCoverage?>.data(null);
    final coverage = coverageAsync.value;
    final coverNeeded = coverage?.coverRequired ?? coverRequiredFor(type, days);
    final candidates = coverage?.candidates ?? const <Colleague>[];
    final coverId = candidates.any((c) => c.id == _coverId) ? _coverId : null;

    final problems = <String>[
      if (daysBetween(_start, _end) < 0) LeaveWords.lastBeforeFirst,
      if (_halfDay && !type.halfDays) LeaveWords.noHalfDay(type.nameEn),
      if (_halfDay && type.halfDays && _start != _end) LeaveWords.halfDayOneDay,
      if (daysBetween(_start, _end) >= 0 && days == 0) type.calendarDays ? LeaveWords.chooseDays : LeaveWords.noWorkingDays,
      if (type.balance != 'none' && type.balance != 'per_request' && _start.substring(0, 4) != _end.substring(0, 4)) LeaveWords.intoNextYear(year),
      if ((type.noticeDays ?? 0) > 0 && daysBetween(today, _start) < type.noticeDays!)
        LeaveWords.notice(type.nameEn, daysText(type.noticeDays!.toDouble()), dmy(addDays(today, type.noticeDays!))),
      if (type.takesFromAnnual && balances != null && balances.annual.usableFrom != null && balances.annual.usableFrom!.compareTo(_start) > 0)
        LeaveWords.usableFrom(dmy(balances.annual.usableFrom!)),
      if (type.takesFromAnnual && balances != null && days > balances.annual.available)
        LeaveWords.annualLeft(daysText(balances.annual.available < 0 ? 0 : balances.annual.available), type.balance == 'from_annual' ? type.nameEn : null),
      if (type.balance != 'annual' && typeBalance?.left != null && days > typeBalance!.left!)
        LeaveWords.typeLeft(daysText(typeBalance.left!), type.nameEn, daysText(type.daysPerYear ?? typeBalance.daysPerYear ?? 0)),
      if (type.maxPerRequest != null && days > type.maxPerRequest!) LeaveWords.atMost(type.nameEn, daysText(type.maxPerRequest!), daysText(days)),
      if (type.documentRequired && _documents.isEmpty) LeaveWords.needsDocument(type.nameEn),
      if (coverage != null && coverNeeded && coverId == null) LeaveWords.needsCover,
    ];

    final balanceLines = [
      if (balances != null && type.takesFromAnnual) LeaveWords.annualAvailable(balances.year, daysNumber(balances.annual.available)),
      if (typeBalance?.left != null && type.balance != 'annual') LeaveWords.leftOfType(type.nameEn, daysNumber(typeBalance!.left!)),
      if (type.maxTimesInService != null && typeBalance != null) LeaveWords.takenTimes(typeBalance.timesInService, type.maxTimesInService!),
    ];
    final after = balances == null || !type.takesFromAnnual ? null : balances.annual.available - days;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetField(
          label: LeaveWords.type,
          hint: leaveTypeRulesText(type),
          child: ChoicePills<LeaveType>(
            values: types,
            labelOf: (t) => t.nameEn,
            selected: type,
            onChanged: (t) => setState(() {
              _typeId = t.id;
              if (!t.halfDays) _halfDay = false;
              _refusal = const [];
            }),
          ),
        ),
        if (balanceLines.isNotEmpty) RulesNote(lines: [balanceLines.join(' · ')]),
        SheetField(
          label: LeaveWords.firstDay,
          hint: (type.noticeDays ?? 0) > 0 ? LeaveWords.noticeHint(daysText(type.noticeDays!.toDouble())) : LeaveWords.firstDayHint,
          child: PickDayField(label: LeaveWords.firstDay, value: _start, onChanged: _setStart),
        ),
        SheetField(
          label: LeaveWords.lastDay,
          hint: LeaveWords.lastDayHint,
          child: PickDayField(
            label: LeaveWords.lastDay,
            value: _end,
            first: _start,
            onChanged: (d) => setState(() {
              _endPicked = d;
              _refusal = const [];
            }),
          ),
        ),
        if (type.halfDays)
          SwitchRow(
            label: LeaveWords.halfDay,
            hint: LeaveWords.halfDayHint,
            value: halfDay,
            onChanged: _start == _end ? (v) => setState(() => _halfDay = v) : null,
          ),
        RulesNote(
          lines: [
            if (days == 0)
              LeaveWords.noDays
            else if (after != null)
              LeaveWords.countFromAnnual(daysText(days), daysNumber(after))
            else
              LeaveWords.count(daysText(days)),
            type.calendarDays ? LeaveWords.countedCalendar : LeaveWords.countedWorking,
            if (!type.calendarDays && namedHolidays.isNotEmpty) LeaveWords.holidaysLeftOut(namedHolidays.map((h) => '${h.nameEn} (${dmy(h.date)})').join(', ')),
          ],
        ),
        if (coverageAsync.isLoading) Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(LeaveWords.checkingCover, style: text.bodySmall)),
        if (coverage != null) ...[
          for (final c in coverage.covering)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(LeaveWords.covering(c.name, periodText(c.startDate, c.endDate), c.waiting), style: text.bodySmall?.copyWith(color: p.ink)),
            ),
          if (coverage.overLimit)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(LeaveWords.overLimit(coverage.group ?? LeaveWords.yourTeam, hr), style: text.bodySmall?.copyWith(color: p.ink)),
            ),
          if (coverNeeded || candidates.isNotEmpty)
            SheetField(
              label: LeaveWords.cover,
              optional: !coverNeeded,
              hint: coverNeeded ? LeaveWords.coverHintRequired : LeaveWords.coverHint,
              child: PickListField<String>(
                key: ValueKey('cover:$query'),
                label: LeaveWords.cover,
                value: coverId,
                placeholder: coverNeeded ? LeaveWords.chooseColleague : LeaveWords.nobody,
                items: [
                  if (!coverNeeded) ('', LeaveWords.nobody),
                  for (final c in candidates) (c.id, [c.name, ?c.team, ?c.department].join(' · ')),
                ],
                onChanged: (id) => setState(() => _coverId = id == null || id.isEmpty ? null : id),
              ),
            ),
          if (coverId != null)
            SheetField(
              label: LeaveWords.handover,
              optional: true,
              hint: LeaveWords.handoverHint,
              child: SheetTextBox(controller: _handover, label: LeaveWords.handover, lines: 3, max: 1000),
            ),
          if (coverage.standInNeeded)
            SheetField(
              label: LeaveWords.standIn,
              hint: coverage.cLevel ? LeaveWords.standInHintCeo : LeaveWords.standInHint,
              child: PickListField<String>(
                label: LeaveWords.standIn,
                value: _standIn,
                placeholder: LeaveWords.nobody,
                items: [
                  ('', coverage.standInDefault != null || coverage.standInDefaultHr ? LeaveWords.standInDefault(coverage.standInDefault ?? LeaveWords.hr) : LeaveWords.nobody),
                  if (coverage.standInHr && !coverage.standInDefaultHr) ('hr', LeaveWords.hr),
                  for (final o in coverage.standInOptions) (o.id, [o.name, ?o.team, ?o.department].join(' · ')),
                ],
                onChanged: (v) => setState(() => _standIn = v ?? ''),
              ),
            ),
        ],
        SheetField(
          label: LeaveWords.reason,
          optional: true,
          hint: LeaveWords.reasonHint,
          child: SheetTextBox(controller: _reason, label: LeaveWords.reason, hint: LeaveWords.reasonPlaceholder, lines: 4, max: 500),
        ),
        SheetField(
          label: type.documentRequired ? LeaveWords.documentsRequired : LeaveWords.documents,
          optional: !type.documentRequired,
          hint: LeaveWords.documentsHint,
          child: PhotosField(photos: _documents, max: 3, onChanged: (d) => setState(() => _documents = d)),
        ),
        SendChecks(problems: problems, ready: LeaveWords.ready(daysText(days), type.nameEn, hr, coverage?.overLimit ?? false)),
        PeopleRefusal(messages: _refusal),
        SheetButtons(busy: _busy, onSend: problems.isEmpty && !coverageAsync.isLoading ? () => _send(type, coverage) : null),
      ],
    );
  }
}

/// What a leave's page shows.
RequestDetail leaveDetail(LeaveRequest r) {
  final period = periodText(r.startDate, r.endDate, halfDay: r.halfDay);
  return basicDetail(
    r,
    title: r.typeName,
    facts: [
      (label: LeaveWords.typeFact, value: [r.typeName, ?r.typeNameAr].join(' · '), note: LeaveWords.pay[r.paid]),
      (label: LeaveWords.when, value: period, note: null),
      (label: LeaveWords.days, value: daysText(r.days), note: null),
      if (r.balanceAfter != null) (label: LeaveWords.balanceAfter, value: daysNumber(r.balanceAfter!), note: LeaveWords.balanceAfterNote),
      if (r.reason != null) (label: LeaveWords.reason, value: r.reason!, note: null),
    ],
    notes: [
      if (r.overStaffingLimit) '${LeaveWords.overTeamLimit}. ${LeaveWords.overTeamLimitNote}',
      if (r.cover != null) '${LeaveWords.coveredBy}: ${r.cover}. ${LeaveWords.coveredNote}.',
      if (r.standIn != null || r.standInHr) '${LeaveWords.standInFact}: ${r.standIn ?? LeaveWords.hr}. ${LeaveWords.standInNote}.',
      if (r.handoverNote != null) '${LeaveWords.handover}: “${r.handoverNote}”',
    ],
    stepText: (s) => s.kind == 'cancelled' ? LeaveWords.stepCancelled : stepTextOf(s, r.manager, r.confidential),
    files: [for (final d in r.documents) fileLineOf(d)],
    filesTitle: LeaveWords.documentsTitle,
    filesEmpty: LeaveWords.noDocument,
    actions: [
      if (r.canCancel)
        (
          title: LeaveWords.cancelTitle,
          explain: r.status == 'approved' ? LeaveWords.cancelApproved : LeaveWords.cancelOpen,
          button: LeaveWords.cancelButton,
          confirm: LeaveWords.cancelConfirm(r.typeName, period),
          path: RequestPaths.action(RequestKind.leave, r.id, 'cancel'),
          done: LeaveWords.cancelled,
        ),
    ],
  );
}

/// The annual balance's figures the card lists, as the website's annualFigures, the design's four always.
List<(String, String)> annualFigures(AnnualBalance a) => [
  (RequestsWords.entitlement, daysNumber(a.entitlement)),
  (RequestsWords.taken, daysNumber(a.taken)),
  if (a.carriedIn != 0) (RequestsWords.carriedIn, daysNumber(a.carriedIn)),
  if (a.adjustments != 0) (RequestsWords.adjusted, daysNumber(a.adjustments)),
  (RequestsWords.booked, daysNumber(a.booked)),
  (RequestsWords.waiting, daysNumber(a.pending)),
];
