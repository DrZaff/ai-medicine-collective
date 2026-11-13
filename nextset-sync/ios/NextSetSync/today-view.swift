import NextSetSyncCore
import SwiftUI

/// The everyday screen: is everything synced, recent training, moments marked
/// on the watch (with notes added here), and last night's sleep.
struct TodayView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Last sync", value: model.link.lastSync.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Never")
                    if let st = model.link.watchStatus, st.pendingSets + (st.pendingMarkers ?? 0) > 0 {
                        Label("\(st.pendingSets) sets and \(st.pendingMarkers ?? 0) markers waiting on the watch", systemImage: "clock")
                            .foregroundStyle(.orange)
                    }
                    if model.awaitingAck > 0 {
                        Label("\(model.awaitingAck) saved here, awaiting watch confirmation", systemImage: "clock")
                            .foregroundStyle(.orange)
                    }
                }
                Section("Training") {
                    // Demo data lives in its own store, so no demo filter is needed here.
                    let recent = Array(model.sessions.filter(\.finished).prefix(3))
                    if recent.isEmpty {
                        Text("Completed workouts appear here after you sync.").foregroundStyle(.secondary)
                    }
                    ForEach(recent) { s in
                        NavigationLink { SessionDetail(session: s) } label: {
                            LabeledContent(s.workoutName, value: "\(s.sets.count) sets · \(s.start.formatted(date: .abbreviated, time: .omitted))")
                        }
                    }
                }
                Section("Moments") {
                    let marks = Array(model.markers.prefix(5))
                    if marks.isEmpty {
                        Text("Moments you mark on the watch (Coffee, Idea...) appear here.").foregroundStyle(.secondary)
                    }
                    ForEach(marks) { m in
                        NavigationLink { MarkerNoteView(marker: m) } label: { MarkerRow(marker: m, note: model.note(for: m)) }
                    }
                    if model.markers.count > marks.count {
                        NavigationLink("All moments (\(model.markers.count))") { MarkersView() }
                    }
                }
                Section("Sleep") {
                    if let n = model.nights.first {
                        LabeledContent("Last night", value: hm(n.main.asleepMinutes) + (n.main.isPartial ? " (so far)" : ""))
                        LabeledContent("Asleep → awake", value: "\(SleepAnalyzer.clock(n.main.start, n.timeZone)) → \(SleepAnalyzer.clock(n.main.end, n.timeZone))")
                    } else {
                        Text("Sleep appears after a night with Sleep Log and a morning sync.").foregroundStyle(.secondary)
                    }
                    NavigationLink { SleepView() } label: { Label("Sleep history", systemImage: "bed.double") }
                }
            }
            .navigationTitle("Today")
        }
    }
}

struct MarkerRow: View {
    let marker: MarkerRecord
    let note: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(marker.label).font(.headline)
                Spacer()
                Text(marker.at.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
            }
            if !note.isEmpty { Text(note).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
        }
    }
}

struct MarkersView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        List(model.markers) { m in
            NavigationLink { MarkerNoteView(marker: m) } label: { MarkerRow(marker: m, note: model.note(for: m)) }
        }
        .navigationTitle("Moments")
    }
}

/// A note kept only on this iPhone. Re-syncing the marker never changes it.
struct MarkerNoteView: View {
    @Environment(AppModel.self) private var model
    let marker: MarkerRecord
    @State private var text = ""
    var body: some View {
        Form {
            Section {
                LabeledContent("Marked", value: marker.at.formatted(date: .complete, time: .shortened))
            }
            Section {
                TextField("What happened?", text: $text, axis: .vertical).lineLimit(3...8)
            } header: { Text("Note") } footer: { Text("Kept on this iPhone only.") }
        }
        .navigationTitle(marker.label)
        .onAppear { text = model.note(for: marker) }
        .onDisappear { model.setNote(text, for: marker) }
    }
}
