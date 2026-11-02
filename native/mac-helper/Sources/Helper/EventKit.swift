import EventKit
import Foundation

/// Calendar and Reminders through EventKit. One store for the process: a store
/// made before access was granted keeps seeing nothing until it is reset.
enum Store {
  static let shared = EKEventStore()

  private static var observer: NSObjectProtocol?
  private static var pending: DispatchWorkItem?

  /// iCloud delivers a burst of changes at once; one event per burst is enough.
  static func watch() {
    guard observer == nil else { return }
    observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: shared, queue: .main) { _ in
      pending?.cancel()
      let work = DispatchWorkItem { Output.shared.event("eventstore.changed", [:]) }
      pending = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
    }
  }
}

enum Stamp {
  private static let withFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  private static let plain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
  }()

  static func string(_ date: Date?) -> Any { date.map { withFraction.string(from: $0) } ?? NSNull() }
  static func date(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    return withFraction.date(from: text) ?? plain.date(from: text)
  }
}

enum Calendars {
  static func events(_ params: [String: Any]) -> Result<Any, HelperError> {
    guard Permissions.status("calendar") == "granted" else {
      return .failure(HelperError("permission_denied", "Calendar access is off for AmbientMind"))
    }
    guard let from = Stamp.date(params["from"]), let to = Stamp.date(params["to"]), from < to else {
      return .failure(HelperError("bad_request", "from and to must be ISO dates, from before to"))
    }
    Store.watch()
    let calendars = Store.shared.calendars(for: .event)
    let predicate = Store.shared.predicateForEvents(withStart: from, end: to, calendars: calendars)
    let events = Store.shared.events(matching: predicate).prefix(1000).map(describe)
    return .success(["events": Array(events)])
  }

  private static func describe(_ event: EKEvent) -> [String: Any] {
    let attendees: [[String: Any]] = (event.attendees ?? []).map { person in
      let email = person.url.absoluteString.hasPrefix("mailto:") ? String(person.url.absoluteString.dropFirst(7)) : nil
      return [
        "name": json(person.name),
        "email": json(email),
        "me": person.isCurrentUser,
        "declined": person.participantStatus == .declined,
        "resource": person.participantType == .resource || person.participantType == .room,
      ]
    }
    return [
      "id": event.calendarItemExternalIdentifier ?? event.eventIdentifier ?? UUID().uuidString,
      "calendar": event.calendar?.title ?? "",
      "account": event.calendar?.source?.title ?? "",
      "title": event.title ?? "",
      "notes": json(event.notes),
      "start": Stamp.string(event.startDate),
      "end": Stamp.string(event.endDate),
      "allDay": event.isAllDay,
      "recurring": event.hasRecurrenceRules || event.isDetached,
      "cancelled": event.status == .canceled,
      "attendees": attendees,
    ]
  }
}

enum Reminders {
  private static func ready() -> HelperError? {
    guard Permissions.status("reminders") == "granted" else {
      return HelperError("permission_denied", "Reminders access is off for AmbientMind")
    }
    Store.watch()
    return nil
  }

  private static func list(_ id: Any?) -> EKCalendar? {
    guard let id = id as? String, let calendar = Store.shared.calendar(withIdentifier: id) else { return nil }
    return calendar.allowedEntityTypes.contains(.reminder) ? calendar : nil
  }

  /// The list AmbientMind owns: the remembered one, else one with the title,
  /// else a new one where new reminders go by default (iCloud when signed in).
  static func ensureList(_ params: [String: Any]) -> Result<Any, HelperError> {
    if let error = ready() { return .failure(error) }
    let title = (params["title"] as? String) ?? "AmbientMind"
    let describe = { (calendar: EKCalendar, created: Bool) -> Result<Any, HelperError> in
      .success(["id": calendar.calendarIdentifier, "title": calendar.title, "account": calendar.source?.title ?? "", "created": created])
    }
    if let known = list(params["id"]) { return describe(known, false) }
    if let named = Store.shared.calendars(for: .reminder).first(where: { $0.title == title }) { return describe(named, false) }

    let calendar = EKCalendar(for: .reminder, eventStore: Store.shared)
    calendar.title = title
    guard let source = Store.shared.defaultCalendarForNewReminders()?.source
      ?? Store.shared.sources.first(where: { $0.sourceType == .calDAV && !$0.calendars(for: .reminder).isEmpty })
      ?? Store.shared.sources.first(where: { $0.sourceType == .local })
    else { return .failure(HelperError("no_source", "No account on this Mac can hold reminders")) }
    calendar.source = source
    do {
      try Store.shared.saveCalendar(calendar, commit: true)
      return describe(calendar, true)
    } catch {
      return .failure(HelperError("save_failed", error.localizedDescription))
    }
  }

  static func items(_ params: [String: Any], _ reply: @escaping Reply) {
    if let error = ready() { return reply(.failure(error)) }
    guard let calendar = list(params["listId"]) else {
      return reply(.failure(HelperError("list_missing", "The AmbientMind list is gone")))
    }
    let predicate = Store.shared.predicateForReminders(in: [calendar])
    Store.shared.fetchReminders(matching: predicate) { found in
      reply(.success(["reminders": (found ?? []).map(describe)]))
    }
  }

  static func upsert(_ params: [String: Any]) -> Result<Any, HelperError> {
    if let error = ready() { return .failure(error) }
    let reminder: EKReminder
    if let id = params["id"] as? String {
      guard let existing = Store.shared.calendarItem(withIdentifier: id) as? EKReminder else {
        return .failure(HelperError("not_found", "That reminder is gone"))
      }
      if let conflict = check(existing, params["expectedModifiedAt"]) { return .failure(conflict) }
      reminder = existing
    } else {
      guard let calendar = list(params["listId"]) else {
        return .failure(HelperError("list_missing", "The AmbientMind list is gone"))
      }
      reminder = EKReminder(eventStore: Store.shared)
      reminder.calendar = calendar
    }

    if let title = params["title"] as? String { reminder.title = title }
    if params.keys.contains("notes") { reminder.notes = params["notes"] as? String }
    if let priority = (params["priority"] as? NSNumber)?.intValue { reminder.priority = max(0, min(9, priority)) }
    if params.keys.contains("due") {
      if let due = Stamp.date(params["due"]) {
        var parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
        parts.timeZone = TimeZone.current
        reminder.dueDateComponents = parts
      } else {
        reminder.dueDateComponents = nil
      }
    }
    if let completed = params["completed"] as? Bool { reminder.isCompleted = completed }

    do {
      try Store.shared.save(reminder, commit: true)
      return .success(describe(reminder))
    } catch {
      return .failure(HelperError("save_failed", error.localizedDescription))
    }
  }

  static func delete(_ params: [String: Any]) -> Result<Any, HelperError> {
    if let error = ready() { return .failure(error) }
    guard let id = params["id"] as? String else { return .failure(HelperError("bad_request", "id is required")) }
    guard let reminder = Store.shared.calendarItem(withIdentifier: id) as? EKReminder else {
      return .success(["deleted": false])
    }
    if let conflict = check(reminder, params["expectedModifiedAt"]) { return .failure(conflict) }
    do {
      try Store.shared.remove(reminder, commit: true)
      return .success(["deleted": true])
    } catch {
      return .failure(HelperError("save_failed", error.localizedDescription))
    }
  }

  /// Someone changed it after the app last looked, so writing would lose that.
  private static func check(_ reminder: EKReminder, _ expected: Any?) -> HelperError? {
    guard let expected = expected as? String else { return nil }
    let actual = Stamp.string(reminder.lastModifiedDate) as? String
    return actual == expected ? nil : HelperError("conflict", "The reminder changed since it was read")
  }

  private static func describe(_ reminder: EKReminder) -> [String: Any] {
    var due: Date?
    var allDay = false
    if let parts = reminder.dueDateComponents {
      allDay = parts.hour == nil
      due = Calendar.current.date(from: parts)
    }
    return [
      "id": reminder.calendarItemIdentifier,
      "title": reminder.title ?? "",
      "notes": json(reminder.notes),
      "due": Stamp.string(due),
      "dueAllDay": allDay,
      "priority": reminder.priority,
      "completed": reminder.isCompleted,
      "completedAt": Stamp.string(reminder.completionDate),
      "modifiedAt": Stamp.string(reminder.lastModifiedDate),
      "recurring": reminder.hasRecurrenceRules,
    ]
  }
}
