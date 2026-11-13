// swift-tools-version:5.9
// Platform-neutral core of the NextSet Sync iPhone app: models, protocol v1,
// sync engine, local storage, Sleep Log parsing and analysis, CSV, imports.
// No UIKit, CoreBluetooth or HealthKit here, so `swift test` runs on Linux too.
import PackageDescription

let package = Package(
    name: "NextSetSyncCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "NextSetSyncCore", targets: ["NextSetSyncCore"])],
    targets: [
        .target(name: "NextSetSyncCore"),
        .testTarget(name: "NextSetSyncCoreTests", dependencies: ["NextSetSyncCore"]),
    ]
)
