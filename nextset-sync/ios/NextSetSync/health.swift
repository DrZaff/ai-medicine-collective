import Foundation
import HealthKit
import NextSetSyncCore

/// Optional Apple Health export. Writes Sleep Log's estimated asleep
/// intervals as HKCategoryValueSleepAnalysis.asleepUnspecified (iOS 16+).
/// Sleep Log's light/deep labels are its own movement-based estimates, so
/// they are NOT written as Apple's core/deep stages; they stay in this app.
///
/// Each sample carries HKMetadataKeySyncIdentifier ("nsync.sleep.<watch>.<t10>")
/// and HKMetadataKeySyncVersion: saving the same identifier with a higher
/// version replaces the earlier sample, so re-exporting never duplicates.
@MainActor
final class HealthExporter {
    private let store = HKHealthStore()
    private let sleepType = HKCategoryType(.sleepAnalysis)

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// .sharingAuthorized once the person allowed writing sleep.
    var status: HKAuthorizationStatus { store.authorizationStatus(for: sleepType) }

    /// Shows Apple's permission sheet (only the first time).
    func requestPermission() async throws {
        try await store.requestAuthorization(toShare: [sleepType], read: [])
    }

    /// Saves new or changed samples and returns those saved.
    func export(_ samples: [HealthSleepSample], watchId: String, firmware: String?, sleepLogVersion: String?,
                zone: (Date) -> TimeZone) async throws -> [HealthSleepSample] {
        guard !samples.isEmpty else { return [] }
        guard status == .sharingAuthorized else { throw HealthError.notAllowed }
        let device = HKDevice(name: "Bangle.js 2", manufacturer: "Espruino", model: "Bangle.js 2", hardwareVersion: nil,
                              firmwareVersion: firmware, softwareVersion: sleepLogVersion.map { "Sleep Log \($0)" },
                              localIdentifier: watchId, udiDeviceIdentifier: nil)
        let objects: [HKCategorySample] = samples.map { s in
            HKCategorySample(type: sleepType, value: HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                             start: s.start, end: s.end, device: device, metadata: [
                                HKMetadataKeySyncIdentifier: s.syncId,
                                HKMetadataKeySyncVersion: s.version,
                                // Apple recommends a time zone on sleep samples.
                                HKMetadataKeyTimeZone: zone(s.start).identifier,
                                "NextSetSyncSource": "Sleep Log \(sleepLogVersion ?? "") estimate (movement-based)",
                             ])
        }
        try await store.save(objects)
        return samples
    }

    enum HealthError: LocalizedError {
        case notAllowed
        var errorDescription: String? {
            "Apple Health has not allowed NextSet Sync to write sleep. Open the Health app > Profile > Apps > NextSet Sync and turn on Sleep."
        }
    }
}
