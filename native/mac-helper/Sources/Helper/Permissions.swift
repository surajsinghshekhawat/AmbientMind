import AVFoundation
import AppKit
import ApplicationServices
import Contacts
import CoreGraphics
import EventKit
import Speech

/// The process macOS holds responsible for us. Permission checks and prompts
/// are attributed to it, so its Info.plist is the one that needs usage
/// strings. Launched through LaunchServices that is AmbientMind; run from a
/// terminal it is the terminal, even though AmbientMind is our parent.
enum ResponsibleApp {
  static var pid: pid_t {
    typealias Lookup = @convention(c) (pid_t) -> pid_t
    // RTLD_DEFAULT is a macro Swift does not import.
    if let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") {
      let responsible = unsafeBitCast(symbol, to: Lookup.self)(getpid())
      if responsible > 0 { return responsible }
    }
    return getppid()
  }

  static var bundle: Bundle? { bundle(of: pid) }
  static var bundleIdentifier: String? { bundle?.bundleIdentifier }
  static var parentBundleIdentifier: String? { bundle(of: getppid())?.bundleIdentifier }

  static func bundle(of pid: pid_t) -> Bundle? {
    if let url = NSRunningApplication(processIdentifier: pid)?.bundleURL { return Bundle(url: url) }
    // Not a registered app (a bare executable): use the .app around its binary.
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    let path = String(cString: buffer)
    guard let range = path.range(of: ".app/", options: .backwards) else { return nil }
    return Bundle(path: String(path[..<range.lowerBound]) + ".app")
  }

  static func hasUsageString(_ key: String) -> Bool {
    guard let text = bundle?.object(forInfoDictionaryKey: key) as? String else { return false }
    return !text.isEmpty
  }
}

enum Permissions {
  static let kinds = ["microphone", "speech", "accessibility", "screen", "calendar", "reminders", "contacts"]

  /// Asking without these makes macOS terminate the process instead of prompting.
  static let usageKeys: [String: String] = [
    "microphone": "NSMicrophoneUsageDescription",
    "speech": "NSSpeechRecognitionUsageDescription",
    "calendar": "NSCalendarsFullAccessUsageDescription",
    "reminders": "NSRemindersFullAccessUsageDescription",
    "contacts": "NSContactsUsageDescription",
  ]

  private static var eventStore: EKEventStore { Store.shared }

  /// Same words as Electron's getMediaAccessStatus. Accessibility and Screen
  /// Recording cannot tell "never asked" from "refused", so both say denied.
  static func status(_ kind: String) -> String {
    switch kind {
    case "microphone":
      return av(AVCaptureDevice.authorizationStatus(for: .audio))
    case "speech":
      switch SFSpeechRecognizer.authorizationStatus() {
      case .authorized: return "granted"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "not-determined"
      @unknown default: return "unknown"
      }
    case "accessibility":
      return AXIsProcessTrusted() ? "granted" : "denied"
    case "screen":
      return CGPreflightScreenCaptureAccess() ? "granted" : "denied"
    case "calendar":
      return ek(EKEventStore.authorizationStatus(for: .event))
    case "reminders":
      return ek(EKEventStore.authorizationStatus(for: .reminder))
    case "contacts":
      switch CNContactStore.authorizationStatus(for: .contacts) {
      case .authorized: return "granted"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "not-determined"
      @unknown default: return "granted"
      }
    default:
      return "unknown"
    }
  }

  static func request(_ kind: String, _ reply: @escaping Reply) {
    if let key = usageKeys[kind], !ResponsibleApp.hasUsageString(key) {
      return reply(.failure(HelperError(
        "missing_usage_description",
        "\(ResponsibleApp.bundleIdentifier ?? "The app") has no \(key) in its Info.plist, so macOS would end the helper instead of asking."
      )))
    }
    let done = { reply(.success(["kind": kind, "status": status(kind)])) }
    switch kind {
    case "microphone":
      AVCaptureDevice.requestAccess(for: .audio) { _ in done() }
    case "speech":
      SFSpeechRecognizer.requestAuthorization { _ in done() }
    case "accessibility":
      // Opens the System Settings prompt; the answer arrives later.
      let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
      _ = AXIsProcessTrustedWithOptions(options)
      done()
    case "screen":
      _ = CGRequestScreenCaptureAccess()
      done()
    case "calendar":
      eventStore.requestFullAccessToEvents { _, _ in done() }
    case "reminders":
      eventStore.requestFullAccessToReminders { _, _ in done() }
    case "contacts":
      CNContactStore().requestAccess(for: .contacts) { _, _ in done() }
    default:
      reply(.failure(HelperError("bad_request", "Unknown permission \(kind)")))
    }
  }

  private static func av(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "unknown"
    }
  }

  private static func ek(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .fullAccess: return "granted"
    // Write-only cannot read anything, which is all AmbientMind would do first.
    case .writeOnly, .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "unknown"
    }
  }
}
