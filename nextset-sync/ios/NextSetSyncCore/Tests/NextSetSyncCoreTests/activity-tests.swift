import XCTest
@testable import NextSetSyncCore

/// Runs and walks (record kind "act" plus a route) and daily steps.
final class ActivitySyncTests: XCTestCase {
    func testRunArrivesOnceWithItsRoute() async throws {
        let rig = try await Rig(chunk: 128).paired()
        let route = DemoData.route(seconds: 1_000, speed: 3.4)
        let a = await rig.watch.addActivity(start: Date(timeIntervalSince1970: 1_794_000_000), route: route)
        let r1 = try await rig.engine.syncAll()
        XCTAssertEqual(r1.newActivities, 1)
        let got = try XCTUnwrap(rig.store.activities.first)
        XCTAssertEqual(got.id, a.id)
        XCTAssertEqual(got.route, route, "every route point, in order")
        XCTAssertEqual(got.splits.count, 2)
        XCTAssertEqual(got.distanceM, a.dist)
        XCTAssertEqual(got.ackState, .confirmed)
        XCTAssertFalse(got.routeCut)
        let freed = await rig.watch.routes[a.id] == nil
        XCTAssertTrue(freed, "the watch erases the route once the phone has it")
        let r2 = try await rig.engine.syncAll()
        XCTAssertEqual(r2.newActivities, 0)
        XCTAssertEqual(rig.store.activities.count, 1)
        XCTAssertEqual(try LocalStore(directory: rig.dir).activities.first?.route.count, route.count, "stored on disk")
    }

    func testDisconnectDuringRouteLosesNothing() async throws {
        let rig = try await Rig().paired()
        let route = DemoData.route(seconds: 900, speed: 1.4)
        await rig.watch.addActivity(mode: "walk", units: "km", start: Date(timeIntervalSince1970: 1_794_000_000), route: route)
        await rig.watch.setFaults(truncateOn: "route")
        do { _ = try await rig.engine.syncAll(); XCTFail("the cut-off answer must fail this sync") } catch {}
        XCTAssertTrue(rig.store.activities.isEmpty, "nothing half-stored")
        let still = await rig.watch.routes.count
        XCTAssertEqual(still, 1, "the walk stays on the watch")
        await rig.connect()
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.newActivities, 1)
        XCTAssertEqual(rig.store.activities.first?.route.count, route.count)
        XCTAssertEqual(rig.store.activities.first?.mode, "walk")
    }

    func testAckLostMeansNoDuplicateAndNoSecondDownload() async throws {
        let rig = try await Rig(chunk: 128).paired()
        await rig.watch.addActivity(start: Date(timeIntervalSince1970: 1_794_000_000), route: DemoData.route(seconds: 600, speed: 3))
        await rig.watch.setFaults(dropOn: "ack")
        do { _ = try await rig.engine.syncAll(); XCTFail("dropped before the ack") } catch {}
        XCTAssertEqual(rig.store.activities.count, 1, "saved before acknowledging")
        let routeReads = await rig.watch.requestLog.filter { $0 == "route" }.count
        await rig.connect()
        _ = try await rig.engine.syncAll()
        XCTAssertEqual(rig.store.activities.count, 1)
        let after = await rig.watch.requestLog.filter { $0 == "route" }.count
        XCTAssertEqual(after, routeReads, "a run already stored is acknowledged without reading its route again")
        let synced = await rig.watch.syncedActs.count
        XCTAssertEqual(synced, 1)
    }

    func testRouteTheWatchEndsEarlyIsKeptAsCutShort() async throws {
        let rig = try await Rig(chunk: 128).paired()
        let route = DemoData.route(seconds: 300, speed: 3)
        await rig.watch.addActivity(start: Date(timeIntervalSince1970: 1_794_000_000), route: route, claimedPoints: route.count + 5)
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.newActivities, 1, "not stuck on the watch forever")
        XCTAssertEqual(rig.store.activities.first?.routeCut, true)
        XCTAssertEqual(rig.store.activities.first?.route.count, route.count)
    }

    func testOlderPhoneBuildNeverAcksRuns() throws {
        let s = try LocalStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("act-\(UUID())"))
        var w = WireRecord(k: "act", id: "w-a1", rev: 1, sid: nil, wid: nil, wn: nil, xi: nil, xid: nil, xn: nil, set: nil,
                           load: nil, units: "mi", reps: nil, rir: nil, at: 1_794_000_000_000, ed: nil, del: nil,
                           start: nil, end: 1_794_000_600_000, n: 3)
        w.mode = "run"; w.dist = 1700
        let r = try s.upsert([w])
        XCTAssertEqual(r.acks, [], "a run without its route is not acknowledged")
        XCTAssertEqual(r.incompleteRoutes, 1)
    }

    func testDailyStepsReplacePerDay() async throws {
        let rig = try await Rig().paired()
        await rig.watch.setStepDays([WireDaySteps(date: "2026-11-13", steps: 8_200), WireDaySteps(date: "2026-11-14", steps: 300)])
        let r1 = try await rig.engine.syncAll()
        XCTAssertEqual(r1.stepDays, 2)
        await rig.watch.setStepDays([WireDaySteps(date: "2026-11-13", steps: 8_200), WireDaySteps(date: "2026-11-14", steps: 4_150),
                                     WireDaySteps(date: "2026-11-15", steps: 12)])
        _ = try await rig.engine.syncAll()
        XCTAssertEqual(rig.store.dailySteps.map(\.date), ["2026-11-13", "2026-11-14", "2026-11-15"])
        XCTAssertEqual(rig.store.dailySteps.map(\.steps), [8_200, 4_150, 12], "a day's total is replaced, never added twice")
        let r3 = try await rig.engine.syncAll()
        XCTAssertEqual(r3.stepDays, 0)
    }

    func testWatchWithoutStepsStillSyncs() async throws {
        let rig = try await Rig().paired()
        await rig.watch.setStepDays(nil)
        let r = try await rig.engine.syncAll()
        XCTAssertEqual(r.stepDays, 0)
        XCTAssertTrue(rig.store.dailySteps.isEmpty)
    }

    func testPaceAndClock() {
        let a = ActivityRecord(id: "x", rev: 1, mode: "run", start: Date(), end: Date(), distanceM: 3218.688, movingS: 1_920,
                               elapsedS: 2_000, units: "mi", splits: [950, 970], route: [], routeCut: false, receivedAt: Date(),
                               ackState: .confirmed, isDemo: false)
        XCTAssertEqual(Clock.text(a.averagePace), "16:00")
        XCTAssertEqual(a.distanceInUnits, 2, accuracy: 0.0001)
        XCTAssertEqual(Clock.text(3_727), "1:02:07")
        XCTAssertEqual(Clock.text(nil), "--:--")
    }

    /// The shared synthetic GPS tracks (also replayed on the watch): a route
    /// drawn from the steady run measures within 2 % of its true distance.
    func testSharedGpsTrackRoute() throws {
        let fx = try Shared.json("fixtures/gps-tracks.json")
        let origin = try XCTUnwrap(fx["origin"] as? [Double])
        let tracks = try XCTUnwrap(fx["tracks"] as? [[String: Any]])
        let steady = try XCTUnwrap(tracks.first { $0["name"] as? String == "run-steady" })
        let rows = try XCTUnwrap(steady["rows"] as? [[Double]])
        let expect = try XCTUnwrap(steady["expect"] as? [String: Any])
        let kLat = 1 / 111_320.0 / 10, kLon = 1 / (111_320.0 * cos(origin[0] * .pi / 180)) / 10
        let pts = rows.enumerated().filter { $0.offset % 10 == 0 }.map {
            RoutePoint(t: Int($0.element[0]), lat: origin[0] + $0.element[2] * kLat, lon: origin[1] + $0.element[1] * kLon)
        }
        let d = zip(pts, pts.dropFirst()).reduce(0.0) { $0 + RouteMath.meters($1.0, $1.1) }
        let truth = try XCTUnwrap(expect["dist_m"] as? Double)
        XCTAssertEqual(d, truth, accuracy: truth * 0.02)
    }
}

extension SimulatedWatch {
    func setStepDays(_ d: [WireDaySteps]?) { setDemoSteps(d) }
}
