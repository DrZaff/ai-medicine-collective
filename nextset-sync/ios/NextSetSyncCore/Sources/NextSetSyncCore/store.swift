import Foundation

/// What the phone remembers about its watch.
public struct LinkState: Codable, Equatable, Sendable {
    /// Random id for this iPhone install, sent in `hello`.
    public var phoneId: String
    /// CoreBluetooth's identifier for the watch (stable for this phone).
    public var peripheralId: String?
    public var watchName: String?
    public var watchId: String?
    /// Shared secret from pairing. Stored in the app's container on this phone only.
    public var key: String?
    public var autoConnect: Bool
    public var lastSync: Date?
    public var lastSyncSummary: String?
    public var lastError: String?
    public var watchStatus: WatchStatus?
    /// Sleep Log time (10-minute steps) imported up to.
    public var sleepCursorT10: Int?
    public var sentWorkoutId: String?
    public var sentWorkoutRev: Int?

    public init(phoneId: String = UUID().uuidString) {
        self.phoneId = phoneId; autoConnect = true
    }
    public var isPaired: Bool { key != nil && peripheralId != nil }
}

/// The watch's last `status` answer, kept so the app can show it offline.
public struct WatchStatus: Codable, Equatable, Sendable {
    public var at: Date
    public var pendingRecords: Int
    public var pendingSets: Int
    public var pendingMarkers: Int?
    public var activeSession: String?
    public var loadedWorkout: String?
    public var battery: Int?
    public var firmware: String?
    public var appVersion: String?
    public var sleepLogVersion: String?
    public var sleepLogEnabled: Bool?
}

/// One Sleep Log transition: from `t10` (UTC ms / 600 000) the state is `status`.
public struct SleepEntry: Codable, Hashable, Sendable {
    public var t10: Int
    public var status: Int
    public var consec: Int
    public init(t10: Int, status: Int, consec: Int) { self.t10 = t10; self.status = status; self.consec = consec }
    public var date: Date { Date(timeIntervalSince1970: TimeInterval(t10) * 600) }
}

/// Time zone the phone was in from `at` onwards (recorded at launch and every sync).
public struct ZoneMark: Codable, Hashable, Sendable {
    public var at: Date
    public var zone: String
}

public struct UpsertResult: Equatable, Sendable {
    public var insertedSets = 0, insertedSessions = 0, insertedMarkers = 0, updated = 0, duplicates = 0, stale = 0
    /// Records of a kind this build does not store: NOT acknowledged, so the watch keeps them.
    public var skippedUnknown = 0
    /// What to acknowledge: every received record, at the rev received.
    public var acks: [WireAck] = []
}

public struct SleepImportResult: Equatable, Sendable {
    public var added = 0, changed = 0, unchanged = 0
}

/// Local storage: JSON files written atomically (write to a temporary file,
/// then rename), so a crash or a killed app never leaves half a file. An
/// acknowledgment is only sent to the watch after the write returns.
public final class LocalStore: @unchecked Sendable {
    public let directory: URL
    private let lock = NSLock()

    private struct Records: Codable { var sets: [String: SetRecord] = [:]; var sessions: [String: SessionRecord] = [:] }
    private struct Sleep: Codable { var entries: [SleepEntry] = []; var dataEndT10: Int?; var imports: Int = 0 }
    private struct State: Codable {
        var link = LinkState()
        var zones: [ZoneMark] = []
    }

    private var records = Records()
    private var sleepData = Sleep()
    private var sleepIndex: [Int: SleepEntry] = [:]
    private var state = State()
    private var workoutList: [Workout] = []
    private var markerIndex: [String: MarkerRecord] = [:]
    /// Notes you add on the iPhone, by marker id. Never sent to the watch and
    /// never touched by a re-import.
    private var notes: [String: String] = [:]

    public init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        records = try load("records.json") ?? Records()
        sleepData = try load("sleep.json") ?? Sleep()
        sleepIndex = Dictionary(sleepData.entries.map { ($0.t10, $0) }, uniquingKeysWith: { _, b in b })
        if let s: State = try load("state.json") { state = s } else { try save(state, "state.json") }
        workoutList = try load("workouts.json") ?? []
        markerIndex = try load("markers.json") ?? [:]
        notes = try load("notes.json") ?? [:]
    }

    private func url(_ name: String) -> URL { directory.appendingPathComponent(name) }

    private func load<T: Decodable>(_ name: String) throws -> T? {
        guard FileManager.default.fileExists(atPath: url(name).path) else { return nil }
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .millisecondsSince1970
        return try dec.decode(T.self, from: Data(contentsOf: url(name)))
    }

    private func save<T: Encodable>(_ value: T, _ name: String) throws {
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .millisecondsSince1970
        enc.outputFormatting = [.sortedKeys]
        let data = try enc.encode(value)
        #if os(iOS)
        // Readable after first unlock, so a background reconnect can save while the phone is locked.
        try data.write(to: url(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url(name), options: [.atomic])
        #endif
    }

    private func locked<T>(_ body: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try body() }

    // MARK: link state

    public var link: LinkState { locked { state.link } }
    public func updateLink(_ change: (inout LinkState) -> Void) throws {
        try locked { change(&state.link); try save(state, "state.json") }
    }

    // MARK: workouts

    public var workouts: [Workout] { locked { workoutList } }
    public func saveWorkout(_ w: Workout) throws {
        try w.validate()
        try locked {
            if let i = workoutList.firstIndex(where: { $0.id == w.id }) {
                var copy = w
                if copy != workoutList[i] { copy.rev = Swift.max(w.rev, workoutList[i].rev + 1); copy.updatedAt = Date() }
                workoutList[i] = copy
            } else { workoutList.append(w) }
            try save(workoutList, "workouts.json")
        }
    }
    public func deleteWorkout(id: String) throws {
        try locked { workoutList.removeAll { $0.id == id }; try save(workoutList, "workouts.json") }
    }

    // MARK: records from the watch

    /// Stores records durably. Same id + same rev is a duplicate (counted, not
    /// stored twice); a higher rev replaces the stored copy (an edit on the
    /// watch); a lower rev is stale and ignored. Every record is acknowledged
    /// at the rev received, because the watch only deletes a record whose rev
    /// is at most the acknowledged one.
    public func upsert(_ incoming: [WireRecord], isDemo: Bool = false, now: Date = Date()) throws -> UpsertResult {
        try locked {
            var r = UpsertResult()
            var markersChanged = false
            for w in incoming {
                // Acknowledge only kinds this build stores; the watch keeps the rest.
                guard SyncProtocol.storedKinds.contains(w.k) else { r.skippedUnknown += 1; continue }
                r.acks.append(WireAck(id: w.id, rev: w.rev))
                if w.k == "mark" {
                    if let old = markerIndex[w.id] {
                        if old.rev == w.rev { r.duplicates += 1; continue }
                        if old.rev > w.rev { r.stale += 1; continue }
                        r.updated += 1
                    } else { r.insertedMarkers += 1 }
                    markerIndex[w.id] = MarkerRecord(id: w.id, rev: w.rev, label: w.label ?? "Marker",
                                                     at: Date(timeIntervalSince1970: w.at / 1000), deleted: (w.del ?? 0) != 0,
                                                     receivedAt: now, ackState: .awaitingWatchAck, isDemo: isDemo)
                    markersChanged = true
                    continue
                }
                if w.k == "ses" {
                    let s = SessionRecord(id: w.id, rev: w.rev, workoutId: w.wid ?? "", workoutName: w.wn ?? "Workout",
                                          units: Units(rawValue: w.units ?? "lb") ?? .lb,
                                          start: Date(timeIntervalSince1970: (w.start ?? w.at) / 1000),
                                          end: Date(timeIntervalSince1970: (w.end ?? w.at) / 1000),
                                          setCount: w.n ?? 0, receivedAt: now, ackState: .awaitingWatchAck, isDemo: isDemo)
                    if let old = records.sessions[w.id], old.rev >= w.rev { r.duplicates += 1; continue }
                    records.sessions[w.id] = s; r.insertedSessions += 1
                    continue
                }
                guard w.k == "set" else { continue }
                let rec = SetRecord(
                    id: w.id, rev: w.rev, sessionId: w.sid ?? "", workoutId: w.wid ?? "", workoutName: w.wn ?? "Workout",
                    exerciseIndex: w.xi ?? 0, exerciseId: w.xid ?? "", exerciseName: w.xn ?? "Exercise",
                    setNumber: w.set ?? 1, load: w.load ?? 0, units: Units(rawValue: w.units ?? "lb") ?? .lb,
                    reps: w.reps ?? 0, rir: w.rir ?? 0, loggedAt: Date(timeIntervalSince1970: w.at / 1000),
                    editedAt: w.ed.map { Date(timeIntervalSince1970: $0 / 1000) }, deleted: (w.del ?? 0) != 0,
                    receivedAt: now, ackState: .awaitingWatchAck, isDemo: isDemo)
                if let old = records.sets[w.id] {
                    if old.rev == w.rev { r.duplicates += 1; continue }
                    if old.rev > w.rev { r.stale += 1; continue }
                    records.sets[w.id] = rec; r.updated += 1
                } else {
                    records.sets[w.id] = rec; r.insertedSets += 1
                }
            }
            try save(records, "records.json")
            if markersChanged { try save(markerIndex, "markers.json") }
            return r
        }
    }

    /// The watch confirmed it removed these records.
    public func markConfirmed(_ acks: [WireAck]) throws {
        try locked {
            for a in acks {
                if var s = records.sets[a.id], s.rev <= a.rev { s.ackState = .confirmed; records.sets[a.id] = s }
                if var s = records.sessions[a.id], s.rev <= a.rev { s.ackState = .confirmed; records.sessions[a.id] = s }
                if var m = markerIndex[a.id], m.rev <= a.rev { m.ackState = .confirmed; markerIndex[a.id] = m }
            }
            try save(records, "records.json")
            try save(markerIndex, "markers.json")
        }
    }

    public var sets: [SetRecord] {
        locked { records.sets.values.sorted { ($0.loggedAt, $0.id) < ($1.loggedAt, $1.id) } }
    }
    public var sessionRecords: [SessionRecord] { locked { Array(records.sessions.values) } }

    /// Sessions, newest first. Deleted sets are left out.
    public var sessions: [SessionSummary] {
        let all = sets.filter { !$0.deleted }
        let ends = locked { records.sessions }
        var groups: [String: [SetRecord]] = [:]
        for s in all { groups[s.sessionId, default: []].append(s) }
        for id in ends.keys where groups[id] == nil { groups[id] = [] }
        return groups.map { id, sets in
            let ordered = sets.sorted { ($0.exerciseIndex, $0.setNumber) < ($1.exerciseIndex, $1.setNumber) }
            let end = ends[id]
            return SessionSummary(id: id, workoutName: end?.workoutName ?? sets.first?.workoutName ?? "Workout",
                                  start: end?.start ?? sets.map(\.loggedAt).min() ?? Date(),
                                  end: end?.end ?? sets.map(\.loggedAt).max(), finished: end != nil, sets: ordered)
        }.sorted { $0.start > $1.start }
    }

    /// Markers, newest first (deleted ones left out).
    public var markers: [MarkerRecord] {
        locked { markerIndex.values.filter { !$0.deleted }.sorted { $0.at > $1.at } }
    }
    public func note(for markerId: String) -> String? { locked { notes[markerId] } }
    public func setNote(_ text: String?, for markerId: String) throws {
        try locked {
            let t = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            notes[markerId] = t.isEmpty ? nil : t
            try save(notes, "notes.json")
        }
    }

    public var awaitingAckCount: Int { locked { records.sets.values.filter { $0.ackState == .awaitingWatchAck }.count } }

    // MARK: sleep

    /// Merges Sleep Log transitions. Re-importing the same night changes nothing;
    /// a transition whose state changed (Sleep Log back-fills "consecutive") is updated.
    @discardableResult
    public func importSleep(_ entries: [SleepEntry], dataEndT10: Int?) throws -> SleepImportResult {
        try locked {
            var r = SleepImportResult()
            for e in entries {
                if let old = sleepIndex[e.t10] {
                    if old == e { r.unchanged += 1 } else { sleepIndex[e.t10] = e; r.changed += 1 }
                } else { sleepIndex[e.t10] = e; r.added += 1 }
            }
            if let end = dataEndT10 { sleepData.dataEndT10 = Swift.max(sleepData.dataEndT10 ?? 0, end) }
            sleepData.entries = sleepIndex.values.sorted { $0.t10 < $1.t10 }
            sleepData.imports += 1
            try save(sleepData, "sleep.json")
            return r
        }
    }
    public var sleepEntries: [SleepEntry] { locked { sleepData.entries } }
    public func hasSleepEntry(at t10: Int) -> Bool { locked { sleepIndex[t10] != nil } }
    public var sleepDataEndT10: Int? { locked { sleepData.dataEndT10 } }

    // MARK: time zones

    public var zones: [ZoneMark] { locked { state.zones } }
    /// Notes the current zone if it differs from the last one noted.
    public func recordZone(_ zone: TimeZone = .current, at: Date = Date()) throws {
        try locked {
            if state.zones.last?.zone == zone.identifier { return }
            state.zones.append(ZoneMark(at: at, zone: zone.identifier))
            try save(state, "state.json")
        }
    }

    /// Erases everything in this store's folder.
    public func eraseAll() throws {
        try locked {
            for name in ["records.json", "sleep.json", "state.json", "workouts.json", "markers.json", "notes.json"] {
                try? FileManager.default.removeItem(at: url(name))
            }
            records = Records(); sleepData = Sleep(); sleepIndex = [:]; state = State(); workoutList = []
            markerIndex = [:]; notes = [:]
            try save(state, "state.json")
        }
    }
}
