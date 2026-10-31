import AppKit
import Foundation

/// The AmbientMind helper: one long-lived process that does what only Swift
/// APIs can (permissions, Accessibility, ScreenCaptureKit, Vision, EventKit),
/// speaking newline-delimited JSON over stdio. See docs/SYSTEM.md, "Swift helper".
///
///   ambientmind-helper             serve requests on stdin
///   ambientmind-helper --selftest  print a JSON report and exit
///   ambientmind-helper --transcribe <audio file> [hint ...]
///                                  run the live speech path on a file, print the text
///   ambientmind-helper --version

let helperVersion = "0.2.0"
let protocolVersion = 1

let arguments = CommandLine.arguments
if arguments.contains("--version") {
  print(helperVersion)
  exit(0)
}

Activation.shared.start()

if arguments.contains("--selftest") {
  SelfTest.run()
}

if let flag = arguments.firstIndex(of: "--transcribe"), flag + 1 < arguments.count {
  SelfTest.transcribe(path: arguments[flag + 1], hints: Array(arguments.dropFirst(flag + 2)))
}

ParentWatch.start()
Server.shared.start()
// A full event loop rather than a bare run loop: Carbon hotkey events only
// arrive through it. Prohibited means no Dock icon, menu or focus, ever.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
application.run()
