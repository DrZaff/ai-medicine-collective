import XCTest
@testable import NextSetSyncCore

/// A phone (store + engine) connected to a simulated watch. "Reconnecting"
/// builds a fresh engine on the same store, as the app does on each connection.
final class Rig: @unchecked Sendable {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("rig-\(UUID())")
    let store: LocalStore
    let watch: SimulatedWatch
    var engine: SyncEngine!

    init(chunk: Int = 20) throws {
        store = try LocalStore(directory: dir)
        try store.updateLink { $0.peripheralId = "SIM" }
        watch = SimulatedWatch(chunkSize: chunk)
    }

    func connect() async {
        await watch.reconnect()
        let e = SyncEngine(store: store, link: watch, phoneName: "Test iPhone", isDemo: true)
        await e.setTimeouts(request: 2, pair: 2)
        engine = e
        await watch.attach(deliver: { [e] d in await e.receive(d) }, dropped: { [e] in await e.linkDropped() })
    }

    func paired() async throws -> Rig {
        await connect()
        try await engine.pair(code: "1234")
        return self
    }
}

final class SyncTests: XCTestCase {
    func testPairingThenAuthOnReconnect() async throws {
        let rig = try Rig()
        await rig.connect()
        do { _ = try await rig.engine.syncAll(); XCTFail("must need pairing") }
        catch WireError.watch(let code, _) { XCTAssertEqual(code, "unauthorized") }
        try await rig.engine.pair(code: "1234")
        XCTAssertEqual(rig.store.link.key?.count, 32)
        XCTAssertEqual(rig.store.link.watchId, "d3m0a7c4")
        await rig.watch.disconnect()
        await rig.connect()
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.newSets, 0)
        let tz = await rig.watch.timeZoneMinutes
        XCTAssertEqual(tz, TimeZone.current.secondsFromGMT() / 60, "watch clock and zone set on connect")
    }

    func testWrongKeyIsRefused() async throws {
        let rig = try await Rig().paired()
        try rig.store.updateLink { $0.key = String(repeating: "0", count: 32) }
        await rig.watch.disconnect(); await rig.connect()
        do { _ = try await rig.engine.syncAll(); XCTFail() }
        catch WireError.watch(let code, _) { XCTAssertEqual(code, "auth_failed") }
    }

    func testDeclinedPairing() async throws {
        let rig = try Rig()
        await rig.connect()
        await rig.watch.setDecline()
        do { try await rig.engine.pair(code: "1"); XCTFail() }
        catch WireError.watch(let code, _) { XCTAssertEqual(code, "pair_refused") }
        XCTAssertNil(rig.store.link.key)
    }

    /// The acceptance test: send a workout, log a set with the phone away,
    /// reconnect, and the set arrives exactly once.
    func testOfflineSetArrivesExactlyOnce() async throws {
        let rig = try await Rig().paired()
        try await rig.engine.sendWorkout(Samples.quickTest)
        let loaded = await rig.watch.workout
        XCTAssertEqual(loaded?.id, Samples.quickTest.id)
        XCTAssertEqual(loaded?.ex.first?.reps, "8-12")

        await rig.watch.disconnect()                       // phone walks away
        let rec = await rig.watch.logSet(load: 0, reps: 11, rir: 2)
        XCTAssertNotNil(rec)

        await rig.connect()                                // phone comes back
        let r1 = try await rig.engine.syncAll()
        XCTAssertEqual(r1.newSets, 1)
        XCTAssertEqual(r1.leftOnWatch, 0)
        let r2 = try await rig.engine.syncAll()
        XCTAssertEqual(r2.newSets, 0)
        XCTAssertEqual(rig.store.sets.count, 1)
        XCTAssertEqual(rig.store.sets[0].reps, 11)
        XCTAssertEqual(rig.store.sets[0].ackState, .confirmed)
        XCTAssertNotNil(rig.store.link.lastSync)
    }

    func testResponseCutOffMidTransferLosesNothing() async throws {
        let rig = try await Rig().paired()
        try await rig.engine.sendWorkout(Samples.fullBodyA)
        for i in 0..<5 { await rig.watch.logSet(exercise: i % 3, at: Date(timeIntervalSinceNow: Double(i))) }
        await rig.watch.setFaults(truncateOn: "pull")       // the answer to pull stops halfway
        await rig.connect()
        do { _ = try await rig.engine.syncAll(); XCTFail("expected the link to drop") } catch {}
        XCTAssertEqual(rig.store.sets.count, 0, "half a frame is never stored")
        let left = await rig.watch.pending.count
        XCTAssertEqual(left, 5)
        await rig.connect()
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.newSets, 5)
        XCTAssertEqual(rig.store.sets.count, 5)
    }

    func testAckLostAfterPhoneSavedMeansNoDuplicate() async throws {
        let rig = try await Rig().paired()
        try await rig.engine.sendWorkout(Samples.fullBodyA)
        await rig.watch.logSet(); await rig.watch.logSet()
        await rig.watch.setFaults(dropOn: "ack")           // phone stored them, then the ack never arrived
        await rig.connect()
        do { _ = try await rig.engine.syncAll(); XCTFail() } catch {}
        XCTAssertEqual(rig.store.sets.count, 2)
        XCTAssertTrue(rig.store.sets.allSatisfy { $0.ackState == .awaitingWatchAck }, "shown as pending confirmation")
        let still = await rig.watch.pending.count
        XCTAssertEqual(still, 2, "watch keeps them until acknowledged")
        await rig.connect()
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.newSets, 0)
        XCTAssertEqual(r.duplicateRecords, 2)
        XCTAssertEqual(rig.store.sets.count, 2, "exactly once")
        XCTAssertTrue(rig.store.sets.allSatisfy { $0.ackState == .confirmed })
    }

    func testDuplicatedNotificationIsIgnored() async throws {
        let rig = try await Rig().paired()
        try await rig.engine.sendWorkout(Samples.fullBodyA)
        await rig.watch.logSet()
        await rig.watch.setFaults(duplicate: true)
        _ = try await rig.engine.fetchStatus()
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.newSets, 1)
        XCTAssertEqual(rig.store.sets.count, 1)
    }

    func testEditOnWatchAfterSyncReplacesTheSet() async throws {
        let rig = try await Rig().paired()
        try await rig.engine.sendWorkout(Samples.fullBodyA)
        let rec = await rig.watch.logSet(reps: 8)!
        await rig.watch.rememberSent()
        _ = try await rig.engine.syncAll()
        await rig.watch.editSet(id: rec.id, reps: 10)
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.updatedSets, 1)
        XCTAssertEqual(rig.store.sets.count, 1)
        XCTAssertEqual(rig.store.sets[0].reps, 10)
        XCTAssertEqual(rig.store.sets[0].rev, 2)
    }

    func testManyRecordsArePagedWithLargeMTU() async throws {
        let rig = try await Rig(chunk: 128).paired()
        try await rig.engine.sendWorkout(Samples.fullBodyA)
        for i in 0..<30 { await rig.watch.logSet(exercise: i % 5, at: Date(timeIntervalSinceNow: Double(i))) }
        await rig.watch.finishSession()
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.newSets, 30)
        XCTAssertEqual(r.sessionsFinished, 1)
        let s = rig.store.sessions
        XCTAssertEqual(s.count, 1); XCTAssertTrue(s[0].finished); XCTAssertEqual(s[0].sets.count, 30)
    }

    func testSleepSyncAndRepeatImport() async throws {
        let rig = try await Rig().paired()
        let zone = TimeZone(identifier: "America/New_York")!
        let now = Date()
        let demo = DemoData.sleep(now: now, zone: zone)
        await rig.watch.setSleep(demo.entries, lastCheckT10: demo.dataEndT10)
        let r1 = try await rig.engine.syncAll()
        XCTAssertGreaterThan(r1.sleepAdded, 50)
        XCTAssertEqual(r1.sleepLogVersion, "0.26")
        let ack = await rig.watch.sleepAck
        XCTAssertEqual(ack, demo.entries.last!.t10)
        let r2 = try await rig.engine.syncAll()
        XCTAssertEqual(r2.sleepAdded, 0, "the 24-hour overlap re-reads but adds nothing")
        XCTAssertEqual(r2.sleepChanged, 0)
        let nights = SleepAnalyzer.nights(rig.store.sleepEntries, dataEndT10: rig.store.sleepDataEndT10,
                                          zones: ZoneHistory([], fallback: zone))
        XCTAssertGreaterThanOrEqual(nights.count, 8)
    }

    func testNoSleepLogIsReportedNotFatal() async throws {
        let rig = try await Rig().paired()
        await rig.watch.setSleepLogVersion(nil)
        await rig.watch.disconnect(); await rig.connect()
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.sleepSkippedReason, "Sleep Log not installed")
    }

    func testStoreSurvivesRestartWithPendingState() async throws {
        let rig = try await Rig().paired()
        try await rig.engine.sendWorkout(Samples.fullBodyA)
        await rig.watch.logSet()
        await rig.watch.setFaults(dropOn: "ack")
        await rig.connect()
        _ = try? await rig.engine.syncAll()
        // App killed and relaunched: the store reloads from disk.
        let reopened = try LocalStore(directory: rig.dir)
        XCTAssertEqual(reopened.sets.count, 1)
        XCTAssertEqual(reopened.awaitingAckCount, 1)
        XCTAssertEqual(reopened.link.key, rig.store.link.key)
    }

    func testDifferentWatchIsNotTrustedSilently() async throws {
        let rig = try await Rig().paired()
        try rig.store.updateLink { $0.watchId = "someoneelse" }
        await rig.watch.disconnect(); await rig.connect()
        do { _ = try await rig.engine.syncAll(); XCTFail() } catch WireError.unexpected(let s) { XCTAssertTrue(s.contains("different watch")) }
    }

    func testTimeoutWhenWatchIsSilent() async throws {
        let rig = try await Rig().paired()
        await rig.watch.setFaults(dropOn: nil)
        await rig.engine.setTimeouts(request: 0.3, pair: 0.3)
        let silent = SilentLink()
        let e = SyncEngine(store: rig.store, link: silent, phoneName: "x")
        await e.setTimeouts(request: 0.3, pair: 0.3)
        do { _ = try await e.fetchStatus(); XCTFail() } catch WireError.timeout(let t) { XCTAssertEqual(t, "hello") }
    }
}

final class SilentLink: WatchLink, @unchecked Sendable {
    let chunkSize = 20
    func write(_ chunk: Data) async throws {}
}

extension SimulatedWatch {
    func setDecline() { confirmPairing = false }
}
