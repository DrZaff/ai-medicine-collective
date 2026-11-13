import Charts
import NextSetSyncCore
import SwiftUI
import UniformTypeIdentifiers

// MARK: - History (completed sessions)

struct HistoryView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Waiting on the watch", value: model.link.watchStatus.map { "\($0.pendingSets) sets" } ?? "unknown")
                    LabeledContent("Saved here, awaiting watch confirmation", value: "\(model.awaitingAck)")
                } footer: {
                    Text("A set is copied to the iPhone, saved, and only then confirmed to the watch, which deletes its copy. Edits on the watch keep the set's ID, so each set appears once.")
                }
                if model.sessions.isEmpty {
                    ContentUnavailableView("No sessions yet", systemImage: "figure.strengthtraining.traditional",
                                           description: Text("Send a workout to the watch, log sets there, then sync."))
                }
                ForEach(model.sessions) { s in
                    NavigationLink { SessionDetail(session: s) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(s.workoutName).font(.headline)
                                if s.isDemo { Text("demo").font(.caption2).padding(.horizontal, 4).background(.yellow.opacity(0.3), in: Capsule()) }
                            }
                            Text("\(s.start.formatted(date: .abbreviated, time: .shortened)) · \(s.sets.count) sets · \(s.finished ? "finished" : "in progress on watch")")
                                .font(.caption).foregroundStyle(.secondary)
                            if s.awaitingAck > 0 {
                                Label("\(s.awaitingAck) awaiting watch confirmation", systemImage: "clock").font(.caption).foregroundStyle(.orange)
                            }
                        }
                    }
                }
            }
            .navigationTitle("History")
            .toolbar {
                ShareLink(item: SetHistoryCSV(sets: model.allSets), preview: SharePreview("Set history (CSV)")) {
                    Label("Export CSV", systemImage: "square.and.arrow.up")
                }
            }
        }
    }
}

struct SessionDetail: View {
    let session: SessionSummary
    var body: some View {
        List {
            Section {
                LabeledContent("Started", value: session.start.formatted(date: .abbreviated, time: .shortened))
                if let e = session.end, session.finished { LabeledContent("Finished", value: e.formatted(date: .omitted, time: .shortened)) }
            }
            let groups = Dictionary(grouping: session.sets, by: \.exerciseIndex).sorted { $0.key < $1.key }
            ForEach(groups, id: \.key) { _, sets in
                Section(sets.first?.exerciseName ?? "Exercise") {
                    ForEach(sets) { s in
                        HStack {
                            Text("Set \(s.setNumber)")
                            Spacer()
                            Text("\(fmt(s.load)) \(s.units.rawValue) × \(s.reps) @ \(fmt(s.rir))").monospacedDigit()
                            Image(systemName: s.ackState == .confirmed ? "checkmark.circle.fill" : "clock")
                                .foregroundStyle(s.ackState == .confirmed ? .green : .orange)
                                .accessibilityLabel(s.ackState == .confirmed ? "Synced" : "Saved here, awaiting watch confirmation")
                        }
                        if s.rev > 1 { Text("Edited on the watch (version \(s.rev))").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
            }
        }
        .navigationTitle(session.workoutName)
    }
}

// MARK: - Sleep

struct SleepView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            let nights = model.nights
            List {
                if let last = nights.first {
                    Section("Latest night") { NightCard(night: last, current: .current) }
                    Section("Last 7 nights") {
                        let trend = SleepAnalyzer.trend(nights)
                        Chart(trend) { p in
                            if let m = p.asleepMinutes {
                                BarMark(x: .value("Woke", String(p.wakeDate.suffix(5))), y: .value("Hours", Double(m) / 60))
                                    .foregroundStyle(p.isPartial ? Color.orange : Color.indigo)
                            }
                        }
                        .chartYAxisLabel("hours asleep (estimate)")
                        .frame(height: 180)
                        let known = trend.compactMap(\.asleepMinutes)
                        if !known.isEmpty {
                            LabeledContent("Average", value: hm(known.reduce(0, +) / known.count))
                        }
                    }
                    Section("Nights") {
                        ForEach(nights) { n in
                            NavigationLink { List { NightCard(night: n, current: .current) }.navigationTitle(n.wakeDate) } label: {
                                HStack {
                                    Text(n.wakeDate)
                                    Spacer()
                                    Text(hm(n.main.asleepMinutes)).monospacedDigit()
                                    if n.main.isPartial { Image(systemName: "hourglass").foregroundStyle(.orange) }
                                }
                            }
                        }
                    }
                } else {
                    ContentUnavailableView("No sleep data yet", systemImage: "bed.double",
                                           description: Text("Install Sleep Log on the watch, wear it overnight, then sync in the morning."))
                }
            }
            .navigationTitle("Sleep")
        }
    }
}

func hm(_ minutes: Int) -> String { "\(minutes / 60) h \(String(format: "%02d", minutes % 60)) m" }

struct NightCard: View {
    let night: SleepNight
    let current: TimeZone
    var body: some View {
        let m = night.main, tz = night.timeZone
        VStack(alignment: .leading, spacing: 6) {
            Text(hm(m.asleepMinutes)).font(.largeTitle.bold()).monospacedDigit()
            Text("estimated asleep").font(.caption).foregroundStyle(.secondary)
            HStack {
                Label(SleepAnalyzer.clock(m.start, tz), systemImage: "moon.zzz")
                Image(systemName: "arrow.right")
                Label(m.isPartial ? "\(SleepAnalyzer.clock(m.end, tz)) (still asleep or watch stopped)" : SleepAnalyzer.clock(m.end, tz), systemImage: "sun.max")
            }
            .font(.headline)
            if tz.identifier != current.identifier {
                Text("Times in \(tz.identifier), where this iPhone was that night.").font(.caption).foregroundStyle(.secondary)
            }
            Text("Light: \(hm(m.lightMinutes)) · Deep: \(hm(m.deepMinutes)) · Awake in between: \(hm(m.awakeMinutes))")
                .font(.footnote)
            Text("Light and deep are Sleep Log's movement-based estimates, not clinical sleep stages.")
                .font(.caption2).foregroundStyle(.secondary)
            if m.bridgedMinutes > 0 {
                Text("Includes \(m.bridgedMinutes) min where Sleep Log recorded \"unknown\" between two sleep entries (counted as asleep).")
                    .font(.caption2).foregroundStyle(.orange)
            }
            if m.startsAtDataStart { Text("The data starts mid-sleep; the real bedtime may be earlier.").font(.caption2).foregroundStyle(.orange) }
            if !night.naps.isEmpty { Text("Plus \(night.naps.count) nap\(night.naps.count == 1 ? "" : "s"): \(hm(night.napMinutes))").font(.footnote) }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Settings

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var importingSleep = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Demo mode", isOn: Binding(get: { model.demoMode }, set: { model.setDemoMode($0) }))
                } footer: {
                    Text("Demo mode uses a simulated watch and separate sample data, so you can try every screen now. Your real data is kept apart and untouched.")
                }
                Section("Data on this iPhone") {
                    ShareLink("Export set history (CSV)", item: SetHistoryCSV(sets: model.allSets), preview: SharePreview("Set history (CSV)"))
                    Button("Import a Sleep Log file") { importingSleep = true }
                    Text("For sleeplog.log or sleeplog_NNNN.log downloaded with the Espruino Web IDE. Normal syncing does this over Bluetooth.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Not yet tested on real hardware") {
                    ForEach(["Bluetooth pairing with a Bangle.js 2", "Overnight Sleep Log recording and morning sync",
                             "Rest-timer vibration on the watch",
                             "Background reconnection with the app closed"], id: \.self) { item in
                        Label(item, systemImage: "hourglass")
                    }
                }
                Section("About") {
                    LabeledContent("Sync protocol", value: "v\(SyncProtocol.version)")
                    LabeledContent("Sleep Log supported", value: "0.26")
                    LabeledContent("Watch firmware targeted", value: "2v29")
                    Text("Standalone: no account, no cloud, no Apple Health. Workouts, sets and sleep come straight from the watch and stay on this iPhone.").font(.footnote)
                }
            }
            .navigationTitle("Settings")
            .fileImporter(isPresented: $importingSleep, allowedContentTypes: [.data, .plainText, .json], allowsMultipleSelection: false) { r in
                if case .success(let urls) = r, let u = urls.first { model.importSleepFile(from: u) }
            }
        }
    }
}
