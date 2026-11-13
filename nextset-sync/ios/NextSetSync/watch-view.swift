import NextSetSyncCore
import SwiftUI

@main
struct NextSetSyncApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            TabView {
                TodayView().tabItem { Label("Today", systemImage: "sun.max") }
                WatchView().tabItem { Label("Watch", systemImage: "applewatch.radiowaves.left.and.right") }
                WorkoutsView().tabItem { Label("Workouts", systemImage: "dumbbell") }
                HistoryView().tabItem { Label("History", systemImage: "list.bullet.rectangle") }
                SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .environment(model)
            .alert("Something needs attention", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(model.errorMessage ?? "") }
            .alert("Done", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(model.notice ?? "") }
            .onChange(of: phase) { _, p in if p == .active { try? model.store.recordZone() } }
        }
    }
}

struct WatchView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                if model.demoMode {
                    Section {
                        Label("Demo mode: a simulated watch with sample data. Turn it off in Settings when your Bangle.js 2 arrives.",
                              systemImage: "theatermasks")
                            .font(.footnote)
                    }
                }
                statusSection
                if !model.link.isPaired || model.link.key == nil { pairingSection } else { syncSection }
                if model.demoMode { demoSection }
                if !model.activity.isEmpty {
                    Section("Activity") {
                        ForEach(Array(model.activity.prefix(30).enumerated()), id: \.offset) { _, line in
                            Text(line).font(.caption.monospaced())
                        }
                    }
                }
            }
            .navigationTitle("Watch")
        }
    }

    private var statusSection: some View {
        Section {
            HStack {
                Image(systemName: model.connection.isLinked ? "checkmark.circle.fill" : "circle.dashed")
                    .foregroundStyle(model.connection.isLinked ? Color.green : Color.secondary)
                VStack(alignment: .leading) {
                    Text(model.link.watchName ?? "Bangle.js 2").font(.headline)
                    Text(model.connection.label).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                if case .syncing = model.connection { ProgressView() }
            }
            if let s = model.link.watchStatus {
                LabeledContent("Battery", value: s.battery.map { "\($0)%" } ?? "-")
                LabeledContent("Watch app / firmware", value: "\(s.appVersion ?? "?") / \(s.firmware ?? "?")")
                LabeledContent("Sleep Log", value: s.sleepLogVersion.map { "\($0)\(s.sleepLogEnabled == false ? " (off)" : "")" } ?? "not installed")
                if let w = s.loadedWorkout { LabeledContent("Workout on watch", value: w) }
                if let a = s.activeSession { LabeledContent("In progress", value: a) }
            }
        }
    }

    private var pairingSection: some View {
        Section {
            if model.connection.isLinked && model.link.key == nil {
                Text("On the watch: open NextSet Sync and choose Pair phone. Then tap Pair below and confirm the code on the watch.")
                    .font(.callout)
                if let code = model.pairingCode {
                    LabeledContent("Code", value: code).font(.title2.monospacedDigit())
                }
                Button("Pair Watch") { Task { await model.pair() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.pairingCode != nil)
            } else {
                Text("Bring the Bangle.js 2 close, make sure the App Loader on your computer is disconnected (the watch takes one connection at a time), then search.")
                    .font(.callout)
                Button(model.connection == .searching ? "Searching..." : "Search for watches") { model.startScan() }
                ForEach(model.discovered) { w in
                    Button { model.choose(w) } label: {
                        HStack { Text(w.name); Spacer(); Text("\(w.rssi) dBm").foregroundStyle(.secondary) }
                    }
                }
            }
        } header: { Text("Pair a watch") }
    }

    private var syncSection: some View {
        Section {
            Button {
                Task { await model.syncNow() }
            } label: {
                Label("Sync Now", systemImage: "arrow.triangle.2.circlepath").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!model.canSync)
            LabeledContent("Last sync", value: model.link.lastSync.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Never")
            if let s = model.link.lastSyncSummary { Text(s).font(.footnote).foregroundStyle(.secondary) }
            LabeledContent("Waiting on the watch") {
                if let st = model.link.watchStatus {
                    Text("\(st.pendingSets) sets (as of \(st.at.formatted(date: .omitted, time: .shortened)))")
                } else { Text("unknown until connected") }
            }
            LabeledContent("Saved here, awaiting watch confirmation", value: "\(model.awaitingAck)")
            if model.link.autoConnect {
                Button("Disconnect (use the App Loader)") { model.disconnectAndPause() }
            } else {
                Button("Reconnect automatically") { model.resumeAutoConnect() }
            }
            Button("Forget this watch", role: .destructive) { Task { await model.forgetWatch() } }
        } header: { Text("Sync") } footer: {
            Text("The iPhone reconnects by itself whenever the watch is in range and syncs straight away. Sets stay on the watch until this iPhone has saved them and the watch has confirmed.")
        }
    }

    private var demoSection: some View {
        Section("Try it (simulated watch)") {
            Button("Log a set on the watch") { Task { await model.demoLogSet() } }
            Button("Finish the workout on the watch") { Task { await model.demoFinishWorkout() } }
            Button("Mark a moment on the watch") { Task { await model.demoMark() } }
            if model.connection.isLinked {
                Button("Walk away (disconnect)") { Task { await model.demoDisconnect() } }
            } else {
                Button("Come back (reconnect and sync)") { Task { await model.demoReconnect() } }
            }
            Button("Reset demo data", role: .destructive) { model.resetDemo() }
        }
    }
}
