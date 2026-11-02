import Foundation
import FoundationModels

/// Apple's on-device model. One fresh session per call: the context window is
/// about 4K tokens, so carrying a transcript between calls would only crowd
/// out the next message.
enum Language {
  /// Reported to the app so it can budget prompts; not queryable on macOS 26.0.
  static let contextTokens = 4096

  static func status() -> [String: Any] {
    guard #available(macOS 26, *) else {
      return ["available": false, "reason": "os_too_old", "contextTokens": contextTokens]
    }
    switch SystemLanguageModel.default.availability {
    case .available:
      return ["available": true, "reason": NSNull(), "contextTokens": contextTokens]
    case .unavailable(let reason):
      return ["available": false, "reason": describe(reason), "contextTokens": contextTokens]
    }
  }

  @available(macOS 26, *)
  private static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible: return "device_not_eligible"
    case .appleIntelligenceNotEnabled: return "not_enabled"
    case .modelNotReady: return "model_not_ready"
    @unknown default: return "unknown"
    }
  }

  /// `schema` is the same JSON Schema the app gives Ollama's `format`, so both
  /// engines are held to one shape. The reply is always a string: JSON text
  /// when a schema was given, plain text otherwise.
  static func generate(_ params: [String: Any], _ reply: @escaping Reply) {
    guard #available(macOS 26, *) else {
      return reply(.failure(HelperError("unavailable", "Apple's model needs macOS 26")))
    }
    guard let prompt = params["prompt"] as? String, !prompt.isEmpty else {
      return reply(.failure(HelperError("bad_request", "prompt is required")))
    }
    guard case .available = SystemLanguageModel.default.availability else {
      return reply(.failure(HelperError("unavailable", "Apple Intelligence is not ready on this Mac")))
    }

    let schema: GenerationSchema?
    do {
      schema = try (params["schema"] as? [String: Any]).map { try SchemaBridge.schema(from: $0) }
    } catch let error as HelperError {
      return reply(.failure(error))
    } catch {
      return reply(.failure(HelperError("bad_schema", "\(error)")))
    }

    let options = GenerationOptions(
      samplingMode: (params["greedy"] as? Bool) == false ? nil : .greedy,
      temperature: (params["temperature"] as? NSNumber)?.doubleValue,
      maximumResponseTokens: (params["maxTokens"] as? NSNumber)?.intValue
    )
    let session = LanguageModelSession(instructions: params["system"] as? String)
    let started = Date()

    Task {
      do {
        let content: String
        if let schema {
          content = try await session.respond(to: prompt, schema: schema, options: options).content.jsonString
        } else {
          content = try await session.respond(to: prompt, options: options).content
        }
        reply(.success(["content": content, "ms": Int(Date().timeIntervalSince(started) * 1000)]))
      } catch {
        reply(.failure(failure(error)))
      }
    }
  }

  @available(macOS 26, *)
  private static func failure(_ error: Error) -> HelperError {
    if let generation = error as? LanguageModelSession.GenerationError {
      switch generation {
      case .exceededContextWindowSize: return HelperError("context_overflow", "The prompt is too long for Apple's model")
      case .guardrailViolation: return HelperError("guardrail", "Apple's safety guardrails declined this text")
      case .refusal: return HelperError("refusal", "Apple's model declined to answer")
      case .assetsUnavailable: return HelperError("unavailable", "Apple's model is not downloaded yet")
      case .unsupportedLanguageOrLocale: return HelperError("unsupported_language", "Apple's model does not support this language")
      case .rateLimited, .concurrentRequests: return HelperError("busy", "Apple's model is busy")
      case .unsupportedGuide: return HelperError("bad_schema", "\(generation)")
      case .decodingFailure: return HelperError("generation_failed", "Apple's model returned malformed output")
      @unknown default: return HelperError("generation_failed", "\(generation)")
      }
    }
    // Newer systems throw newer error types; their names still say what happened.
    let text = String(describing: error)
    if text.localizedCaseInsensitiveContains("context") { return HelperError("context_overflow", text) }
    if text.localizedCaseInsensitiveContains("guardrail") { return HelperError("guardrail", text) }
    return HelperError("generation_failed", text)
  }
}

/// The subset of JSON Schema the app's prompts use: objects, arrays, strings
/// (optionally an enum), numbers, integers, booleans, and `null` unions, which
/// become optional properties.
@available(macOS 26, *)
enum SchemaBridge {
  static func schema(from root: [String: Any]) throws -> GenerationSchema {
    var counter = 0
    return try GenerationSchema(root: node(root, name: "Root", counter: &counter), dependencies: [])
  }

  private static func node(_ json: [String: Any], name: String, counter: inout Int) throws -> DynamicGenerationSchema {
    let description = json["description"] as? String

    if let choices = json["anyOf"] as? [[String: Any]] {
      let concrete = choices.filter { !isNull($0) }
      if concrete.count == 1 { return try node(concrete[0], name: name, counter: &counter) }
      counter += 1
      let base = "\(name)\(counter)"
      return DynamicGenerationSchema(
        name: base,
        description: description,
        anyOf: try concrete.enumerated().map { try node($0.element, name: "\(base)Option\($0.offset)", counter: &counter) }
      )
    }

    switch type(of: json) {
    case "string":
      if let values = json["enum"] as? [String] {
        counter += 1
        return DynamicGenerationSchema(name: "\(name)\(counter)", description: description, anyOf: values)
      }
      return DynamicGenerationSchema(type: String.self)
    case "number":
      return DynamicGenerationSchema(type: Double.self)
    case "integer":
      return DynamicGenerationSchema(type: Int.self)
    case "boolean":
      return DynamicGenerationSchema(type: Bool.self)
    case "array":
      guard let items = json["items"] as? [String: Any] else {
        throw HelperError("bad_schema", "\(name): an array needs items")
      }
      return DynamicGenerationSchema(
        arrayOf: try node(items, name: "\(name)Item", counter: &counter),
        minimumElements: (json["minItems"] as? NSNumber)?.intValue,
        maximumElements: (json["maxItems"] as? NSNumber)?.intValue
      )
    case "object":
      let properties = json["properties"] as? [String: [String: Any]] ?? [:]
      let required = json["required"] as? [String] ?? []
      // JSON objects lose their key order on the way in, and the model writes
      // fields in schema order, so `required` (an array) sets the order.
      let ordered = required.filter { properties[$0] != nil } + properties.keys.filter { !required.contains($0) }.sorted()
      counter += 1
      let base = "\(name)\(counter)"
      return DynamicGenerationSchema(
        name: base,
        description: description,
        properties: try ordered.map { key in
          let property = properties[key]!
          return DynamicGenerationSchema.Property(
            name: key,
            description: property["description"] as? String,
            schema: try node(property, name: "\(base)_\(key)", counter: &counter),
            isOptional: !required.contains(key) || isNullable(property)
          )
        }
      )
    default:
      throw HelperError("bad_schema", "\(name): unsupported type \(json["type"] ?? "none")")
    }
  }

  private static func type(of json: [String: Any]) -> String {
    if let single = json["type"] as? String { return single }
    if let many = json["type"] as? [String] { return many.first { $0 != "null" } ?? "null" }
    return json["enum"] != nil ? "string" : "none"
  }

  private static func isNull(_ json: [String: Any]) -> Bool { (json["type"] as? String) == "null" }

  private static func isNullable(_ json: [String: Any]) -> Bool {
    if let choices = json["anyOf"] as? [[String: Any]] { return choices.contains(where: isNull) }
    if let many = json["type"] as? [String] { return many.contains("null") }
    return false
  }
}
