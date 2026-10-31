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
      swiftSettings: [.swiftLanguageMode(.v5)]
    )
  ]
)
