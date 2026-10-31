import Foundation

struct HelperError: Error {
  let code: String
  let message: String
  init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }
}

typealias Reply = (Result<Any, HelperError>) -> Void
typealias Handler = ([String: Any], @escaping Reply) -> Void

/// JSON has no nil; every optional goes out as null.
func json(_ value: Any?) -> Any { value ?? NSNull() }

/// One line per message, written in order from a serial queue.
final class Output {
  static let shared = Output()
  private let queue = DispatchQueue(label: "ambientmind.helper.output")

  func send(_ message: [String: Any]) {
    queue.async {
      guard JSONSerialization.isValidJSONObject(message),
        var data = try? JSONSerialization.data(withJSONObject: message, options: [.withoutEscapingSlashes])
      else { return }
      data.append(0x0A)
      // A closed pipe raises SIGPIPE and ends the process, which is right:
      // nobody is listening any more.
      FileHandle.standardOutput.write(data)
    }
  }

  func reply(_ id: Any, _ result: Result<Any, HelperError>) {
    switch result {
    case .success(let value):
      send(["id": id, "ok": true, "result": value])
    case .failure(let error):
      send(["id": id, "ok": false, "error": ["code": error.code, "message": error.message]])
    }
  }

  /// Waits until every reply queued so far is written.
  func drain() {
    queue.sync {}
  }

  func event(_ name: String, _ data: Any) {
    send(["event": name, "data": data])
  }
}

final class Server {
  static let shared = Server()

  func start() {
    Thread.detachNewThread {
      while let line = readLine(strippingNewline: true) {
        self.handle(line)
      }
      // stdin closed: the app is gone or done with us. Replies to requests
      // that already finished still go out; slow ones are dropped.
      Output.shared.drain()
      exit(0)
    }
  }

  func handle(_ line: String) {
    if line.trimmingCharacters(in: .whitespaces).isEmpty { return }
    guard let data = line.data(using: .utf8),
      let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      Output.shared.reply(NSNull(), .failure(HelperError("bad_request", "Each line must be one JSON object")))
      return
    }
    let id = message["id"] ?? NSNull()
    guard let method = message["method"] as? String else {
      Output.shared.reply(id, .failure(HelperError("bad_request", "Missing method")))
      return
    }
    guard let handler = Methods.table[method] else {
      Output.shared.reply(id, .failure(HelperError("unknown_method", "No method \(method)")))
      return
    }
    let params = message["params"] as? [String: Any] ?? [:]
    var replied = false
    let lock = NSLock()
    handler(params) { result in
      lock.lock()
      defer { lock.unlock() }
      guard !replied else { return }
      replied = true
      Output.shared.reply(id, result)
    }
  }
}

/// Exits when the app that started us exits, even if it never closed stdin.
enum ParentWatch {
  private static var source: DispatchSourceProcess?

  static func start() {
    let parent = getppid()
    if parent <= 1 { exit(0) }
    let watch = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .main)
    watch.setEventHandler { exit(0) }
    watch.resume()
    source = watch
  }
}

enum Methods {
  static let table: [String: Handler] = [
    "hello": { _, reply in reply(.success(hello())) },
    "perms.status": { params, reply in
      let kinds = (params["kinds"] as? [String]) ?? Permissions.kinds
      reply(.success(Dictionary(uniqueKeysWithValues: kinds.map { ($0, Permissions.status($0)) })))
    },
    "perms.request": { params, reply in
      guard let kind = params["kind"] as? String, Permissions.kinds.contains(kind) else {
        return reply(.failure(HelperError("bad_request", "kind must be one of \(Permissions.kinds.joined(separator: ", "))")))
      }
      Permissions.request(kind, reply)
    },
    "context.focused": { params, reply in
      DispatchQueue.global(qos: .userInitiated).async { reply(Context.focused(params)) }
    },
    "capture.windowOCR": { params, reply in
      guard let windowId = (params["windowId"] as? NSNumber)?.uint32Value else {
        return reply(.failure(HelperError("bad_request", "windowId is required")))
      }
      Capture.windowOCR(windowId: windowId, reply)
    },
    "capture.displayOCR": { params, reply in
      Capture.displayOCR(displayId: (params["displayId"] as? NSNumber)?.uint32Value, reply)
    },
    "ocr.image": { params, reply in
      guard let base64 = params["png"] as? String, let data = Data(base64Encoded: base64) else {
        return reply(.failure(HelperError("bad_request", "png must be base64")))
      }
      DispatchQueue.global(qos: .userInitiated).async { reply(OCR.recognize(data: data)) }
    },
    "system.busy": { _, reply in reply(.success(SystemState.busy())) },
    "contacts.me": { _, reply in reply(.success(MeCard.me())) },
  ]

  static func hello() -> [String: Any] {
    [
      "version": helperVersion,
      "protocol": protocolVersion,
      "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
      "pid": Int(getpid()),
      "responsibleApp": json(ResponsibleApp.bundleIdentifier),
      "responsiblePid": Int(ResponsibleApp.pid),
      "parentApp": json(ResponsibleApp.parentBundleIdentifier),
      "features": ["perms", "context", "capture", "ocr", "system", "contacts"],
    ]
  }
}

enum SelfTest {
  static func run() -> Never {
    var report = Methods.hello()
    report["perms"] = Dictionary(uniqueKeysWithValues: Permissions.kinds.map { ($0, Permissions.status($0)) })
    report["busy"] = SystemState.busy()
    let ocr = OCR.selfCheck()
    report["ocr"] = ocr
    report["ok"] = (ocr["ok"] as? Bool) ?? false
    if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) {
      FileHandle.standardOutput.write(data)
      FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
    exit((report["ok"] as? Bool) == true ? 0 : 1)
  }
}
