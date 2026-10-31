import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import Vision

/// One window (or one display) to text: ScreenCaptureKit for the pixels,
/// Vision for the words. Never prompts; without Screen Recording it says so.
enum Capture {
  static func windowOCR(windowId: UInt32, _ reply: @escaping Reply) {
    guard CGPreflightScreenCaptureAccess() else { return reply(.failure(permissionDenied)) }
    Task {
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
          throw HelperError("not_found", "That window is no longer on screen")
        }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let image = try await capture(filter)
        reply(OCR.recognize(image: image).map { text in
          ["text": text, "width": image.width, "height": image.height, "title": json(window.title), "app": json(window.owningApplication?.applicationName)]
        })
      } catch let error as HelperError {
        reply(.failure(error))
      } catch {
        reply(.failure(HelperError("capture_failed", error.localizedDescription)))
      }
    }
  }

  /// The display under the mouse (or the one asked for), minus AmbientMind's own windows.
  static func displayOCR(displayId: UInt32?, _ reply: @escaping Reply) {
    guard CGPreflightScreenCaptureAccess() else { return reply(.failure(permissionDenied)) }
    let target = displayId ?? displayUnderMouse()
    Task {
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == target }) ?? content.displays.first else {
          throw HelperError("not_found", "No display to capture")
        }
        let ours = content.applications.filter { $0.processID == getppid() || $0.processID == getpid() }
        let filter = SCContentFilter(display: display, excludingApplications: ours, exceptingWindows: [])
        let image = try await capture(filter)
        reply(OCR.recognize(image: image).map { text in ["text": text, "width": image.width, "height": image.height] })
      } catch let error as HelperError {
        reply(.failure(error))
      } catch {
        reply(.failure(HelperError("capture_failed", error.localizedDescription)))
      }
    }
  }

  static let permissionDenied = HelperError(
    "permission_denied",
    "Screen Recording is off for AmbientMind. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording."
  )

  private static func capture(_ filter: SCContentFilter) async throws -> CGImage {
    let configuration = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    configuration.width = max(1, Int(filter.contentRect.width * scale))
    configuration.height = max(1, Int(filter.contentRect.height * scale))
    configuration.showsCursor = false
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
  }

  private static func displayUnderMouse() -> UInt32 {
    let location = CGEvent(source: nil)?.location ?? .zero
    var display: CGDirectDisplayID = 0
    var count: UInt32 = 0
    CGGetDisplaysWithPoint(location, 1, &display, &count)
    return count > 0 ? display : CGMainDisplayID()
  }
}

enum OCR {
  static func recognize(data: Data) -> Result<Any, HelperError> {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { return .failure(HelperError("bad_request", "Not an image")) }
    return recognize(image: image).map { ["text": $0, "width": image.width, "height": image.height] }
  }

  /// Lines in reading order: top to bottom, then left to right.
  static func recognize(image: CGImage) -> Result<String, HelperError> {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    do {
      try VNImageRequestHandler(cgImage: image).perform([request])
    } catch {
      return .failure(HelperError("ocr_failed", error.localizedDescription))
    }
    let lines = (request.results ?? []).compactMap { observation -> (CGRect, String)? in
      guard let text = observation.topCandidates(1).first?.string else { return nil }
      return (observation.boundingBox, text)
    }
    let ordered = lines.sorted { a, b in
      abs(a.0.midY - b.0.midY) > 0.008 ? a.0.midY > b.0.midY : a.0.minX < b.0.minX
    }
    return .success(ordered.map(\.1).joined(separator: "\n"))
  }

  /// Renders a known phrase and reads it back, so --selftest proves Vision works here.
  static func selfCheck() -> [String: Any] {
    let phrase = "Reply to Priya by Friday"
    let size = CGSize(width: 640, height: 120)
    guard let context = CGContext(
      data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return ["ok": false, "error": "no graphics context"] }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(origin: .zero, size: size))
    let attributed = NSAttributedString(string: phrase, attributes: [
      .font: NSFont.systemFont(ofSize: 44),
      .foregroundColor: NSColor.black,
    ])
    let line = CTLineCreateWithAttributedString(attributed)
    context.textPosition = CGPoint(x: 20, y: 40)
    CTLineDraw(line, context)
    guard let image = context.makeImage() else { return ["ok": false, "error": "no image"] }
    switch recognize(image: image) {
    case .success(let text):
      return ["ok": text.contains("Priya"), "read": text]
    case .failure(let error):
      return ["ok": false, "error": error.message]
    }
  }
}
