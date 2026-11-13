import XCTest
@testable import NextSetSyncCore

/// The Swift sync engine against the REAL watch code (nsync boot.js + lib.js
/// and Sleep Log 0.26's lib.js) running in the Espruino 2v29 interpreter,
/// through watch/test/bridge.mjs. Only Bluetooth itself is replaced.
/// Runs when NSYNC_ESPRUINO points at an Espruino Linux build (see
/// scripts/build-espruino.sh); skipped otherwise.
final class EspruinoLink: WatchLink, @unchecked Sendable {
    let chunkSize: Int
    private let process = Process()
    private let input = Pipe(), output = Pipe()
    private var stream: AsyncStream<Data>.Continuation!
    let notifications: AsyncStream<Data>
    private var ready: CheckedContinuation<Void, Never>?
    private var isReady = false
    private let lock = NSLock()
    private var lineBuffer = Data()

    init(espruino: String, chunkSize: Int) throws {
        self.chunkSize = chunkSize
        var c: AsyncStream<Data>.Continuation!
        notifications = AsyncStream { c = $0 }
        stream = c
        let bridge = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("watch/test/bridge.mjs")
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", bridge.path]
        var env = ProcessInfo.processInfo.environment
        env["ESPRUINO"] = espruino
        process.environment = env
        process.standardInput = input
        process.standardOutput = output
        output.fileHandleForReading.readabilityHandler = { [weak self] h in self?.consume(h.availableData) }
        try process.run()
    }

    private func consume(_ d: Data) {
        lock.lock(); defer { lock.unlock() }
        lineBuffer.append(d)
        while let nl = lineBuffer.firstIndex(of: 0x0A) {
            let line = String(decoding: lineBuffer[lineBuffer.startIndex..<nl], as: UTF8.self)
            lineBuffer = Data(lineBuffer[lineBuffer.index(after: nl)...])
            if line == "R" { isReady = true; ready?.resume(); ready = nil }
            else if line.hasPrefix("N ") { stream.yield(Self.unhex(String(line.dropFirst(2)))) }
            else if line.hasPrefix("E ") { print("watch error:", line) }
        }
    }

    func waitReady() async {
        await withCheckedContinuation { c in
            lock.lock()
            if isReady { lock.unlock(); c.resume() } else { ready = c; lock.unlock() }
        }
    }

    static func unhex(_ s: String) -> Data {
        var d = Data(); var i = s.startIndex
        while i < s.endIndex { let j = s.index(i, offsetBy: 2); d.append(UInt8(s[i..<j], radix: 16)!); i = j }
        return d
    }

    private func send(_ line: String) { input.fileHandleForWriting.write(Data((line + "\n").utf8)) }
    func write(_ chunk: Data) async throws { send("W " + chunk.map { String(format: "%02x", $0) }.joined()) }
    func dropLink() { send("D") }
    func personLogsSet(reps: Int) { send("L \(reps)") }
    func personFinishes() { send("F") }
    func personMarks(_ label: String) { send("M \(label)") }
    func stop() { try? input.fileHandleForWriting.close(); process.terminate() }
}

final class EspruinoBridgeTests: XCTestCase {
    func testAcceptanceFlowAgainstRealWatchCode() async throws {
        guard let esp = ProcessInfo.processInfo.environment["NSYNC_ESPRUINO"] else {
            throw XCTSkip("Set NSYNC_ESPRUINO to an Espruino Linux build to run this test.")
        }
        let link = try EspruinoLink(espruino: esp, chunkSize: 20)
        defer { link.stop() }
        await link.waitReady()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("bridge-\(UUID())")
        let store = try LocalStore(directory: dir)
        try store.updateLink { $0.peripheralId = "BRIDGE" }

        let expected = try Shared.json("fixtures/sleep-expected.json")
        let dataEnd = expected["dataEndT10"] as! Int
        // The phone's clock (and so the watch's, set by the time message) is the
        // morning the fixture ends, so the test does not depend on today's date.
        let fixtureNow = Date(timeIntervalSince1970: TimeInterval(dataEnd) * 600 + 3600)
        final class Box: @unchecked Sendable { var engine: SyncEngine?; let lock = NSLock()
            func get() -> SyncEngine? { lock.lock(); defer { lock.unlock() }; return engine }
            func set(_ e: SyncEngine) { lock.lock(); engine = e; lock.unlock() } }
        let box = Box()
        func connect() async -> SyncEngine {
            let e = SyncEngine(store: store, link: link, phoneName: "Bridge iPhone", clock: { fixtureNow })
            await e.setTimeouts(request: 10, pair: 10)
            box.set(e)
            return e
        }
        var engine = await connect()
        let pump = Task { for await d in link.notifications { await box.get()?.receive(d) } }
        defer { pump.cancel() }

        // 1. Pair (the bridge confirms on the watch's behalf) and send the sample workout.
        try await engine.pair(code: "2468")
        XCTAssertEqual(store.link.key?.count, 32)
        try await engine.sendWorkout(Samples.quickTest)

        // 2. Phone disconnects; one set is logged on the watch.
        link.dropLink(); await engine.linkDropped()
        link.personLogsSet(reps: 11)
        link.personMarks("Coffee")
        try await Task.sleep(nanoseconds: 300_000_000)

        // 3. Reconnect: the set arrives exactly once, and Sleep Log comes with it.
        engine = await connect()
        let r1 = try await engine.syncAll()
        XCTAssertEqual(r1.newSets, 1)
        XCTAssertEqual(r1.newMarkers, 1, "marker made on the real watch code arrives")
        XCTAssertEqual(store.markers.map(\.label), ["Coffee"])
        XCTAssertEqual(r1.leftOnWatch, 0)
        XCTAssertEqual(r1.sleepLogVersion, "0.26")
        XCTAssertEqual(store.sets.map(\.reps), [11])
        XCTAssertEqual(store.sets.first?.ackState, .confirmed)
        let r2 = try await engine.syncAll()
        XCTAssertEqual(r2.newSets, 0)
        XCTAssertEqual(r2.newMarkers, 0, "and only once")
        XCTAssertEqual(r2.sleepAdded, 0, "repeat import adds nothing")
        XCTAssertEqual(store.sets.count, 1)

        // 4. The nights the phone computes from the watch's answers match the fixture.
        let zones = ZoneHistory((expected["zoneLog"] as! [[String: Any]]).map {
            ZoneMark(at: Date(timeIntervalSince1970: TimeInterval($0["at"] as! Int)), zone: $0["zone"] as! String)
        })
        let nights = SleepAnalyzer.nights(store.sleepEntries, dataEndT10: dataEnd, zones: zones).sorted { $0.wakeDate < $1.wakeDate }
        let want = expected["nights"] as! [[String: Any]]
        XCTAssertEqual(nights.map(\.wakeDate), want.map { $0["wake"] as! String })
        for (n, w) in zip(nights, want) {
            XCTAssertEqual(n.main.asleepMinutes, w["asleep"] as? Int, n.wakeDate)
            XCTAssertEqual(n.main.isPartial, w["partial"] as? Bool, n.wakeDate)
        }

        // 5. Finishing the workout on the watch syncs a finished session.
        link.personFinishes()
        try await Task.sleep(nanoseconds: 300_000_000)
        let r3 = try await engine.syncAll()
        XCTAssertEqual(r3.sessionsFinished, 1)
        XCTAssertEqual(store.sessions.first?.finished, true)
    }
}
