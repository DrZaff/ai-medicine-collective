import NextSetSyncCore
import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                Section("Training") {
                    if let latest = model.sessions.first(where: { $0.finished && !$0.isDemo }) {
                        NavigationLink {
                            SessionDetail(session: latest)
                        } label: {
                            LabeledContent(latest.workoutName, value: latest.start.formatted(date: .abbreviated, time: .omitted))
                        }
                    } else {
                        Text("Completed workouts appear here after you sync.").foregroundStyle(.secondary)
                    }
                }
                Section("Sleep") {
                    if let latest = model.nights.first {
                        NightCard(night: latest, current: .current)
                    }
                    NavigationLink {
                        SleepView()
                    } label: {
                        Label("Sleep history", systemImage: "bed.double")
                    }
                }
            }
            .navigationTitle("Today")
        }
    }
}
