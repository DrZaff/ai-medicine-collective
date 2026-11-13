import CoreTransferable
import Foundation
import NextSetSyncCore
import UniformTypeIdentifiers

/// Share-sheet payloads that build their file only when the person actually
/// shares (not on every screen redraw).
struct SetHistoryCSV: Transferable {
    let sets: [SetRecord]
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { doc in
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("nextset-sync-sets-\(SleepAnalyzer.dayString(Date(), .current)).csv")
            try SetCSV.make(doc.sets).write(to: url, atomically: true, encoding: .utf8)
            return SentTransferredFile(url)
        }
    }
}

struct WorkoutFile: Transferable {
    let workout: Workout
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .json) { doc in
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(WorkoutImporter.slug(doc.workout.name)).nextset-workout.json")
            try WorkoutImporter.exportData(doc.workout).write(to: url)
            return SentTransferredFile(url)
        }
    }
}
