import Foundation

/// Sleep Log (BangleApps `sleeplog`, version 0.26) storage, verified against
/// its source (lib.js `readLog`, boot.js `appendStatus`/`saveStatus`):
///
/// * `sleeplog.log` is a StorageFile of lines "t10,status,consecutive" where
///   t10 = floor(UTC milliseconds / 600 000), i.e. 10-minute steps since
///   1970-01-01 UTC. Time-zone independent.
/// * Lines starting with "," are saved service state, not transitions.
/// * Every 14 days old lines move to `sleeplog_NNNN.log`, a JSON array of
///   [t10, status, consecutive] (NNNN = fortnights since 1970-01-04 12:00 UTC).
/// * status: 0 unknown, 1 not worn, 2 awake, 3 light sleep, 4 deep sleep.
///   consecutive: 0 unknown, 1 not consecutive, 2 consecutive sleep. A 0 is
///   decided later; readLog fills it from the next known entry.
public enum SleepStatus: Int, Codable, Sendable {
    case unknown = 0, notWorn = 1, awake = 2, light = 3, deep = 4
    public var label: String {
        switch self {
        case .unknown: return "Unknown"
        case .notWorn: return "Not worn"
        case .awake: return "Awake"
        case .light: return "Light (Sleep Log estimate)"
        case .deep: return "Deep (Sleep Log estimate)"
        }
    }
    public var isAsleep: Bool { self == .light || self == .deep }
}

public enum SleepLogParser {
    /// Parses the StorageFile text (as downloaded from the watch's storage).
    public static func parseStorageFile(_ text: String) -> [SleepEntry] {
        text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }).compactMap { line -> SleepEntry? in
            let s = line.trimmingCharacters(in: .whitespaces)
            if s.isEmpty || s.hasPrefix(",") { return nil }
            let parts = s.split(separator: ",").map { Int($0.trimmingCharacters(in: .whitespaces)) }
            guard parts.count == 3, let t = parts[0], let st = parts[1], let c = parts[2] else { return nil }
            return entry(t, st, c)
        }
    }

    /// Parses a fortnight archive (`sleeplog_NNNN.log`) or a protocol `entries` array.
    public static func parseArray(_ rows: [[Int]]) -> [SleepEntry] {
        rows.compactMap { $0.count >= 3 ? entry($0[0], $0[1], $0[2]) : nil }
    }

    public static func parseArchive(_ data: Data) throws -> [SleepEntry] {
        guard let rows = try? JSONDecoder().decode([[Int]].self, from: data) else {
            throw WorkoutError.unreadable("Not a Sleep Log archive file.")
        }
        return parseArray(rows)
    }

    /// Sleep Log's own debug CSV is not supported (it has no transitions).
    static func entry(_ t: Int, _ s: Int, _ c: Int) -> SleepEntry? {
        // Plausible dates only (2015-2100), known codes only.
        guard t > 2_400_000, t < 6_900_000, (0...4).contains(s), (0...2).contains(c) else { return nil }
        return SleepEntry(t10: t, status: s, consec: c)
    }

    /// Sorted, one entry per time, repeats of the same state removed, and
    /// unknown "consecutive" values filled from the next known entry (as readLog does).
    public static func normalize(_ entries: [SleepEntry]) -> [SleepEntry] {
        var byTime: [Int: SleepEntry] = [:]
        for e in entries { byTime[e.t10] = e }
        var sorted = byTime.values.sorted { $0.t10 < $1.t10 }
        var nextKnown = 0
        for i in sorted.indices.reversed() {
            if sorted[i].consec == 0 { sorted[i].consec = nextKnown } else { nextKnown = sorted[i].consec }
        }
        var out: [SleepEntry] = []
        for e in sorted {
            if let l = out.last, l.status == e.status, l.consec == e.consec { continue }
            out.append(e)
        }
        return out
    }
}

/// Which time zone applied when. Built from the phone's zone history.
public struct ZoneHistory: Sendable {
    public var marks: [ZoneMark]
    public var fallback: TimeZone
    public init(_ marks: [ZoneMark], fallback: TimeZone = .current) {
        self.marks = marks.sorted { $0.at < $1.at }; self.fallback = fallback
    }
    public func zone(at date: Date) -> TimeZone {
        let mark = marks.last(where: { $0.at <= date }) ?? marks.first
        return mark.flatMap { TimeZone(identifier: $0.zone) } ?? fallback
    }
}

public struct SleepEpisode: Hashable, Sendable {
    public var start: Date
    public var end: Date
    public var asleepMinutes: Int
    public var lightMinutes: Int
    public var deepMinutes: Int
    public var awakeMinutes: Int
    /// Minutes of Sleep Log "unknown" between two consecutive-sleep entries,
    /// counted as asleep (see docs/sleep-log.md, "the moveLog gap").
    public var bridgedMinutes: Int
    /// The data ends while still asleep (night in progress or watch stopped logging).
    public var isPartial: Bool
    /// The data starts while already asleep.
    public var startsAtDataStart: Bool
    /// Asleep stretches, split at awake periods.
    public var asleepIntervals: [DateInterval]
    public var startT10: Int
}

public struct SleepNight: Hashable, Identifiable, Sendable {
    /// Local date of waking up, "yyyy-MM-dd", in the zone the phone was in then.
    public var wakeDate: String
    public var timeZone: TimeZone
    public var main: SleepEpisode
    public var naps: [SleepEpisode]
    public var id: String { wakeDate }
    public var napMinutes: Int { naps.reduce(0) { $0 + $1.asleepMinutes } }
}

public struct TrendPoint: Hashable, Identifiable, Sendable {
    public var wakeDate: String
    public var asleepMinutes: Int?
    public var isPartial: Bool
    public var id: String { wakeDate }
}

public enum SleepAnalyzer {
    /// Awake spells up to this long inside sleep keep the episode open
    /// (Sleep Log's default "max awake" is 60 minutes).
    public static let maxAwakeInside = 60
    /// Unknown stretches up to this long between consecutive-sleep entries are bridged.
    public static let maxBridge = 240
    /// Shorter episodes are noise, not sleep.
    public static let minEpisode = 20

    struct Segment { var start: Int; var end: Int; var status: SleepStatus; var consec: Int; var minutes: Int { (end - start) * 10 } }

    public static func episodes(_ raw: [SleepEntry], dataEndT10: Int?) -> [SleepEpisode] {
        let es = SleepLogParser.normalize(raw)
        guard !es.isEmpty else { return [] }
        let lastT = es.last!.t10
        let end = Swift.max(dataEndT10 ?? lastT, lastT)
        var segs: [Segment] = []
        for (i, e) in es.enumerated() {
            let to = i + 1 < es.count ? es[i + 1].t10 : end
            if to > e.t10 { segs.append(Segment(start: e.t10, end: to, status: SleepStatus(rawValue: e.status) ?? .unknown, consec: e.consec)) }
        }
        var out: [SleepEpisode] = []
        var cur: SleepEpisode?
        var runStart: Int?
        func date(_ t: Int) -> Date { Date(timeIntervalSince1970: TimeInterval(t) * 600) }
        func closeRun(at t: Int) {
            if let s = runStart, cur != nil, t > s { cur!.asleepIntervals.append(DateInterval(start: date(s), end: date(t))) }
            runStart = nil
        }
        func close(at t: Int) {
            guard var c = cur else { return }
            closeRun(at: t)
            c = cur!
            c.end = date(t)
            if c.asleepMinutes >= minEpisode { out.append(c) }
            cur = nil
        }
        for (i, s) in segs.enumerated() {
            let next = i + 1 < segs.count ? segs[i + 1] : nil
            let prev = i > 0 ? segs[i - 1] : nil
            if s.status.isAsleep {
                if cur == nil {
                    cur = SleepEpisode(start: date(s.start), end: date(s.end), asleepMinutes: 0, lightMinutes: 0, deepMinutes: 0,
                                       awakeMinutes: 0, bridgedMinutes: 0, isPartial: false, startsAtDataStart: i == 0,
                                       asleepIntervals: [], startT10: s.start)
                }
                if runStart == nil { runStart = s.start }
                cur!.asleepMinutes += s.minutes
                if s.status == .light { cur!.lightMinutes += s.minutes } else { cur!.deepMinutes += s.minutes }
                cur!.end = date(s.end)
                if next == nil { cur!.isPartial = true; close(at: s.end) }
                continue
            }
            guard cur != nil else { continue }
            let nextAsleep = next?.status.isAsleep ?? false
            switch s.status {
            case .awake where s.minutes <= maxAwakeInside && nextAsleep:
                closeRun(at: s.start)
                cur!.awakeMinutes += s.minutes
            case .unknown where s.minutes <= maxBridge && nextAsleep && (prev?.consec == 2) && (next?.consec == 2):
                cur!.asleepMinutes += s.minutes
                cur!.bridgedMinutes += s.minutes
            default:
                close(at: s.start)
            }
        }
        if cur != nil { close(at: segs.last!.end) }
        return out
    }

    /// Groups episodes by wake date. The longest is the night; the rest are naps.
    public static func nights(_ raw: [SleepEntry], dataEndT10: Int?, zones: ZoneHistory) -> [SleepNight] {
        var groups: [String: (TimeZone, [SleepEpisode])] = [:]
        for ep in episodes(raw, dataEndT10: dataEndT10) {
            let tz = zones.zone(at: ep.end)
            let key = dayString(ep.end, tz)
            groups[key, default: (tz, [])].1.append(ep)
        }
        return groups.map { key, value in
            let sorted = value.1.sorted { $0.asleepMinutes > $1.asleepMinutes }
            return SleepNight(wakeDate: key, timeZone: value.0, main: sorted[0],
                              naps: Array(sorted.dropFirst()).sorted { $0.start < $1.start })
        }.sorted { $0.wakeDate > $1.wakeDate }
    }

    /// The seven wake dates ending `today` (oldest first), with gaps as nil.
    public static func trend(_ nights: [SleepNight], today: Date = Date(), zone: TimeZone = .current, days: Int = 7) -> [TrendPoint] {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
        let byDate = Dictionary(nights.map { ($0.wakeDate, $0) }, uniquingKeysWith: { a, _ in a })
        return (0..<days).reversed().map { back in
            let d = cal.date(byAdding: .day, value: -back, to: today)!
            let key = dayString(d, zone)
            let n = byDate[key]
            return TrendPoint(wakeDate: key, asleepMinutes: n?.main.asleepMinutes, isPartial: n?.main.isPartial ?? false)
        }
    }

    public static func dayString(_ d: Date, _ tz: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = tz
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    public static func clock(_ d: Date, _ tz: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = tz
        let c = cal.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour!, c.minute!)
    }
}
