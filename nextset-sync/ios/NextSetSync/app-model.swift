import CoreBluetooth
import Foundation
import NextSetSyncCore
import Observation
import UIKit

enum ConnectionState: Equatable {
    case bluetoothOff(String)
    case notPaired
    case searching
    case waitingForWatch   // a connect() is pending; completes when the watch is in range
    case connecting
    case connected
    case syncing(String)

    var label: String {
        switch self {
        case .bluetoothOff(let why): return why
        case .notPaired: return "No watch paired"
        case .searching: return "Looking for watches..."
        case .waitingForWatch: return "Waiting for the watch (reconnects automatically)"
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .syncing(let what): return what
        }
    }
    var isLinked: Bool { if case .connected = self { return true }; if case .syncing = self { return true }; return false }
}

/// Everything the screens show and do. All on the main actor.
@MainActor @Observable
final class AppModel {
    private(set) var demoMode: Bool
    private(set) var store: LocalStore
    var connection: ConnectionState = .notPaired
    var discovered: [DiscoveredWatch] = []
    var pairingCode: String?
    var lastReport: SyncReport?
    var errorMessage: String?
    var notice: String?
    var activity: [String] = []
    /// Bumped after every change so lists recompute.
    private(set) var revision = 0

    @ObservationIgnored private let ble = BLEManager()
    @ObservationIgnored private var engine: SyncEngine?
    @ObservationIgnored private var demoWatch: SimulatedWatch?
    @ObservationIgnored let health = HealthExporter()
    @ObservationIgnored private var autoSyncTask: Task<Void, Never>?

    init() {
        let demo = UserDefaults.standard.bool(forKey: "demoMode")
        demoMode = demo
        store = AppModel.openStore(demo: demo)
        seedIfNeeded()
        try? store.recordZone()
        ble.onEvent = { [weak self] e in MainActor.assumeIsolated { self?.handle(e) } }
        if demo { Task { await startDemoWatch() } } else { reconnectIfPaired() }
    }

    static func folder(demo: Bool) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent(demo ? "NextSetSync-Demo" : "NextSetSync", isDirectory: true)
    }

    static func openStore(demo: Bool) -> LocalStore {
        do { return try LocalStore(directory: folder(demo: demo)) }
        catch { fatalError("Cannot open local storage: \(error)") }
    }

    private func seedIfNeeded() {
        for w in Samples.all where !store.workouts.contains(where: { $0.id == w.id }) { try? store.saveWorkout(w) }
        if demoMode && store.sets.isEmpty {
            if let r = try? store.upsert(DemoData.history(), isDemo: true) { try? store.markConfirmed(r.acks) }
            try? store.updateLink { $0.peripheralId = "DEMO"; $0.watchName = "Bangle.js demo"; $0.watchId = "d3m0a7c4" }
        }
        revision += 1
    }

    func log(_ s: String) {
        let f = DateFormatter(); f.timeStyle = .medium
        activity.insert("\(f.string(from: Date()))  \(s)", at: 0)
        if activity.count > 200 { activity.removeLast() }
    }

    // MARK: derived data

    var workouts: [Workout] { _ = revision; return store.workouts.sorted { ($0.source == .sample ? 0 : 1, $0.name) < ($1.source == .sample ? 0 : 1, $1.name) } }
    var sessions: [SessionSummary] { _ = revision; return store.sessions }
    var link: LinkState { _ = revision; return store.link }
    var awaitingAck: Int { _ = revision; return store.awaitingAckCount }
    var healthExportEnabled: Bool { _ = revision; return store.healthExportEnabled }
    var zones: ZoneHistory { ZoneHistory(store.zones) }
    var nights: [SleepNight] {
        _ = revision
        return SleepAnalyzer.nights(store.sleepEntries, dataEndT10: store.sleepDataEndT10, zones: zones)
    }

    // MARK: demo mode

    func setDemoMode(_ on: Bool) {
        guard on != demoMode else { return }
        autoSyncTask?.cancel()
        if !demoMode { ble.disconnect() }
        engine = nil; demoWatch = nil
        demoMode = on
        UserDefaults.standard.set(on, forKey: "demoMode")
        store = AppModel.openStore(demo: on)
        seedIfNeeded()
        try? store.recordZone()
        lastReport = nil; errorMessage = nil; activity = []
        if on { Task { await startDemoWatch() } } else { connection = .notPaired; reconnectIfPaired() }
    }

    func resetDemo() {
        guard demoMode else { return }
        try? store.eraseAll()
        demoWatch = nil; engine = nil
        seedIfNeeded()
        Task { await startDemoWatch() }
    }

    private func startDemoWatch() async {
        let w = SimulatedWatch(chunkSize: 128)
        demoWatch = w
        let demo = DemoData.sleep()
        await w.setSleep(demo.entries, lastCheckT10: demo.dataEndT10)
        let e = SyncEngine(store: store, link: w, phoneName: UIDevice.current.name, isDemo: true,
                           logger: { [weak self] s in Task { @MainActor in self?.log(s) } })
        await w.attach(deliver: { [e] d in await e.receive(d) }, dropped: { [e, weak self] in
            await e.linkDropped()
            await MainActor.run { self?.connection = .waitingForWatch }
        })
        engine = e
        connection = .connected
        if store.link.key == nil {
            do { try await e.pair(code: "0000") } catch { errorMessage = error.localizedDescription }
        }
        try? await e.sendWorkout(Samples.fullBodyA)
        // Three sets already logged on the "watch", waiting to sync.
        for i in 0..<3 { await w.logSet(exercise: 0, load: 50, reps: 10 - i, rir: Double(2 - min(i, 1)), at: Date().addingTimeInterval(Double(i * 150 - 900))) }
        _ = try? await e.fetchStatus()
        revision += 1
        log("Demo watch ready: 3 sets and a week of Sleep Log data waiting to sync.")
    }

    func demoLogSet() async {
        guard let w = demoWatch else { return }
        let loaded = await w.workout
        if loaded == nil { _ = try? await engine?.sendWorkout(Samples.fullBodyA) }
        let n = await w.pending.count
        await w.logSet(exercise: n % 3, load: 50 + Double(n) * 5, reps: 8 + n % 3, rir: 2)
        log("Demo: a set was logged on the watch\(connection == .connected ? "" : " while disconnected")")
        if connection == .connected { _ = try? await engine?.fetchStatus() }
        revision += 1
    }
    func demoFinishWorkout() async { await demoWatch?.finishSession(); log("Demo: workout finished on the watch") }
    func demoDisconnect() async { await demoWatch?.disconnect(); log("Demo: phone out of range") }
    func demoReconnect() async {
        guard let w = demoWatch else { return }
        await w.reconnect()
        let e = SyncEngine(store: store, link: w, phoneName: UIDevice.current.name, isDemo: true,
                           logger: { [weak self] s in Task { @MainActor in self?.log(s) } })
        await w.attach(deliver: { [e] d in await e.receive(d) }, dropped: { [e, weak self] in
            await e.linkDropped(); await MainActor.run { self?.connection = .waitingForWatch }
        })
        engine = e
        connection = .connected
        log("Demo: reconnected; syncing automatically")
        await syncNow()
    }

    // MARK: Bluetooth

    private func reconnectIfPaired() {
        guard !demoMode, let s = store.link.peripheralId, let id = UUID(uuidString: s), store.link.autoConnect else {
            connection = store.link.isPaired ? .waitingForWatch : .notPaired
            return
        }
        connection = .waitingForWatch
        ble.connect(id)
    }

    func startScan() {
        guard !demoMode else { return }
        discovered = []
        errorMessage = nil
        if ble.state != .poweredOn { connection = .bluetoothOff(bluetoothText(ble.state)); return }
        connection = .searching
        ble.startScan()
    }

    func choose(_ w: DiscoveredWatch) {
        ble.stopScan()
        try? store.updateLink { $0.peripheralId = w.id.uuidString; $0.watchName = w.name; $0.autoConnect = true }
        revision += 1
        connection = .connecting
        ble.connect(w.id)
    }

    /// Asks the watch to pair. The person confirms the same code on the watch.
    func pair() async {
        guard let engine else { errorMessage = "Connect to the watch first."; return }
        let code = String(format: "%04d", Int.random(in: 0...9999))
        pairingCode = code
        connection = .syncing("Confirm code \(code) on the watch...")
        do {
            try await engine.pair(code: code)
            log("Paired. Key stored on this iPhone.")
            pairingCode = nil
            connection = .connected
            revision += 1
            await syncNow()
        } catch {
            pairingCode = nil
            connection = .connected
            errorMessage = error.localizedDescription
        }
    }

    func disconnectAndPause() {
        try? store.updateLink { $0.autoConnect = false }
        ble.disconnect()
        engine = nil
        connection = .notPaired
        if store.link.isPaired { connection = .bluetoothOff("Paused: tap Reconnect when you want to sync") }
        revision += 1
    }

    func resumeAutoConnect() {
        try? store.updateLink { $0.autoConnect = true }
        revision += 1
        reconnectIfPaired()
    }

    func forgetWatch() async {
        if let engine, connection.isLinked { try? await engine.unpair() }
        ble.disconnect()
        try? store.updateLink { $0.key = nil; $0.peripheralId = nil; $0.watchName = nil; $0.watchId = nil; $0.watchStatus = nil }
        engine = nil
        connection = .notPaired
        revision += 1
    }

    private func bluetoothText(_ s: CBManagerState) -> String {
        switch s {
        case .poweredOff: return "Bluetooth is off"
        case .unauthorized: return "Bluetooth permission denied (Settings > NextSet Sync)"
        case .unsupported: return "This device has no Bluetooth LE"
        default: return "Bluetooth is starting..."
        }
    }

    private func handle(_ e: LinkEvent) {
        switch e {
        case .stateChanged(let s):
            if s != .poweredOn { connection = .bluetoothOff(bluetoothText(s)) }
            else if case .bluetoothOff = connection { reconnectIfPaired() }
        case .discovered(let w):
            if let i = discovered.firstIndex(where: { $0.id == w.id }) { discovered[i] = w } else { discovered.append(w) }
        case .connecting:
            connection = .connecting
        case .ready(let link, let name):
            let e = SyncEngine(store: store, link: link, phoneName: UIDevice.current.name,
                               logger: { [weak self] s in Task { @MainActor in self?.log(s) } })
            // Notifications are forwarded through one stream so they stay in order.
            let (stream, cont) = AsyncStream<Data>.makeStream()
            link.onData = { cont.yield($0) }
            link.onClosed = { cont.finish() }
            Task { for await d in stream { await e.receive(d) }; await e.linkDropped() }
            engine = e
            connection = .connected
            try? store.updateLink { $0.watchName = name }
            try? store.recordZone()
            log("Connected to \(name)")
            if store.link.key != nil {
                autoSyncTask = Task { await self.syncNow(automatic: true) }
            }
            revision += 1
        case .disconnected(_, let err):
            engine = nil
            connection = store.link.autoConnect && store.link.isPaired ? .waitingForWatch : .notPaired
            if let err { log("Disconnected: \(err.localizedDescription)") } else { log("Disconnected") }
        case .failed(let msg):
            errorMessage = msg
            log(msg)
        }
    }

    // MARK: sync

    var canSync: Bool { engine != nil && store.link.key != nil && connection == .connected }

    func syncNow(automatic: Bool = false) async {
        guard let engine else {
            if !automatic { errorMessage = demoMode ? "The demo watch is disconnected: tap Reconnect." : "The watch is not connected. Bring it close and wait for Connected." }
            return
        }
        connection = .syncing("Syncing...")
        // Keep going for a few seconds if the app goes to the background mid-sync.
        final class BackgroundTask { var id = UIBackgroundTaskIdentifier.invalid }
        let bg = BackgroundTask()
        bg.id = UIApplication.shared.beginBackgroundTask(withName: "sync") {
            UIApplication.shared.endBackgroundTask(bg.id); bg.id = .invalid
        }
        defer { if bg.id != .invalid { UIApplication.shared.endBackgroundTask(bg.id); bg.id = .invalid } }
        do {
            let r = try await engine.syncAll()
            lastReport = r
            errorMessage = nil
            if store.healthExportEnabled { await exportToHealth(quiet: true) }
        } catch {
            errorMessage = error.localizedDescription
            try? store.updateLink { $0.lastError = error.localizedDescription }
            log("Sync stopped: \(error.localizedDescription). Nothing is lost; the watch keeps unsynced records.")
        }
        if case .syncing = connection { connection = self.engine == nil ? .waitingForWatch : .connected }
        revision += 1
    }

    func send(_ w: Workout) async {
        guard let engine, store.link.key != nil else {
            errorMessage = store.link.key == nil ? "Pair the watch first (Watch tab)." : "Connect to the watch first."; return
        }
        connection = .syncing("Sending \(w.name)...")
        do {
            try await engine.sendWorkout(w)
            notice = "\(w.name) is on the watch. Open NextSet Sync there and choose Start."
        } catch { errorMessage = error.localizedDescription }
        connection = self.engine == nil ? .waitingForWatch : .connected
        revision += 1
    }

    // MARK: workouts and files

    func save(_ w: Workout) {
        do { try store.saveWorkout(w); revision += 1 } catch { errorMessage = error.localizedDescription }
    }
    func delete(_ w: Workout) { try? store.deleteWorkout(id: w.id); revision += 1 }

    func importWorkouts(from url: URL) {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        do {
            let ws = try WorkoutImporter.importFile(try Data(contentsOf: url), fileName: url.lastPathComponent)
            for w in ws { try store.saveWorkout(w) }
            notice = ws.count == 1 ? "Imported \(ws[0].name)." : "Imported \(ws.count) workouts."
            revision += 1
        } catch { errorMessage = error.localizedDescription }
    }

    /// Manual Sleep Log import: sleeplog.log or sleeplog_NNNN.log downloaded with the Web IDE.
    func importSleepFile(from url: URL) {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            let entries = try text.hasPrefix("[") ? SleepLogParser.parseArchive(data) : SleepLogParser.parseStorageFile(text)
            guard !entries.isEmpty else { throw WorkoutError.unreadable("No Sleep Log entries in that file.") }
            let r = try store.importSleep(entries, dataEndT10: nil)
            notice = "Sleep Log file: \(r.added) new, \(r.changed) updated, \(r.unchanged) already imported."
            revision += 1
        } catch { errorMessage = error.localizedDescription }
    }

    func csvFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("nextset-sync-sets-\(SleepAnalyzer.dayString(Date(), .current)).csv")
        try SetCSV.make(store.sets).write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func workoutFile(_ w: Workout) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(WorkoutImporter.slug(w.name)).nextset-workout.json")
        try WorkoutImporter.exportData(w).write(to: url)
        return url
    }

    // MARK: Apple Health

    func setHealthExport(_ on: Bool) async {
        if on && demoMode { notice = "Turn off demo mode to export your real sleep to Apple Health."; return }
        if on {
            do {
                try await health.requestPermission()
                store.healthExportEnabled = true
                await exportToHealth(quiet: false)
            } catch { errorMessage = error.localizedDescription }
        } else {
            store.healthExportEnabled = false
        }
        revision += 1
    }

    func exportToHealth(quiet: Bool) async {
        guard !demoMode else { if !quiet { notice = "Apple Health export is off in demo mode, so sample nights never reach Health." }; return }
        guard health.isAvailable else { if !quiet { errorMessage = "Apple Health is not available on this device." }; return }
        let watchId = store.link.watchId ?? "watch"
        let plan = store.healthLedger.plan(nights, watchId: watchId)
        if plan.isEmpty { if !quiet { notice = "Apple Health is up to date." }; return }
        do {
            let zones = self.zones
            let saved = try await health.export(plan, watchId: watchId, firmware: store.link.watchStatus?.firmware,
                                                sleepLogVersion: store.link.watchStatus?.sleepLogVersion ?? "0.26",
                                                zone: { zones.zone(at: $0) })
            try store.updateHealthLedger { $0.record(saved) }
            if !quiet { notice = "Wrote \(saved.count) sleep interval\(saved.count == 1 ? "" : "s") to Apple Health." }
            log("Apple Health: \(saved.count) asleep intervals written")
        } catch { if !quiet { errorMessage = error.localizedDescription }; log("Apple Health: \(error.localizedDescription)") }
        revision += 1
    }
}

extension LocalStore {
    /// Kept in UserDefaults per store folder; not part of the synced data.
    var healthExportEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "health." + directory.lastPathComponent) }
        set { UserDefaults.standard.set(newValue, forKey: "health." + directory.lastPathComponent) }
    }
}
