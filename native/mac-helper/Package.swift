// swift-tools-version:6.0
import PackageDescription

// Built by `./dev npm run helper` (scripts/build-helper.cjs), which keeps
// SwiftPM's caches and build products inside .local/.
let package = Package(
  name: "ambientmind-helper",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "ambientmind-helper",
      path: "Sources/Helper",
      swiftSettings: [.swiftLanguageMode(.v5)],
      // FoundationModels ships with macOS 26; weak, so the helper still
      // starts on 14 and 15 and simply reports the model unavailable.
      linkerSettings: [.unsafeFlags(["-Xlinker", "-weak_framework", "-Xlinker", "FoundationModels"])]
    )
  ]
)
