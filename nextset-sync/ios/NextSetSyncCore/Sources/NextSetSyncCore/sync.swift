import Foundation

/// A byte pipe to the watch. CoreBluetooth on the phone, a simulated watch
/// in demo mode and tests. Incoming notifications go to `SyncEngine.receive`.
public protocol WatchLink: AnyObject, Sendable {
    /// Largest write the link accepts (negotiated MTU - 3, at most 128).
    var chunkSize: Int { get }
    /// Writes one chunk and returns once the watch has received it.
    func write(_ chunk: Data) async throws
}

public struct SyncReport: Equatable, Sendable {
    public var at = Date()
    public var newSets = 0, updatedSets = 0, duplicateRecords = 0, sessionsFinished = 0, newMarkers = 0
    public var sleepAdded = 0, sleepChanged = 0, sleepUnchanged = 0
    public var newCheckins = 0, healthRowsAdded = 0
    public var healthSkippedReason: String?
    public var leftOnWatch = 0
    public var sleepLogVersion: String?
    public var sleepSkippedReason: String?

    public var summary: String {
        var parts: [String] = []
        parts.append(newSets == 1 ? "1 new set" : "\(newSets) new sets")
        if updatedSets > 0 { parts.append("\(updatedSets) edited") }
        if duplicateRecords > 0 { parts.append("\(duplicateRecords) already here") }
        if newCheckins > 0 { parts.append(newCheckins == 1 ? "1 check-in" : "\(newCheckins) check-ins") }
        if healthRowsAdded > 0 { parts.append("heart rate: \(healthRowsAdded) new readings") }
        if newMarkers > 0 { parts.append(newMarkers == 1 ? "1 marker" : "\(newMarkers) markers") }
        if sessionsFinished > 0 { parts.append("\(sessionsFinished) workout\(sessionsFinished == 1 ? "" : "s") finished") }
        if let r = sleepSkippedReason { parts.append("sleep: \(r)") }
        else { parts.append("sleep: \(sleepAdded) new, \(sleepChanged) updated entries") }
        if leftOnWatch > 0 { parts.append("\(leftOnWatch) still on watch") }
        return parts.joined(separator: " · ")
    }
}

public struct HelloInfo: Equatable, Sendable {
    public var watchId: String
    public var paired: Bool
    public var appVersion: String?
    public var firmware: String?
    public var sleepLog: WireMessage.SleepLogInfo?
    public var healthLog: WireMessage.HealthLogInfo?
}

/// Runs protocol v1 against one connected watch. Create one per connection.
public actor SyncEngine {
    public let store: LocalStore
    public let link: WatchLink
    public let phoneName: String
    public let isDemo: Bool
    private let logger: @Sendable (String) -> Void
    private let clock: @Sendable () -> Date

    private var assembler = FrameAssembler()
    private var seq = 0
    private var waiting: [Int: CheckedContinuation<WireMessage, Error>] = [:]
    private var nonce: String?
    private var hello: HelloInfo?
    private var authed = false
    private var dropped = false
    private var busy = false
    private var queue: [CheckedContinuation<Void, Never>] = []

    public var requestTimeout: Double = 15
    public var pairTimeout: Double = 120

    public init(store: LocalStore, link: WatchLink, phoneName: String, isDemo: Bool = false,
                clock: @escaping @Sendable () -> Date = { Date() },
                logger: @escaping @Sendable (String) -> Void = { _ in }) {
        self.store = store; self.link = link; self.phoneName = phoneName; self.isDemo = isDemo
        self.clock = clock; self.logger = logger
    }

    public func setTimeouts(request: Double, pair: Double) { requestTimeout = request; pairTimeout = pair }

    // MARK: transport events

    /// One notification from the watch.
    public func receive(_ chunk: Data) {
        for line in assembler.feed(chunk) {
            do {
                let m = try Framing.decode(line: line)
                if let q = m.q, let c = waiting.removeValue(forKey: q) { c.resume(returning: m) }
                else { logger("ignored unsolicited \(m.t) q=\(m.q.map(String.init) ?? "-")") }
            } catch {
                logger("dropped a damaged frame: \(error.localizedDescription)")
            }
        }
    }

    /// The connection is gone: fail whatever is waiting. Nothing is lost:
    /// records stay on the watch until acknowledged.
    public func linkDropped() {
        dropped = true
        assembler.reset()
        authed = false
        let w = waiting; waiting = [:]
        for (_, c) in w { c.resume(throwing: WireError.notConnected) }
    }

    // MARK: request plumbing

    private func exclusive<T>(_ body: () async throws -> T) async throws -> T {
        if busy { await withCheckedContinuation { queue.append($0) } }
        busy = true
        defer {
            if queue.isEmpty { busy = false } else { queue.removeFirst().resume() }
        }
        return try await body()
    }

    private func request(_ message: WireMessage, timeout: Double? = nil) async throws -> WireMessage {
        if dropped { throw WireError.notConnected }
        seq += 1
        let q = seq
        var m = message
        m.q = q
        let frame = try Framing.frame(m)
        let limit = timeout ?? requestTimeout
        let reply: WireMessage = try await withCheckedThrowingContinuation { cont in
            waiting[q] = cont
            Task {
                do {
                    for c in Framing.chunks(frame, size: link.chunkSize) { try await link.write(c) }
                } catch {
                    self.fail(q, error)
                    return
                }
                try? await Task.sleep(nanoseconds: UInt64(limit * 1_000_000_000))
                self.fail(q, WireError.timeout(m.t))
            }
        }
        if reply.t == "err" { throw WireError.watch(code: reply.code ?? "error", re: reply.re) }
        return reply
    }

    private func fail(_ q: Int, _ error: Error) {
        if let c = waiting.removeValue(forKey: q) { c.resume(throwing: error) }
    }

    // MARK: steps

    @discardableResult
    public func sayHello() async throws -> HelloInfo {
        var m = WireMessage(t: "hello")
        m.v = SyncProtocol.version
        m.phone = store.link.phoneId
        m.mtu = link.chunkSize
        m.kinds = SyncProtocol.storedKinds
        let r = try await request(m)
        guard r.t == "hi", let wid = r.watch else { throw WireError.unexpected("Unexpected reply to hello: \(r.t)") }
        if let min = r.min, min > SyncProtocol.version { throw WireError.protocolMismatch(min) }
        nonce = r.nonce
        authed = false
        let h = HelloInfo(watchId: wid, paired: r.paired ?? false, appVersion: r.app, firmware: r.fw, sleepLog: r.sl, healthLog: r.hl)
        hello = h
        logger("hello: watch \(wid), app \(r.app ?? "?"), firmware \(r.fw ?? "?"), paired \(h.paired)")
        return h
    }

    /// Pairs with the watch. The user must confirm `code` on the watch.
    public func pair(code: String) async throws {
        try await exclusive {
            let h = try await sayHello()
            var m = WireMessage(t: "pair")
            m.phone = store.link.phoneId; m.name = WireText.ascii(phoneName, limit: 20); m.code = code
            let r = try await request(m, timeout: pairTimeout)
            guard r.t == "paired", let key = r.key, key.count == 32 else { throw WireError.unexpected("Pairing failed.") }
            try store.updateLink { $0.key = key; $0.watchId = r.watch ?? h.watchId; $0.lastError = nil }
            authed = true
            logger("paired with watch \(h.watchId)")
            try await setTime()
        }
    }

    private func ensureAuthed() async throws {
        if authed { return }
        let h = try await sayHello()
        guard h.paired, let key = store.link.key, let nonce else { throw WireError.watch(code: "unauthorized", re: "auth") }
        if let known = store.link.watchId, known != h.watchId {
            throw WireError.unexpected("This is a different watch (\(h.watchId)) from the paired one (\(known)). Pair again.")
        }
        var m = WireMessage(t: "auth")
        m.proof = pairingProof(key: key, nonce: nonce, phoneId: store.link.phoneId)
        self.nonce = nil
        _ = try await request(m)
        authed = true
        try await setTime()
    }

    private func setTime() async throws {
        var m = WireMessage(t: "time")
        m.ms = (clock().timeIntervalSince1970 * 1000).rounded()
        m.tz = TimeZone.current.secondsFromGMT(for: clock()) / 60
        _ = try await request(m)
    }

    public func fetchStatus() async throws -> WatchStatus {
        try await exclusive { try await statusStep() }
    }

    private func statusStep() async throws -> WatchStatus {
        try await ensureAuthed()
        let r = try await request(WireMessage(t: "status"))
        let s = WatchStatus(at: clock(), pendingRecords: (r.pend ?? 0) + (r.pendMarks ?? 0), pendingSets: r.pendSets ?? 0,
                            pendingMarkers: r.pendMarks, healthAppVersion: hello?.healthLog?.ver,
                            heartRatePolling: hello?.healthLog?.hrm,
                            activeSession: r.ses.map { "\($0.wn ?? "Workout"): exercise \(($0.xi ?? 0) + 1), \($0.n ?? 0) sets" },
                            loadedWorkout: r.wkt?.name, battery: r.bat, firmware: hello?.firmware,
                            appVersion: hello?.appVersion, sleepLogVersion: r.sl?.ver, sleepLogEnabled: r.sl?.on)
        try store.updateLink { $0.watchStatus = s }
        return s
    }

    /// Sends a workout; returns after the watch confirms it is on flash.
    public func sendWorkout(_ w: Workout) async throws {
        try w.validate()
        try await exclusive {
            try await ensureAuthed()
            var m = WireMessage(t: "wput")
            m.w = WireWorkout(w)
            let r = try await request(m)
            guard r.t == "wack", r.id == w.id, (r.rev ?? 0) == w.rev else { throw WireError.unexpected("The watch did not confirm the workout.") }
            try store.updateLink { $0.sentWorkoutId = w.id; $0.sentWorkoutRev = w.rev }
            logger("workout \(w.name) rev \(w.rev) stored on the watch")
        }
    }

    /// Everything: sets and sessions, then Sleep Log, then status.
    public func syncAll() async throws -> SyncReport {
        try await exclusive {
            try await ensureAuthed()
            var report = SyncReport()
            report.at = clock()
            try await pullRecords(&report)
            try await pullSleep(&report)
            try await pullHealth(&report)
            let st = try await statusStep()
            report.leftOnWatch = st.pendingRecords
            try store.updateLink { $0.lastSync = report.at; $0.lastSyncSummary = report.summary; $0.lastError = nil }
            logger("sync done: \(report.summary)")
            return report
        }
    }

    private func pullRecords(_ report: inout SyncReport) async throws {
        var lastLeft = Int.max, stuck = 0
        for _ in 0..<500 {
            var m = WireMessage(t: "pull"); m.max = 8
            let r = try await request(m)
            let recs = r.recs ?? []
            if recs.isEmpty { return }
            // 1. durable write, 2. then acknowledge
            let result = try store.upsert(recs, isDemo: isDemo, now: clock())
            report.newSets += result.insertedSets
            report.newMarkers += result.insertedMarkers
            report.newCheckins += result.insertedCheckins
            report.sessionsFinished += result.insertedSessions
            report.updatedSets += result.updated
            report.duplicateRecords += result.duplicates + result.stale
            var a = WireMessage(t: "ack"); a.ids = result.acks
            let ar = try await request(a)
            try store.markConfirmed(result.acks)
            let left = ar.left ?? 0
            if left == 0 && !(r.more ?? false) { return }
            if left >= lastLeft { stuck += 1; if stuck > 3 { throw WireError.unexpected("The watch keeps sending the same records.") } }
            lastLeft = left
        }
    }

    private func pullSleep(_ report: inout SyncReport) async throws {
        guard let ver = hello?.sleepLog?.ver else { report.sleepSkippedReason = "Sleep Log not installed"; return }
        report.sleepLogVersion = ver
        let nowT10 = Int(clock().timeIntervalSince1970 / 600)
        // Re-read the last 24 h every time: Sleep Log decides "consecutive" afterwards.
        var since = Swift.max(0, (store.link.sleepCursorT10 ?? (nowT10 - 14 * 144)) - 144)
        var newest = store.link.sleepCursorT10 ?? 0
        for _ in 0..<100 {
            var m = WireMessage(t: "sleep"); m.since = since; m.max = 150
            let r = try await request(m)
            var entries = SleepLogParser.parseArray(r.entries ?? [])
            // Sleep Log's readLog starts every answer with a copy of the state in
            // force at `since`, stamped `since`. Unless that time is already
            // stored as a real transition, it is not one: skip it.
            if let first = entries.first, first.t10 == since, !store.hasSleepEntry(at: since) { entries.removeFirst() }
            let end = r.sl?.last.map { $0 + 1 } ?? r.now.map { Int($0) }
            let imp = try store.importSleep(entries, dataEndT10: end)
            report.sleepAdded += imp.added; report.sleepChanged += imp.changed; report.sleepUnchanged += imp.unchanged
            newest = Swift.max(newest, entries.map(\.t10).max() ?? 0)
            guard r.more == true, let last = entries.last?.t10, last > since else { break }
            since = last
        }
        if newest > 0 {
            var s = WireMessage(t: "sack"); s.upto = newest
            _ = try await request(s)
            try store.updateLink { $0.sleepCursorT10 = newest }
        }
    }

    /// Heart rate and steps from the BangleApps Health log, 10-minute rows.
    /// Re-reads the last hour each time (the newest slot can still change).
    private func pullHealth(_ report: inout SyncReport) async throws {
        guard let hl = hello?.healthLog, hl.ver != nil else { report.healthSkippedReason = "Health app not installed"; return }
        let nowT10 = Int(clock().timeIntervalSince1970 / 600)
        // First sync: 8 days (enough for a 7-night baseline); then from the cursor.
        var since = Swift.max(0, (store.link.healthCursorT10 ?? (nowT10 - 8 * 144)) - 6)
        var newest = store.link.healthCursorT10 ?? 0
        for _ in 0..<200 {
            var m = WireMessage(t: "health"); m.since = since; m.max = 144
            let r = try await request(m)
            let rows = (r.rows ?? []).compactMap(HealthRow.init)
            let imp = try store.importHealth(rows)
            report.healthRowsAdded += imp.added
            newest = Swift.max(newest, rows.map(\.t10).max() ?? 0)
            guard r.more == true, let last = rows.last?.t10, last > since else { break }
            since = last
        }
        if newest > 0 { try store.updateLink { $0.healthCursorT10 = newest } }
    }

    public func unpair() async throws {
        try await exclusive {
            try await ensureAuthed()
            _ = try await request(WireMessage(t: "unpair"))
            try store.updateLink { $0.key = nil; $0.watchId = nil; $0.peripheralId = nil; $0.watchName = nil }
        }
    }
}
