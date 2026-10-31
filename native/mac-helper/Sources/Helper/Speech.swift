import AVFoundation
import Foundation
import Speech

/// Live dictation with SpeechAnalyzer: the helper opens the microphone,
/// streams partial words as events, and returns the final text on stop.
/// Everything runs on this Mac with the system's speech model.
enum LiveSpeech {
  static func status(_ reply: @escaping Reply) {
    guard #available(macOS 26, *) else {
      return reply(.success(["available": false, "reason": "Live speech needs macOS 26"]))
    }
    Task { reply(.success(await SpeechSession.status())) }
  }

  static func install(_ reply: @escaping Reply) {
    guard #available(macOS 26, *) else {
      return reply(.failure(HelperError("unsupported", "Live speech needs macOS 26")))
    }
    Task { reply(await SpeechSession.install()) }
  }

  static func start(_ params: [String: Any], _ reply: @escaping Reply) {
    guard #available(macOS 26, *) else {
      return reply(.failure(HelperError("unsupported", "Live speech needs macOS 26")))
    }
    let hints = (params["hints"] as? [String]) ?? []
    Task { reply(await SpeechSession.start(hints: hints)) }
  }

  static func stop(_ reply: @escaping Reply) {
    guard #available(macOS 26, *) else {
      return reply(.failure(HelperError("unsupported", "Live speech needs macOS 26")))
    }
    Task { reply(await SpeechSession.stop()) }
  }

  static func cancel(_ reply: @escaping Reply) {
    guard #available(macOS 26, *) else { return reply(.success(["cancelled": false])) }
    Task {
      await SpeechSession.cancel()
      reply(.success(["cancelled": true]))
    }
  }
}

@available(macOS 26, *)
actor SpeechSession {
  /// One session at a time; the app never overlaps start and stop.
  private static var current: SpeechSession?

  private let engine = AVAudioEngine()
  private let analyzer: SpeechAnalyzer
  private let transcriber: SpeechTranscriber
  private let input: AsyncStream<AnalyzerInput>.Continuation
  private let stream: AsyncStream<AnalyzerInput>
  private var finalized = ""
  private var volatile = ""
  private var resultsTask: Task<Void, Never>?
  private var converter: AVAudioConverter?

  private init(transcriber: SpeechTranscriber) {
    self.transcriber = transcriber
    analyzer = SpeechAnalyzer(modules: [transcriber], options: .init(priority: .userInitiated, modelRetention: .lingering))
    (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
  }

  static func locale() async -> Locale? {
    await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current)
  }

  static func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults], attributeOptions: [])
  }

  static func status() async -> [String: Any] {
    guard SpeechTranscriber.isAvailable else {
      return ["available": false, "reason": "This Mac has no on-device speech model"]
    }
    guard let locale = await locale() else {
      return ["available": false, "reason": "Live speech does not support \(Locale.current.identifier) yet"]
    }
    let state = await AssetInventory.status(forModules: [makeTranscriber(locale)])
    let installed = state == .installed
    return [
      "available": true,
      "installed": installed,
      "downloading": state == .downloading,
      "locale": locale.identifier(.bcp47),
    ]
  }

  /// Fetches the system's speech model for this language. macOS stores and
  /// shares it like the Dictation model; nothing lands in the app's folder.
  static func install() async -> Result<Any, HelperError> {
    guard let locale = await locale() else {
      return .failure(HelperError("unsupported", "Live speech does not support this language"))
    }
    do {
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [makeTranscriber(locale)]) {
        let progress = request.progress
        let ticker = Task {
          while !Task.isCancelled {
            Output.shared.event("speech.install", ["fraction": progress.fractionCompleted])
            try? await Task.sleep(nanoseconds: 500_000_000)
          }
        }
        defer { ticker.cancel() }
        try await request.downloadAndInstall()
      }
      return .success(await status())
    } catch {
      return .failure(HelperError("install_failed", error.localizedDescription))
    }
  }

  static func start(hints: [String]) async -> Result<Any, HelperError> {
    if Permissions.status("microphone") == "not-determined", !ResponsibleApp.hasUsageString("NSMicrophoneUsageDescription") {
      return .failure(HelperError("missing_usage_description", "The app has no microphone usage string, so macOS would end the helper instead of asking."))
    }
    if ["denied", "restricted"].contains(Permissions.status("microphone")) {
      return .failure(HelperError("permission_denied", "The microphone is off for AmbientMind. Turn it on in System Settings → Privacy & Security → Microphone."))
    }
    guard let locale = await locale() else {
      return .failure(HelperError("unsupported", "Live speech does not support this language"))
    }
    let transcriber = makeTranscriber(locale)
    guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
      return .failure(HelperError("not_installed", "The speech model for this language is not downloaded"))
    }
    await current?.abandon()
    let session = SpeechSession(transcriber: transcriber)
    current = session
    do {
      try await session.begin(hints: hints)
      return .success(["locale": locale.identifier(.bcp47)])
    } catch {
      await session.abandon()
      current = nil
      return .failure(HelperError("speech_failed", error.localizedDescription))
    }
  }

  static func stop() async -> Result<Any, HelperError> {
    guard let session = current else { return .failure(HelperError("not_running", "Not listening")) }
    current = nil
    return .success(["text": await session.finish()])
  }

  static func cancel() async {
    await current?.abandon()
    current = nil
  }

  private func begin(hints: [String]) async throws {
    let context = AnalysisContext()
    let cleaned = Array(Set(hints.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })).prefix(100)
    if !cleaned.isEmpty { context.contextualStrings[.general] = Array(cleaned) }
    try await analyzer.setContext(context)

    let inputNode = engine.inputNode
    let naturalFormat = inputNode.outputFormat(forBus: 0)
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: naturalFormat) else {
      throw HelperError("speech_failed", "No audio format the speech model accepts")
    }
    try await analyzer.prepareToAnalyze(in: format)

    resultsTask = Task { [transcriber] in
      do {
        for try await result in transcriber.results {
          self.take(String(result.text.characters), final: result.isFinal)
        }
      } catch {
        Output.shared.event("speech.error", ["message": error.localizedDescription])
      }
    }
    try await analyzer.start(inputSequence: stream)

    let continuation = input
    var lastLevel = Date.distantPast
    inputNode.installTap(onBus: 0, bufferSize: 2048, format: naturalFormat) { [weak self] buffer, _ in
      let now = Date()
      if now.timeIntervalSince(lastLevel) > 0.05 {
        lastLevel = now
        Output.shared.event("speech.level", ["rms": Self.rms(buffer)])
      }
      guard let self else { return }
      Task { if let converted = await self.convert(buffer, to: format) { continuation.yield(AnalyzerInput(buffer: converted)) } }
    }
    engine.prepare()
    try engine.start()
  }

  private func take(_ text: String, final: Bool) {
    if final {
      finalized += text
      volatile = ""
    } else {
      volatile = text
    }
    Output.shared.event("speech.partial", ["text": (finalized + volatile).trimmingCharacters(in: .whitespaces), "final": final])
  }

  private func finish() async -> String {
    stopAudio()
    input.finish()
    do {
      try await analyzer.finalizeAndFinishThroughEndOfInput()
    } catch {
      Output.shared.event("speech.error", ["message": error.localizedDescription])
    }
    await resultsTask?.value
    return (finalized + volatile).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func abandon() async {
    stopAudio()
    input.finish()
    await analyzer.cancelAndFinishNow()
    resultsTask?.cancel()
  }

  private func stopAudio() {
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
  }

  private func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
    if buffer.format == format { return buffer }
    if converter == nil {
      converter = AVAudioConverter(from: buffer.format, to: format)
      converter?.primeMethod = .none
    }
    guard let converter else { return nil }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: max(1, capacity)) else { return nil }
    var consumed = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, inputStatus in
      if consumed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    return status == .error ? nil : output
  }

  private static func rms(_ buffer: AVAudioPCMBuffer) -> Double {
    guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
    var sum: Float = 0
    let count = Int(buffer.frameLength)
    var i = 0
    while i < count {
      sum += samples[i] * samples[i]
      i += 4
    }
    return Double(sqrt(sum / Float(max(1, count / 4))))
  }
}
