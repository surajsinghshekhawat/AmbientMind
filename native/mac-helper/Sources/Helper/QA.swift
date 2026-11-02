import EventKit
import Foundation

/// Under the app's QA mode (AMBIENTMIND_QA=1, inherited from it) the helper
/// writes only to a Reminders list and a calendar titled "AmbientMind QA", and
/// leaves the microphone, the screen, Contacts and global hotkeys alone. The
/// app keeps to the same rules; this is the line it cannot cross by mistake.
enum QaGuard {
  static let enabled = ProcessInfo.processInfo.environment["AMBIENTMIND_QA"] == "1"
  static let title = "AmbientMind QA"

  private static let refused: Set<String> = [
    "speech.start", "speech.install", "context.focused", "capture.windowOCR", "capture.displayOCR", "contacts.me",
  ]
  /// The app would steal your shortcuts from the AmbientMind you are using.
  private static let ignored: Set<String> = ["hotkey.set", "hotkey.clear"]
  private static let reminderMethods: Set<String> = ["reminders.ensureList", "reminders.list", "reminders.upsert", "reminders.delete"]

  private static func blocked(_ why: String) -> HelperError { HelperError("qa_blocked", why) }

  /// The handler to run for `method`: the real one, a refusal, or a check in front of it.
  static func handler(for method: String) -> Handler? {
    guard enabled else { return Methods.table[method] }
    if let qa = methods[method] { return qa }
    guard let real = Methods.table[method] else { return nil }
    if refused.contains(method) { return { _, reply in reply(.failure(blocked("\(method) is off in QA mode"))) } }
    if ignored.contains(method) { return { params, reply in reply(.success(["name": json(params["name"])])) } }
    if method == "perms.request" {
      return { params, reply in
        let kind = params["kind"] as? String
        guard kind == "reminders" || kind == "calendar" else {
          return reply(.failure(blocked("only Reminders and Calendar may be asked for in QA mode")))
        }
        real(params, reply)
      }
    }
    if reminderMethods.contains(method) {
      return { params, reply in
        eventKitQueue.async {
          if let refusal = checkReminders(method, params) { return reply(.failure(refusal)) }
          real(params, reply)
        }
      }
    }
    return real
  }

  private static func isQaList(_ id: Any?) -> Bool {
    guard let id = id as? String else { return false }
    return Store.shared.calendar(withIdentifier: id)?.title == title
  }

  private static func checkReminders(_ method: String, _ params: [String: Any]) -> HelperError? {
    let outside = blocked("QA mode only touches the \(title) list")
    switch method {
    case "reminders.ensureList":
      guard (params["title"] as? String) == title else { return outside }
      if let id = params["id"] as? String, !isQaList(id) { return outside }
    case "reminders.list":
      if !isQaList(params["listId"]) { return outside }
    case "reminders.upsert", "reminders.delete":
      if let id = params["id"] as? String {
        // Gone already is fine: delete answers deleted: false, upsert not_found.
        guard let item = Store.shared.calendarItem(withIdentifier: id) else { return nil }
        if item.calendar?.title != title { return outside }
      } else if method == "reminders.upsert", !isQaList(params["listId"]) {
        return outside
      }
    default:
      break
    }
    return nil
  }

  /// Set-up and clean-up for live runs; they exist only in QA mode.
  static let methods: [String: Handler] = [
    "qa.calendar.create": { params, reply in eventKitQueue.async { reply(createCalendar(params)) } },
    "qa.calendar.delete": { _, reply in eventKitQueue.async { reply(remove(.event)) } },
    "qa.reminders.deleteList": { _, reply in eventKitQueue.async { reply(remove(.reminder)) } },
  ]

  /// A calendar titled "AmbientMind QA" with the given events, on this Mac
  /// when it can hold one, else where new events go.
  private static func createCalendar(_ params: [String: Any]) -> Result<Any, HelperError> {
    guard Permissions.status("calendar") == "granted" else {
      return .failure(HelperError("permission_denied", "Calendar access is off"))
    }
    let store = Store.shared
    let calendar: EKCalendar
    if let existing = store.calendars(for: .event).first(where: { $0.title == title }) {
      calendar = existing
    } else {
      calendar = EKCalendar(for: .event, eventStore: store)
      calendar.title = title
      guard let source = store.sources.first(where: { $0.sourceType == .local }) ?? store.defaultCalendarForNewEvents?.source else {
        return .failure(HelperError("no_source", "No account on this Mac can hold a calendar"))
      }
      calendar.source = source
      do {
        try store.saveCalendar(calendar, commit: true)
      } catch {
        return .failure(HelperError("save_failed", error.localizedDescription))
      }
    }
    var ids: [String] = []
    for spec in (params["events"] as? [[String: Any]]) ?? [] {
      guard let start = Stamp.date(spec["start"]), let end = Stamp.date(spec["end"]) else { continue }
      let event = EKEvent(eventStore: store)
      event.calendar = calendar
      event.title = (spec["title"] as? String) ?? "QA event"
      event.notes = spec["notes"] as? String
      event.startDate = start
      event.endDate = end
      event.isAllDay = (spec["allDay"] as? Bool) ?? false
      do {
        try store.save(event, span: .thisEvent, commit: true)
        ids.append(event.calendarItemExternalIdentifier ?? event.eventIdentifier ?? "")
      } catch {
        return .failure(HelperError("save_failed", error.localizedDescription))
      }
    }
    return .success(["calendarId": calendar.calendarIdentifier, "account": calendar.source?.title ?? "", "events": ids])
  }

  private static func remove(_ type: EKEntityType) -> Result<Any, HelperError> {
    var removed: [String] = []
    for calendar in Store.shared.calendars(for: type) where calendar.title == title {
      do {
        try Store.shared.removeCalendar(calendar, commit: true)
        removed.append(calendar.source?.title ?? "")
      } catch {
        return .failure(HelperError("save_failed", error.localizedDescription))
      }
    }
    return .success(["deleted": removed.count, "accounts": removed])
  }
}
