import XCTest
@testable import NextSetSyncCore

/// Shared files in nextset-sync/protocol (also used by the watch tests).
enum Shared {
    static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("protocol")
    static func data(_ name: String) throws -> Data { try Data(contentsOf: root.appendingPathComponent(name)) }
    static func json(_ name: String) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: data(name)) as! [String: Any]
    }
}

final class VectorTests: XCTestCase {
    func testSHA256MatchesSharedVectors() throws {
        let v = try Shared.json("vectors.json")
        for case let item as [String: String] in v["sha256"] as! [Any] {
            XCTAssertEqual(SHA256.hex(item["input"]!), item["hex"])
        }
        let p = v["proof"] as! [String: String]
        XCTAssertEqual(pairingProof(key: p["key"]!, nonce: p["nonce"]!, phoneId: p["phone"]!), p["sha256hex"])
    }

    func testFrameMatchesTheWatchFormat() throws {
        let v = try Shared.json("vectors.json")["frame"] as! [String: Any]
        var m = WireMessage(t: "hello")
        m.v = 1; m.phone = "6F1C2A9E-0000-4000-8000-1234567890AB"; m.mtu = 20; m.q = 1
        let frame = try Framing.frame(m)
        let text = String(decoding: frame, as: UTF8.self)
        // Key order differs from JavaScript's; the length prefix and content must agree.
        let expected = v["message"] as! String
        XCTAssertEqual(text.count, (v["frame"] as! String).count)
        XCTAssertTrue(text.hasPrefix("\(expected.count):"))
        let decoded = try Framing.decode(line: Data((v["frame"] as! String).dropLast().utf8))
        XCTAssertEqual(decoded, m)
        XCTAssertEqual(Framing.chunks(frame, size: 20).count, (v["chunks20"] as! [String]).count)
    }

    func testAssemblerHandlesAnyChunking() throws {
        var m = WireMessage(t: "recs"); m.q = 7; m.more = false
        m.recs = [WireRecord(k: "set", id: "a.0.1", rev: 2, sid: "a", wid: "w", wn: "Upper", xi: 0, xid: "bench", xn: "Bench", set: 1,
                             load: 135, units: "lb", reps: 8, rir: 2, at: 1_794_000_000_000, ed: nil, del: nil, start: nil, end: nil, n: nil)]
        let frame = try Framing.frame(m) + Framing.frame(WireMessage(t: "ok"))
        for size in [1, 3, 20, 128, 1000] {
            var a = FrameAssembler()
            var lines: [Data] = []
            for c in Framing.chunks(frame, size: size) { lines += a.feed(c) }
            XCTAssertEqual(lines.count, 2, "chunk size \(size)")
            XCTAssertEqual(try Framing.decode(line: lines[0]), m)
        }
    }

    func testDamagedFramesAreRejected() {
        XCTAssertThrowsError(try Framing.decode(line: Data("12:{\"t\":\"ok\"}".utf8)))   // wrong length
        XCTAssertThrowsError(try Framing.decode(line: Data("{\"t\":\"ok\"}".utf8)))      // no length
        XCTAssertThrowsError(try Framing.decode(line: Data("4:{\"t\"".utf8)))           // truncated
        XCTAssertNoThrow(try Framing.decode(line: Data("10:{\"t\":\"ok\"}".utf8)))
    }

    func testWatchTextIsASCII() throws {
        XCTAssertEqual(WireText.ascii("Goblet squat 8–12 × 3 — “café”"), "Goblet squat 8-12 x 3 - \"cafe\"")
        var m = WireMessage(t: "pair"); m.name = "Zoë’s iPhone"
        let f = try Framing.frame(m)
        XCTAssertTrue(f.allSatisfy { $0 < 0x80 }, "frames are pure ASCII")
        XCTAssertEqual(try Framing.decode(line: f.dropLast()).name, "Zoë’s iPhone")
        // Older Espruino \xHH escapes are tolerated.
        let body = "{\"t\":\"ok\",\"msg\":\"\\xe9\"}"
        XCTAssertEqual(try Framing.decode(line: Data("\(body.utf8.count):\(body)".utf8)).msg, "é")
    }
}

final class SleepTests: XCTestCase {
    var expected: [String: Any]!
    var all: [SleepEntry]!
    var dataEnd: Int!
    var zones: ZoneHistory!

    override func setUpWithError() throws {
        expected = try Shared.json("fixtures/sleep-expected.json")
        let log = String(decoding: try Shared.data("fixtures/sleeplog-sample.log"), as: UTF8.self)
        let archive = try SleepLogParser.parseArchive(try Shared.data("fixtures/sleeplog-archive.json"))
        all = archive + SleepLogParser.parseStorageFile(log)
        dataEnd = expected["dataEndT10"] as? Int
        zones = ZoneHistory((expected["zoneLog"] as! [[String: Any]]).map {
            ZoneMark(at: Date(timeIntervalSince1970: TimeInterval($0["at"] as! Int)), zone: $0["zone"] as! String)
        })
    }

    func testStorageFileParsingSkipsStateLinesAndKeepsTransitions() {
        let parsed = SleepLogParser.parseStorageFile("2990238,2,0\n,2990326,0,2990244\n2990329,4,0\n\nbad,line\n2990329,4,0\n")
        XCTAssertEqual(parsed, [SleepEntry(t10: 2990238, status: 2, consec: 0), SleepEntry(t10: 2990329, status: 4, consec: 0),
                                SleepEntry(t10: 2990329, status: 4, consec: 0)])
        XCTAssertEqual(SleepLogParser.normalize(parsed).count, 2, "duplicate line merged")
        XCTAssertEqual(SleepLogParser.normalize(parsed)[1].consec, 0, "no later info: stays unknown")
    }

    func testConsecutiveIsFilledFromTheNextEntryLikeReadLog() {
        let n = SleepLogParser.normalize([SleepEntry(t10: 10, status: 4, consec: 0), SleepEntry(t10: 13, status: 4, consec: 2),
                                          SleepEntry(t10: 20, status: 2, consec: 0), SleepEntry(t10: 26, status: 2, consec: 1)])
        XCTAssertEqual(n.map(\.consec), [2, 1], "filled, then identical neighbours merged")
    }

    func testNightsMatchTheFixture() throws {
        let nights = SleepAnalyzer.nights(all, dataEndT10: dataEnd, zones: zones).sorted { $0.wakeDate < $1.wakeDate }
        let want = expected["nights"] as! [[String: Any]]
        XCTAssertEqual(nights.map(\.wakeDate), want.map { $0["wake"] as! String })
        for (n, w) in zip(nights, want) {
            let tz = n.timeZone
            XCTAssertEqual(SleepAnalyzer.clock(n.main.start, tz), w["start"] as? String, n.wakeDate)
            XCTAssertEqual(SleepAnalyzer.clock(n.main.end, tz), w["end"] as? String, n.wakeDate)
            XCTAssertEqual(n.main.asleepMinutes, w["asleep"] as? Int, n.wakeDate)
            XCTAssertEqual(n.main.isPartial, w["partial"] as? Bool, n.wakeDate)
            XCTAssertEqual(n.main.bridgedMinutes, (w["bridged"] as? Int) ?? 0, n.wakeDate)
            XCTAssertEqual(n.napMinutes, (w["naps"] as? Int) ?? 0, n.wakeDate)
            XCTAssertEqual(n.main.lightMinutes + n.main.deepMinutes + n.main.bridgedMinutes, n.main.asleepMinutes)
        }
    }

    func testTimeZoneChangesUseTheZoneOfThatNight() {
        let nights = SleepAnalyzer.nights(all, dataEndT10: dataEnd, zones: zones)
        let denver = nights.first { $0.wakeDate == "2026-11-10" }!
        XCTAssertEqual(denver.timeZone.identifier, "America/Denver")
        XCTAssertEqual(SleepAnalyzer.clock(denver.main.start, denver.timeZone), "23:00")
        let home = nights.first { $0.wakeDate == "2026-11-13" }!
        XCTAssertEqual(home.timeZone.identifier, "America/New_York")
        // Without the zone history everything would be read in one zone and the Denver night would read 01:00.
        let flat = SleepAnalyzer.nights(all, dataEndT10: dataEnd, zones: ZoneHistory([], fallback: TimeZone(identifier: "America/New_York")!))
        let d2 = flat.first { $0.wakeDate == "2026-11-10" }!
        XCTAssertEqual(SleepAnalyzer.clock(d2.main.start, d2.timeZone), "01:00")
    }

    func testNightsSpanningMidnightAndAfterMidnight() {
        let nights = SleepAnalyzer.nights(all, dataEndT10: dataEnd, zones: zones)
        let n6 = nights.first { $0.wakeDate == "2026-11-06" }!
        XCTAssertEqual(SleepAnalyzer.dayString(n6.main.start, n6.timeZone), "2026-11-05", "started the evening before")
        let n8 = nights.first { $0.wakeDate == "2026-11-08" }!
        XCTAssertEqual(SleepAnalyzer.dayString(n8.main.start, n8.timeZone), "2026-11-08", "fell asleep after midnight")
    }

    func testPartialRecords() {
        // Data that starts mid-sleep and ends mid-sleep.
        let firstLight = SleepLogParser.normalize(all).firstIndex { $0.status == 3 }!
        let slice = Array(SleepLogParser.normalize(all)[firstLight...])
        let eps = SleepAnalyzer.episodes(slice, dataEndT10: slice.last!.t10 + 1)
        XCTAssertTrue(eps.first!.startsAtDataStart)
        XCTAssertTrue(eps.last!.isPartial)
        // The unfinished night is flagged as partial in the full analysis.
        let nights = SleepAnalyzer.nights(all, dataEndT10: dataEnd, zones: zones)
        XCTAssertTrue(nights.first { $0.wakeDate == "2026-11-13" }!.main.isPartial)
    }

    func testRepeatedAndOutOfOrderImportsAreIdempotent() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("sleep-\(UUID())")
        let store = try LocalStore(directory: dir)
        let half = all.count / 2
        let r1 = try store.importSleep(Array(all[half...]), dataEndT10: dataEnd)
        let r2 = try store.importSleep(Array(all[..<half]), dataEndT10: nil)
        XCTAssertEqual(r1.added + r2.added, Set(all.map(\.t10)).count)
        let again = try store.importSleep(all, dataEndT10: dataEnd)
        XCTAssertEqual(again.added, 0); XCTAssertEqual(again.changed, 0)
        let before = SleepAnalyzer.nights(store.sleepEntries, dataEndT10: store.sleepDataEndT10, zones: zones)
        // Reload from disk: same nights.
        let reloaded = try LocalStore(directory: dir)
        XCTAssertEqual(SleepAnalyzer.nights(reloaded.sleepEntries, dataEndT10: reloaded.sleepDataEndT10, zones: zones), before)
        XCTAssertEqual(before.count, 8)
    }

    func testTrendHasSevenDaysWithGaps() {
        let nights = SleepAnalyzer.nights(all, dataEndT10: dataEnd, zones: zones)
        let ny = TimeZone(identifier: "America/New_York")!
        let today = ISO8601DateFormatter().date(from: "2026-11-14T15:00:00Z")!
        let t = SleepAnalyzer.trend(nights, today: today, zone: ny)
        XCTAssertEqual(t.map(\.wakeDate), ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"])
        XCTAssertNil(t.last!.asleepMinutes)
        XCTAssertTrue(t[5].isPartial)
        XCTAssertEqual(t[0].asleepMinutes, 450)
    }

    func testAsleepIntervalsSplitAtAwakeSpells() {
        let nights = SleepAnalyzer.nights(all, dataEndT10: dataEnd, zones: zones)
        // The 20-minute awake spell splits a night into two asleep stretches.
        let n6 = nights.first { $0.wakeDate == "2026-11-06" }!
        XCTAssertEqual(n6.main.asleepIntervals.count, 2)
        XCTAssertEqual(n6.main.asleepIntervals.reduce(0) { $0 + Int($1.duration / 60) }, 430)
    }

    func testDemoSleepLooksLikeAWeek() {
        let zone = TimeZone(identifier: "America/New_York")!
        let now = ISO8601DateFormatter().date(from: "2026-11-13T13:00:00Z")!
        let d = DemoData.sleep(now: now, zone: zone)
        let nights = SleepAnalyzer.nights(d.entries, dataEndT10: d.dataEndT10, zones: ZoneHistory([], fallback: zone))
        XCTAssertEqual(nights.count, 9)
        XCTAssertTrue(nights.allSatisfy { (300...480).contains($0.main.asleepMinutes) })
        XCTAssertEqual(nights.filter { !$0.naps.isEmpty }.count, 1)
        XCTAssertEqual(SleepAnalyzer.trend(nights, today: now, zone: zone).compactMap(\.asleepMinutes).count, 7)
        // At 03:00 the last night is still in progress.
        let early = ISO8601DateFormatter().date(from: "2026-11-13T08:00:00Z")!
        let d2 = DemoData.sleep(now: early, zone: zone)
        let n2 = SleepAnalyzer.nights(d2.entries, dataEndT10: d2.dataEndT10, zones: ZoneHistory([], fallback: zone))
        XCTAssertTrue(n2.first!.main.isPartial)
    }
}
