import AppKit
import Foundation

/// The AmbientMind helper: one long-lived process that does what only Swift
/// APIs can (permissions, Accessibility, ScreenCaptureKit, Vision, EventKit),
/// speaking newline-delimited JSON over stdio. See docs/SYSTEM.md, "Swift helper".
///
///   ambientmind-helper             serve requests on stdin
///   ambientmind-helper --selftest  print a JSON report and exit
///   ambientmind-helper --version

let helperVersion = "0.1.0"
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

ParentWatch.start()
Server.shared.start()
// AppKit notifications, Accessibility and ScreenCaptureKit callbacks need it.
RunLoop.main.run()
