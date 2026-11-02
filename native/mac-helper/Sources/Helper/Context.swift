import AppKit
import ApplicationServices

/// Remembers which apps were in front, most recent first. When Quick Capture
/// takes focus, AmbientMind itself is frontmost; the window worth reading is
/// the one that was in front just before.
final class Activation {
  static let shared = Activation()
  private let lock = NSLock()
  private var history: [NSRunningApplication] = []

  func start() {
    if let app = NSWorkspace.shared.frontmostApplication { remember(app) }
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
        self?.remember(app)
      }
    }
  }

  private func remember(_ app: NSRunningApplication) {
    lock.lock()
    defer { lock.unlock() }
    history.removeAll { $0.processIdentifier == app.processIdentifier }
    history.insert(app, at: 0)
    if history.count > 12 { history.removeLast() }
  }

  func frontmost(excluding pids: Set<pid_t>) -> NSRunningApplication? {
    if let current = NSWorkspace.shared.frontmostApplication, !pids.contains(current.processIdentifier) {
      return current
    }
    lock.lock()
    defer { lock.unlock() }
    return history.first { !pids.contains($0.processIdentifier) && !$0.isTerminated }
  }
}

enum AX {
  static func value(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success ? value : nil
  }

  static func string(_ element: AXUIElement, _ attribute: String) -> String? {
    guard let text = value(element, attribute) as? String else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  static func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    guard let raw = value(element, attribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    return (raw as! AXUIElement)
  }

  static func children(_ element: AXUIElement) -> [AXUIElement] {
    (value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
  }

  static func url(_ element: AXUIElement, _ attribute: String) -> String? {
    if let url = value(element, attribute) as? URL { return url.absoluteString }
    return string(element, attribute)
  }
}

/// Visible text from the focused window, read the way VoiceOver would: cheap,
/// exact, and with no pixels involved.
struct TextWalk {
  static let readable: Set<String> = ["AXStaticText", "AXTextArea", "AXTextField", "AXHeading", "AXCell"]
  /// Chrome around the content, not the content.
  static let skipped: Set<String> = ["AXMenuBar", "AXMenu", "AXToolbar", "AXScrollBar", "AXTabGroup"]

  let deadline: Date
  let maxChars: Int
  var lines: [String] = []
  var chars = 0
  var visited = 0
  var webURL: String?

  init(maxChars: Int, seconds: Double) {
    self.maxChars = maxChars
    deadline = Date().addingTimeInterval(seconds)
  }

  mutating func walk(_ element: AXUIElement, depth: Int = 0) {
    if depth > 60 || visited > 6000 || chars >= maxChars || Date() > deadline { return }
    visited += 1
    let role = AX.string(element, kAXRoleAttribute) ?? ""
    if TextWalk.skipped.contains(role) { return }
    if role == "AXWebArea", webURL == nil { webURL = AX.url(element, "AXURL") }
    if TextWalk.readable.contains(role), let text = AX.string(element, kAXValueAttribute) ?? AX.string(element, kAXTitleAttribute) {
      if lines.last != text {
        lines.append(text)
        chars += text.count + 1
      }
    }
    for child in AX.children(element) { walk(child, depth: depth + 1) }
  }
}

enum Context {
  /// Password managers and the like are never read, whatever is asked.
  static func focused(_ params: [String: Any]) -> Result<Any, HelperError> {
    var excludedPids: Set<pid_t> = [getppid()]
    for pid in (params["excludePids"] as? [NSNumber]) ?? [] { excludedPids.insert(pid.int32Value) }
    let excludedApps = Set((params["excludeBundleIds"] as? [String]) ?? [])
    let maxChars = (params["maxChars"] as? NSNumber)?.intValue ?? 12_000

    guard let app = Activation.shared.frontmost(excluding: excludedPids) else {
      return .failure(HelperError("no_window", "No app is in front"))
    }
    let pid = app.processIdentifier
    var result: [String: Any] = [
      "app": json(app.localizedName),
      "bundleId": json(app.bundleIdentifier),
      "pid": Int(pid),
      "excluded": false,
      "axTrusted": AXIsProcessTrusted(),
    ]
    if let id = app.bundleIdentifier, excludedApps.contains(id) {
      result["excluded"] = true
      return .success(result)
    }

    let window = frontWindow(of: pid)
    result["windowId"] = json(window?.id)
    result["bounds"] = json(window?.bounds)

    var title = window?.title
    var url: String?
    var selected: String?
    var text = ""
    if AXIsProcessTrusted() {
      let appElement = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(appElement, 1.0)
      // Chromium and Electron apps build their accessibility tree only on request.
      AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
      if let focusedWindow = AX.element(appElement, kAXFocusedWindowAttribute) ?? AX.element(appElement, kAXMainWindowAttribute) {
        title = AX.string(focusedWindow, kAXTitleAttribute) ?? title
        url = AX.url(focusedWindow, kAXDocumentAttribute)
        var walk = TextWalk(maxChars: maxChars, seconds: 1.5)
        walk.walk(focusedWindow)
        text = String(walk.lines.joined(separator: "\n").prefix(maxChars))
        url = walk.webURL ?? url
      }
      if let focusedElement = AX.element(appElement, kAXFocusedUIElementAttribute) {
        selected = AX.string(focusedElement, kAXSelectedTextAttribute)
      }
    }
    result["title"] = json(title)
    result["url"] = json(url)
    result["selectedText"] = json(selected)
    result["text"] = text
    result["source"] = text.isEmpty ? "none" : "ax"
    return .success(result)
  }

  struct Window {
    let id: Int
    let title: String?
    let bounds: [String: Double]
  }

  /// The app's frontmost normal window. Titles here need Screen Recording;
  /// Accessibility supplies them otherwise.
  static func frontWindow(of pid: pid_t) -> Window? {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
      return nil
    }
    for info in list {
      guard (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
        (info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
        let id = (info[kCGWindowNumber as String] as? NSNumber)?.intValue
      else { continue }
      let rect = info[kCGWindowBounds as String] as? [String: Double] ?? [:]
      if (rect["Width"] ?? 0) < 50 || (rect["Height"] ?? 0) < 50 { continue }
      let name = (info[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 }
      return Window(
        id: id,
        title: name,
        bounds: ["x": rect["X"] ?? 0, "y": rect["Y"] ?? 0, "width": rect["Width"] ?? 0, "height": rect["Height"] ?? 0]
      )
    }
    return nil
  }
}
