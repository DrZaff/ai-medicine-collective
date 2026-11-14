import Foundation

/// A watch in software that follows protocol v1 the way `watch/nsync/lib.js`
/// does. Demo mode uses it so every screen works before the Bangle arrives;
/// the tests use its fault switches to break transfers on purpose.
public actor SimulatedWatch: WatchLink {
    public nonisolated let chunkSize: Int
    public let watchId: String
    private var deliver: (@Sendable (Data) async -> Void)?
    private var dropped: (@Sendable () async -> Void)?

    // Flash-backed state (survives disconnects, like Storage on the watch).
    public private(set) var phones: [String: String] = [:]
    public private(set) var pending: [String: WireRecord] = [:]
    public private(set) var workout: WireWorkout?
    /// Markers made on the watch, and which of them the phone acknowledged.
    public private(set) var marks: [String: WireRecord] = [:]
    public private(set) var syncedMarks: Set<String> = []
    public var sleep: [SleepEntry] = []
    public var sleepLastCheckT10: Int?
    public var sleepLogVersion: String? = "0.26"
    public var healthLogVersion: String? = "0.44"
    public var health: [HealthRow] = []
    public private(set) var sleepAck = 0
    public private(set) var timeZoneMinutes: Int?
    public var confirmPairing = true
    private var sessionId: String?
    private var sessionStart: Date?
    private var setCounter: [Int: Int] = [:]

    // Per-connection state (reset on disconnect, like nsync.boot.js).
    private var assembler = FrameAssembler()
    private var pid: String?
    private var nonce: String?
    private var authed = false
    private var mtu = 20
    private var kinds = ["set", "ses"]
    public private(set) var connected = true

    // Fault switches.
    /// Send only the first half of the next response frame, then disconnect.
    public var truncateNextResponse = false
    /// Send the next response frame twice.
    public var duplicateNextResponse = false
    /// Disconnect right after receiving the next request of this type, without answering.
    public var dropOnRequest: String?
    /// Truncate the answer to the next request of this type.
    public var truncateOnRequest: String?
    public private(set) var requestLog: [String] = []

    public init(chunkSize: Int = 20, watchId: String = "d3m0a7c4") {
        self.chunkSize = chunkSize; self.watchId = watchId
    }

    public func attach(deliver: @escaping @Sendable (Data) async -> Void, dropped: @escaping @Sendable () async -> Void) {
        self.deliver = deliver; self.dropped = dropped
    }

    public func setFaults(truncate: Bool = false, duplicate: Bool = false, dropOn: String? = nil, truncateOn: String? = nil) {
        truncateNextResponse = truncate; duplicateNextResponse = duplicate; dropOnRequest = dropOn; truncateOnRequest = truncateOn
    }
    public func setSleep(_ entries: [SleepEntry], lastCheckT10: Int?) { sleep = entries; sleepLastCheckT10 = lastCheckT10 }
    public func setSleepLogVersion(_ v: String?) { sleepLogVersion = v }
    public func setHealth(_ rows: [HealthRow]) { health = rows.sorted { $0.t10 < $1.t10 } }

    // MARK: connection

    public func disconnect() async {
        guard connected else { return }
        connected = false
        outbox.removeAll()
        assembler.reset(); pid = nil; nonce = nil; authed = false; mtu = 20
        await dropped?()
    }
    public func reconnect() { connected = true }

    public func write(_ chunk: Data) async throws {
        guard connected else { throw WireError.notConnected }
        for line in assembler.feed(chunk) {
            guard let m = try? Framing.decode(line: line) else { await send(err("bad_frame", nil)); continue }
            requestLog.append(m.t)
            if dropOnRequest == m.t { dropOnRequest = nil; await disconnect(); return }
            if truncateOnRequest == m.t { truncateOnRequest = nil; truncateNextResponse = true }
            if var r = handle(m) { r.q = m.q; await send(r) }
        }
    }

    // Notifications leave strictly in order through one queue, like lib.js's
    // st.q; without it, actor reentrancy could interleave two frames.
    private var outbox: [Data?] = []   // nil = disconnect here
    private var pumping = false

    private func send(_ m: WireMessage) async {
        guard connected, let frame = try? Framing.frame(m) else { return }
        let chunks = Framing.chunks(frame, size: min(mtu, chunkSize))
        if truncateNextResponse {
            truncateNextResponse = false
            outbox += chunks.prefix(max(1, chunks.count / 2)).map { Optional($0) } + [nil]
        } else {
            outbox += chunks.map { Optional($0) }
            if duplicateNextResponse { duplicateNextResponse = false; outbox += chunks.map { Optional($0) } }
        }
        guard !pumping else { return }
        pumping = true
        while !outbox.isEmpty {
            let next = outbox.removeFirst()
            if let c = next { if connected { await deliver?(c) } } else { outbox.removeAll(); await disconnect() }
        }
        pumping = false
    }

    private func err(_ code: String, _ re: String?) -> WireMessage {
        var m = WireMessage(t: "err"); m.code = code; m.re = re; return m
    }

    private func randomHex(_ bytes: Int) -> String {
        (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    // MARK: protocol (mirrors lib.js `handle`)

    private func handle(_ m: WireMessage) -> WireMessage? {
        switch m.t {
        case "hello":
            pid = m.phone; mtu = max(20, min(128, m.mtu ?? 20)); authed = false; nonce = randomHex(8)
            kinds = (m.kinds ?? ["set", "ses"]).filter { ["set", "ses", "mark", "chk"].contains($0) }
            var r = WireMessage(t: "hi")
            r.v = 1; r.min = 1; r.watch = watchId; r.app = "0.02-sim"; r.fw = "2v29 (simulated)"; r.kinds = ["set", "ses", "mark", "chk"]
            r.hl = WireMessage.HealthLogInfo(ver: healthLogVersion, hrm: 10, utc: true)
            r.paired = pid.map { phones[$0] != nil } ?? false; r.nonce = nonce
            r.sl = WireMessage.SleepLogInfo(ver: sleepLogVersion, on: sleepLogVersion != nil, last: sleepLastCheckT10)
            return r
        case "pair":
            guard let p = pid, m.phone == p else { return err("hello_first", "pair") }
            guard confirmPairing else { return err("pair_refused", "pair") }
            let key = randomHex(16)
            phones[p] = key; authed = true
            var r = WireMessage(t: "paired"); r.key = key; r.watch = watchId
            return r
        case "auth":
            let n = nonce; nonce = nil
            guard let p = pid, let key = phones[p], let n, m.proof == pairingProof(key: key, nonce: n, phoneId: p) else {
                return err("auth_failed", "auth")
            }
            authed = true
            return WireMessage(t: "authok")
        default: break
        }
        guard authed else { return err("unauthorized", m.t) }
        switch m.t {
        case "time":
            timeZoneMinutes = m.tz
            var r = WireMessage(t: "ok"); r.re = "time"; return r
        case "status":
            var r = WireMessage(t: "st")
            r.pend = pending.count; r.pendSets = pending.values.filter { $0.k == "set" }.count
            r.pendMarks = marks.keys.filter { !syncedMarks.contains($0) }.count
            if let s = sessionId {
                r.ses = .init(sid: s, wn: workout?.name, xi: 0, sn: 1, n: setCounter.values.reduce(0, +), start: sessionStart.map { $0.timeIntervalSince1970 * 1000 })
            }
            r.wkt = workout.map { .init(id: $0.id, rev: $0.rev, name: $0.name) }
            r.sAck = sleepAck; r.bat = 87
            r.sl = WireMessage.SleepLogInfo(ver: sleepLogVersion, on: sleepLogVersion != nil, last: sleepLastCheckT10)
            return r
        case "wput":
            guard let w = m.w, !w.ex.isEmpty, w.ex.count <= 12, w.ex.allSatisfy({ (1...10).contains($0.sets) }) else {
                return err("bad_workout", "wput")
            }
            workout = w
            var r = WireMessage(t: "wack"); r.id = w.id; r.rev = w.rev; return r
        case "pull":
            var all = pending.values.filter { kinds.contains($0.k) }
            all += marks.values.filter { !syncedMarks.contains($0.id) && kinds.contains($0.k) }
            all.sort { ($0.at, $0.id) < ($1.at, $1.id) }
            let mx = max(1, min(20, m.max ?? 8))
            var r = WireMessage(t: "recs"); r.recs = Array(all.prefix(mx)); r.more = all.count > mx; r.total = all.count
            return r
        case "ack":
            var n = 0
            for a in m.ids ?? [] {
                if let rec = pending[a.id], rec.rev <= a.rev { pending[a.id] = nil; n += 1 }
                else if let mk = marks[a.id], mk.rev <= a.rev, !syncedMarks.contains(a.id) { syncedMarks.insert(a.id); n += 1 }
            }
            var left = pending.values.filter { kinds.contains($0.k) }.count
            left += marks.values.filter { !syncedMarks.contains($0.id) && kinds.contains($0.k) }.count
            var r = WireMessage(t: "acked"); r.n = n; r.left = left; return r
        case "sleep":
            guard sleepLogVersion != nil else { return err("no_sleeplog", "sleep") }
            let since = max(0, m.since ?? 0), mx = max(10, min(300, m.max ?? 150))
            // Sleep Log's readLog: entries after `since`, preceded by the one in force at `since`.
            let sorted = sleep.sorted { $0.t10 < $1.t10 }
            var rows: [[Int]] = []
            if let prev = sorted.last(where: { $0.t10 <= since }) { rows.append([since, prev.status, prev.consec]) }
            rows += sorted.filter { $0.t10 > since }.map { [$0.t10, $0.status, $0.consec] }
            var r = WireMessage(t: "slp")
            r.since = since; r.entries = Array(rows.prefix(mx)); r.more = rows.count > mx
            r.now = Double(sleepLastCheckT10 ?? 0)
            r.sl = WireMessage.SleepLogInfo(ver: sleepLogVersion, on: true, last: sleepLastCheckT10)
            return r
        case "health":
            guard healthLogVersion != nil else { return err("no_health", "health") }
            let since = m.since ?? 0, mx = max(10, min(300, m.max ?? 144))
            let after = health.filter { $0.t10 > since }
            var r = WireMessage(t: "hlt")
            r.rows = after.prefix(mx).map { [$0.t10, $0.steps, $0.bpmMin, $0.bpmMax, $0.movement, $0.activity] }
            r.more = after.count > mx
            r.hl = WireMessage.HealthLogInfo(ver: healthLogVersion, hrm: 10, utc: true)
            return r
        case "sack":
            sleepAck = max(sleepAck, m.upto ?? 0)
            var r = WireMessage(t: "ok"); r.re = "sack"; return r
        case "unpair":
            if let p = pid { phones[p] = nil }
            authed = false
            var r = WireMessage(t: "ok"); r.re = "unpair"; return r
        default:
            return err("unknown", m.t)
        }
    }

    // MARK: what the person does on the watch (demo buttons and tests)

    /// Logs the next set of the loaded workout, as tapping LOG would.
    @discardableResult
    public func logSet(exercise xi: Int = 0, load: Double? = nil, reps: Int? = nil, rir: Double? = nil, at: Date = Date()) -> WireRecord? {
        guard let w = workout, w.ex.indices.contains(xi) else { return nil }
        if sessionId == nil { sessionId = "\(watchId)-\(String(Int(at.timeIntervalSince1970), radix: 36))"; sessionStart = at }
        let ex = w.ex[xi]
        let n = (setCounter[xi] ?? 0) + 1
        setCounter[xi] = n
        let rec = WireRecord(k: "set", id: "\(sessionId!).\(xi).\(n)", rev: 1, sid: sessionId!, wid: w.id, wn: w.name, xi: xi,
                             xid: ex.id, xn: ex.name, set: n, load: load ?? ex.load ?? 0, units: w.units,
                             reps: reps ?? Int(ex.reps.prefix { $0.isNumber }) ?? 8, rir: rir ?? ex.rir ?? 2,
                             at: at.timeIntervalSince1970 * 1000, ed: nil, del: nil, start: nil, end: nil, n: nil)
        pending[rec.id] = rec
        return rec
    }

    /// Edits a set on the watch: same id, next rev.
    public func editSet(id: String, reps: Int, at: Date = Date()) {
        guard var r = pending[id] ?? lastKnown[id] else { return }
        r.rev += 1; r.reps = reps; r.ed = at.timeIntervalSince1970 * 1000
        pending[id] = r
    }
    /// Copies of sets already sent, so a later edit can be made (the watch keeps them in its session file).
    private var lastKnown: [String: WireRecord] = [:]
    public func rememberSent() { for (k, v) in pending { lastKnown[k] = v } }

    /// Marks a moment, as the watch's "Mark a moment" menu does.
    @discardableResult
    public func addMark(_ label: String, at: Date = Date()) -> WireRecord {
        let id = "\(watchId)-m\(String(Int(at.timeIntervalSince1970 * 1000), radix: 36))"
        var r = WireRecord(k: "mark", id: id, rev: 1, sid: nil, wid: nil, wn: nil, xi: nil, xid: nil, xn: nil, set: nil,
                           load: nil, units: nil, reps: nil, rir: nil, at: at.timeIntervalSince1970 * 1000, ed: nil,
                           del: nil, start: nil, end: nil, n: nil)
        r.label = label
        marks[id] = r
        return r
    }

    /// A morning check-in, as the watch's Check-in menu makes it.
    @discardableResult
    public func addCheckin(_ score: Int, at: Date = Date()) -> WireRecord {
        let id = "\(watchId)-c\(String(Int(at.timeIntervalSince1970 * 1000), radix: 36))"
        var r = WireRecord(k: "chk", id: id, rev: 1, sid: nil, wid: nil, wn: nil, xi: nil, xid: nil, xn: nil, set: nil,
                           load: nil, units: nil, reps: nil, rir: nil, at: at.timeIntervalSince1970 * 1000, ed: nil,
                           del: nil, start: nil, end: nil, n: nil)
        r.score = score
        marks[id] = r
        return r
    }

    public func finishSession(at: Date = Date()) {
        guard let s = sessionId, let w = workout else { return }
        pending[s] = WireRecord(k: "ses", id: s, rev: 1, sid: s, wid: w.id, wn: w.name, xi: nil, xid: nil, xn: nil, set: nil,
                                load: nil, units: w.units, reps: nil, rir: nil, at: at.timeIntervalSince1970 * 1000, ed: nil,
                                del: nil, start: (sessionStart ?? at).timeIntervalSince1970 * 1000,
                                end: at.timeIntervalSince1970 * 1000, n: setCounter.values.reduce(0, +))
        sessionId = nil; sessionStart = nil; setCounter = [:]
    }
}
