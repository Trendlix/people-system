import CoreLocation
import Flutter
import Security
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Set up at every launch, also when iOS starts the app in the background for a location event, so the event is
    // handled even when Flutter never runs.
    AwayWatch.shared.launched()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "AwayWatchPlugin") {
      AwayWatchPlugin.register(with: registrar)
    }
  }
}

// Location while checked in, on an iPhone (owner, 7 November 2026: "yes" to "location when leaving the check-in area").
// iOS can't wake an app every hour as Android's task does, so iOS's own events are used: an area around the spot of the
// check-in, which wakes the app when the phone leaves it, and the significant location changes (about 500 m) as a
// fallback. Each wake sends one ping to People (POST /api/me/attendance/pings), as Android's task does, with the session
// kept in the Keychain. Neither needs the "location" background mode; both need "Always". Dart starts it after a
// check-in and stops it at check-out and sign-out; People's 401, 403 or 409 stops it too.

/// The `people/away_watch` channel: start, stop, watching, authorization, requestAlways.
final class AwayWatchPlugin: NSObject, FlutterPlugin {
  static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "people/away_watch", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(AwayWatchPlugin(), channel: channel)
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let watch = AwayWatch.shared
    switch call.method {
    case "start":
      let args = call.arguments as? [String: Any] ?? [:]
      let number = { (key: String) -> Double? in (args[key] as? NSNumber)?.doubleValue }
      let text = { (key: String) -> String? in
        guard let s = args[key] as? String, !s.isEmpty else { return nil }
        return s
      }
      guard let latitude = number("latitude"), let longitude = number("longitude"), let radius = number("radius"),
        let apiUrl = text("apiUrl"), let token = text("token"), let userAgent = text("userAgent")
      else {
        result(FlutterError(code: "bad_args", message: "start needs latitude, longitude, radius, apiUrl, token and userAgent.", details: nil))
        return
      }
      let session = AwayWatchSession(apiUrl: apiUrl, token: token, userAgent: userAgent, caPem: text("caPem"))
      if let problem = watch.start(latitude: latitude, longitude: longitude, radius: radius, session: session) {
        result(FlutterError(code: "not_started", message: problem, details: nil))
      } else {
        result(nil)
      }
    case "stop":
      watch.stop()
      result(nil)
    case "watching":
      result(watch.watching)
    case "authorization":
      result(watch.authorization)
    case "requestAlways":
      watch.requestAlways { result($0) }
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}

/// What a ping is sent with: People's address, the session, the app's user agent and People's private root (PEM, or
/// none for the phone's own authorities), as the Dart client sends them.
struct AwayWatchSession: Codable {
  let apiUrl: String
  let token: String
  let userAgent: String
  let caPem: String?
}

/// The session in the Keychain. Readable after the phone's first unlock, as a region can wake the app while the phone
/// is locked; never in a backup or on another phone.
enum AwayWatchKeychain {
  enum Read {
    case found(AwayWatchSession)
    case none
    /// Not readable now (before the first unlock after a restart): tried again at the next wake.
    case unavailable
  }

  private static let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "people.awayWatch",
    kSecAttrAccount as String: "session",
  ]

  static func save(_ session: AwayWatchSession) -> Bool {
    guard let data = try? JSONEncoder().encode(session) else { return false }
    delete()
    var query = base
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    query[kSecValueData as String] = data
    return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
  }

  static func read() -> Read {
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    if status == errSecItemNotFound { return .none }
    guard status == errSecSuccess, let data = out as? Data else { return .unavailable }
    guard let session = try? JSONDecoder().decode(AwayWatchSession.self, from: data) else { return .none }
    return .found(session)
  }

  static func delete() {
    SecItemDelete(base as CFDictionary)
  }
}

/// The check-in's area and when the watch started, and when the last ping was sent (UserDefaults).
struct AwayWatchArea {
  let latitude: Double
  let longitude: Double
  let radius: Double
  let startedAt: Date

  private static let key = "people.awayWatch.area"
  private static let lastPingKey = "people.awayWatch.lastPingAt"

  static var stored: AwayWatchArea? {
    guard let d = UserDefaults.standard.dictionary(forKey: key),
      let latitude = (d["latitude"] as? NSNumber)?.doubleValue, let longitude = (d["longitude"] as? NSNumber)?.doubleValue,
      let radius = (d["radius"] as? NSNumber)?.doubleValue, let startedAt = (d["startedAt"] as? NSNumber)?.doubleValue
    else { return nil }
    return AwayWatchArea(latitude: latitude, longitude: longitude, radius: radius, startedAt: Date(timeIntervalSince1970: startedAt))
  }

  func store() {
    UserDefaults.standard.set(
      ["latitude": latitude, "longitude": longitude, "radius": radius, "startedAt": startedAt.timeIntervalSince1970], forKey: Self.key)
  }

  static func forget() {
    UserDefaults.standard.removeObject(forKey: key)
  }

  static var lastPingAt: Date? {
    get {
      let t = UserDefaults.standard.double(forKey: lastPingKey)
      return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }
    set { UserDefaults.standard.set(newValue?.timeIntervalSince1970 ?? 0, forKey: lastPingKey) }
  }

  var center: CLLocation { CLLocation(latitude: latitude, longitude: longitude) }
}

/// Trusts People's private root and nothing else when one is given (as secure_http.dart does), with the usual check of
/// the host's name; the phone's own authorities otherwise.
final class AwayWatchTrust: NSObject, URLSessionDelegate {
  private let anchors: [SecCertificate]?

  init(caPem: String?) {
    anchors = caPem.map(AwayWatchTrust.certificates)
  }

  func urlSession(
    _ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust, let anchors = anchors
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    // a root given but not readable: nothing is trusted, as the Dart client can't be made then either
    guard !anchors.isEmpty else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, challenge.protectionSpace.host as CFString))
    SecTrustSetAnchorCertificates(trust, anchors as CFArray)
    SecTrustSetAnchorCertificatesOnly(trust, true)
    var error: CFError?
    if SecTrustEvaluateWithError(trust, &error) {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  /// The certificates in a PEM text.
  static func certificates(_ pem: String) -> [SecCertificate] {
    let begin = "-----BEGIN CERTIFICATE-----"
    let end = "-----END CERTIFICATE-----"
    var found: [SecCertificate] = []
    var rest = Substring(pem)
    while let b = rest.range(of: begin), let e = rest.range(of: end, range: b.upperBound..<rest.endIndex) {
      let base64 = String(rest[b.upperBound..<e.lowerBound].filter { !$0.isWhitespace })
      if let der = Data(base64Encoded: base64), let cert = SecCertificateCreateWithData(nil, der as CFData) {
        found.append(cert)
      }
      rest = rest[e.upperBound...]
    }
    return found
  }
}

/// The watch itself: the region, the significant changes, and the ping each wake sends. All on the main thread.
final class AwayWatch: NSObject, CLLocationManagerDelegate {
  static let shared = AwayWatch()

  static let regionId = "people.checkin"
  /// People keeps no ping sooner than this after the last (PING_MIN_GAP_MINUTES).
  static let minGap: TimeInterval = 20 * 60
  /// How long a region exit waits for a reading; none by then: nothing is sent.
  static let fixWait: TimeInterval = 20
  /// A significant change older than this is an old reading iOS kept, not where the phone is.
  static let oldReading: TimeInterval = 15 * 60

  private let manager = CLLocationManager()
  private var significantOn = false
  private var knownStatus: CLAuthorizationStatus = .notDetermined

  // the wake being handled: one at a time
  private var sending = false
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var inFlight: URLSessionDataTask?
  private var fix: ((CLLocation?) -> Void)?
  private var fixTimer: Timer?

  // a requestAlways waiting for iOS's answer
  private var asking: [(String) -> Void] = []
  private var askingFrom: CLAuthorizationStatus = .notDetermined
  private var promptShown = false
  private var askTimers: [Timer] = []
  private var askObservers: [NSObjectProtocol] = []

  private let sessionQueue: OperationQueue = {
    let q = OperationQueue()
    q.maxConcurrentOperationCount = 1
    return q
  }()

  private override init() {
    super.init()
    knownStatus = manager.authorizationStatus
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
  }

  // MARK: The channel

  /// At launch: carries on a watch that is set up (iOS wants the significant changes started again after a relaunch);
  /// a session left in the Keychain by an earlier install (UserDefaults go with the app, the Keychain doesn't) is deleted.
  func launched() {
    switch AwayWatchKeychain.read() {
    case .found:
      if AwayWatchArea.stored == nil { stop() } else { arm() }
    case .none:
      if AwayWatchArea.stored != nil { stop() }
    case .unavailable:
      if AwayWatchArea.stored != nil { arm() }
    }
  }

  /// Replaces any earlier watch; nil when started, else why not.
  func start(latitude: Double, longitude: Double, radius: Double, session: AwayWatchSession) -> String? {
    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    guard CLLocationCoordinate2DIsValid(center), radius > 0 else { return "The check-in's place isn't a valid one." }
    guard AwayWatchKeychain.save(session) else { return "The session couldn't be kept on this phone." }
    AwayWatchArea(latitude: latitude, longitude: longitude, radius: radius, startedAt: Date()).store()
    startRegion(center: center, radius: radius)
    startSignificant()
    return nil
  }

  /// Stops both and deletes the session; nothing running is fine.
  func stop() {
    for region in manager.monitoredRegions where region.identifier == Self.regionId {
      manager.stopMonitoring(for: region)
    }
    manager.stopMonitoringSignificantLocationChanges()
    significantOn = false
    AwayWatchKeychain.delete()
    AwayWatchArea.forget()
    if fix != nil {
      manager.stopUpdatingLocation()
      finishFix(nil)
    }
  }

  /// Whether a watch is set up: the session kept and the area being watched.
  var watching: Bool {
    guard case .found = AwayWatchKeychain.read() else { return false }
    return AwayWatchArea.stored != nil
  }

  var authorization: String { Self.name(manager.authorizationStatus) }

  static func name(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "whenInUse"
    case .notDetermined: return "notDetermined"
    case .denied, .restricted: return "denied"
    @unknown default: return "denied"
    }
  }

  /// Asks iOS for "Always" and answers once iOS has: when the authorization changes, or when the app is active again
  /// after iOS's prompt. iOS shows its prompt at most once; when nothing shows within 10 seconds, the authorization as
  /// it is. Each caller is answered exactly once.
  func requestAlways(_ done: @escaping (String) -> Void) {
    let now = manager.authorizationStatus
    if now == .authorizedAlways || now == .denied || now == .restricted {
      done(Self.name(now))
      return
    }
    asking.append(done)
    if asking.count > 1 { return }
    askingFrom = now
    promptShown = false
    let center = NotificationCenter.default
    askObservers = [
      center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.promptShown = true
      },
      center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self = self, self.promptShown else { return }
        // a moment for iOS's answer to reach the authorization
        self.askTimers.append(Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in self?.answerAsking() })
      },
    ]
    askTimers = [
      Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
        guard let self = self, !self.promptShown else { return }
        self.answerAsking()
      },
      // a prompt left open: answered anyway
      Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [weak self] _ in self?.answerAsking() },
    ]
    manager.requestAlwaysAuthorization()
  }

  private func answerAsking() {
    guard !asking.isEmpty else { return }
    let waiting = asking
    asking = []
    askTimers.forEach { $0.invalidate() }
    askTimers = []
    askObservers.forEach { NotificationCenter.default.removeObserver($0) }
    askObservers = []
    let answer = authorization
    waiting.forEach { $0(answer) }
  }

  // MARK: Location events

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let now = manager.authorizationStatus
    let before = knownStatus
    knownStatus = now
    if !asking.isEmpty, now != askingFrom, now != .notDetermined { answerAsking() }
    // "Always" given after the watch started: the area is watched again from now
    if now == .authorizedAlways, before != .authorizedAlways, AwayWatchArea.stored != nil { arm(restartRegion: true) }
  }

  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    guard region.identifier == Self.regionId else { return }
    wake(moved: nil)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let last = locations.last else { return }
    if fix != nil {
      finishFix(last)
    } else {
      wake(moved: last)
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    if fix != nil { finishFix(nil) }
  }

  func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
    NSLog("People away watch: the area couldn't be watched (%@)", error.localizedDescription)
  }

  // MARK: The ping

  /// One wake: a region exit (moved nil, a reading is asked for) or a significant change (its reading).
  private func wake(moved: CLLocation?) {
    let session: AwayWatchSession
    switch AwayWatchKeychain.read() {
    case .none:
      stop()
      return
    case .unavailable:
      return
    case .found(let s):
      session = s
    }
    if sending { return }
    if let last = AwayWatchArea.lastPingAt, Date().timeIntervalSince(last) < Self.minGap { return }
    if let reading = moved, !worthSending(reading) { return }
    sending = true
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "people.awayWatch") { [weak self] in
      self?.expired()
    }
    body(moved: moved) { [weak self] body in
      guard let self = self else { return }
      guard let body = body else {
        self.finishWake()
        return
      }
      self.post(body, session) { status in
        if let status = status {
          if (200..<300).contains(status) { AwayWatchArea.lastPingAt = Date() }
          // the session ended, it's switched off, or they aren't checked in any more
          if status == 401 || status == 403 || status == 409 { self.stop() }
        }
        self.finishWake()
      }
    }
  }

  /// A significant change is sent when it is new and outside the check-in's area: the one iOS gives as soon as it
  /// starts (at the check-in, at each launch) would take the 20 minutes a region exit then needs.
  private func worthSending(_ reading: CLLocation) -> Bool {
    guard reading.horizontalAccuracy >= 0, Date().timeIntervalSince(reading.timestamp) < Self.oldReading else { return false }
    guard let area = AwayWatchArea.stored else { return true }
    if reading.timestamp < area.startedAt { return false }
    return reading.distance(from: area.center) - reading.horizontalAccuracy > area.radius
  }

  /// What to send: the reading, or why there is none; nil: nothing this time (no reading in time).
  private func body(moved: CLLocation?, _ done: @escaping ([String: Any]?) -> Void) {
    // asked off the main thread, as iOS wants
    DispatchQueue.global(qos: .utility).async {
      let serviceOn = CLLocationManager.locationServicesEnabled()
      DispatchQueue.main.async {
        if !serviceOn {
          done(["off": "service"])
        } else if self.manager.authorizationStatus != .authorizedAlways {
          done(["off": "permission"])
        } else if let reading = moved {
          done(Self.point(reading))
        } else {
          self.requestFix { reading in done(reading.flatMap(Self.point)) }
        }
      }
    }
  }

  private static func point(_ reading: CLLocation) -> [String: Any]? {
    guard reading.horizontalAccuracy >= 0 else { return nil }
    return [
      "latitude": reading.coordinate.latitude,
      "longitude": reading.coordinate.longitude,
      "accuracy": reading.horizontalAccuracy,
      "mock": reading.sourceInformation?.isSimulatedBySoftware ?? false,
    ]
  }

  private func requestFix(_ done: @escaping (CLLocation?) -> Void) {
    fix = done
    fixTimer = Timer.scheduledTimer(withTimeInterval: Self.fixWait, repeats: false) { [weak self] _ in
      guard let self = self, self.fix != nil else { return }
      self.manager.stopUpdatingLocation()
      self.finishFix(nil)
    }
    manager.requestLocation()
  }

  private func finishFix(_ reading: CLLocation?) {
    fixTimer?.invalidate()
    fixTimer = nil
    guard let done = fix else { return }
    fix = nil
    done(reading)
  }

  /// POST /api/me/attendance/pings with the headers the Dart client sends; the answer's status, nil when none came.
  private func post(_ body: [String: Any], _ session: AwayWatchSession, _ done: @escaping (Int?) -> Void) {
    guard let url = URL(string: session.apiUrl + "/api/me/attendance/pings"),
      let data = try? JSONSerialization.data(withJSONObject: body)
    else {
      done(nil)
      return
    }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue(session.userAgent, forHTTPHeaderField: "User-Agent")
    request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = data
    let urlSession = URLSession(configuration: .ephemeral, delegate: AwayWatchTrust(caPem: session.caPem), delegateQueue: sessionQueue)
    let task = urlSession.dataTask(with: request) { _, response, _ in
      let status = (response as? HTTPURLResponse)?.statusCode
      DispatchQueue.main.async {
        self.inFlight = nil
        if let status = status { NSLog("People away watch: ping answered %d", status) }
        done(status)
      }
    }
    inFlight = task
    task.resume()
    urlSession.finishTasksAndInvalidate()
  }

  private func finishWake() {
    sending = false
    endBackgroundTask()
  }

  /// iOS's time in the background is up: what is under way is given up; the next wake tries again.
  private func expired() {
    inFlight?.cancel()
    if fix != nil {
      manager.stopUpdatingLocation()
      finishFix(nil)
    }
    endBackgroundTask()
  }

  private func endBackgroundTask() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }

  // MARK: Starting

  /// The region and the significant changes, as set up (at launch, and when "Always" comes later).
  private func arm(restartRegion: Bool = false) {
    if let area = AwayWatchArea.stored,
      restartRegion || !manager.monitoredRegions.contains(where: { $0.identifier == Self.regionId }) {
      startRegion(center: CLLocationCoordinate2D(latitude: area.latitude, longitude: area.longitude), radius: area.radius)
    }
    startSignificant()
  }

  private func startRegion(center: CLLocationCoordinate2D, radius: Double) {
    guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
    let region = CLCircularRegion(
      center: center, radius: min(max(radius, 100), manager.maximumRegionMonitoringDistance), identifier: Self.regionId)
    region.notifyOnEntry = false
    region.notifyOnExit = true
    // the same identifier replaces an earlier check-in's area
    manager.startMonitoring(for: region)
  }

  private func startSignificant() {
    guard !significantOn, CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
    manager.startMonitoringSignificantLocationChanges()
    significantOn = true
  }
}
