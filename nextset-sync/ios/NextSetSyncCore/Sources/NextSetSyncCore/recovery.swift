import Foundation

/// Resting heart rate per night, from the Health log rows that fall inside the
/// night's main sleep episode (Sleep Log). Missing data stays missing.
public struct RecoveryNight: Hashable, Identifiable, Sendable {
    public var wakeDate: String
    /// Lowest 30-minute mean heart rate while asleep, or nil without 3 consecutive readings.
    public var restingHR: Int?
    /// Median resting heart rate of up to 7 earlier nights, or nil with fewer than 3.
    public var baselineHR: Int?
    public var readings: Int
    public var id: String { wakeDate }
    public var delta: Int? { restingHR.flatMap { r in baselineHR.map { r - $0 } } }
}

public enum RecoveryAnalyzer {
    public static func restingHR(_ rows: [HealthRow], from start: Date, to end: Date) -> (Int?, Int) {
        let lo = Int(start.timeIntervalSince1970 / 600), hi = Int(end.timeIntervalSince1970 / 600)
        let inside = rows.filter { $0.t10 >= lo && $0.t10 < hi && $0.bpm != nil }.sorted { $0.t10 < $1.t10 }
        var best: Double?
        if inside.count >= 3 {
            for i in 0...(inside.count - 3) {
                let w = inside[i..<(i + 3)]
                guard w.last!.t10 - w.first!.t10 == 2 else { continue } // 30 contiguous minutes
                let mean = w.reduce(0) { $0 + $1.bpm! } / 3
                best = Swift.min(best ?? mean, mean)
            }
        }
        return (best.map { Int($0.rounded()) }, inside.count)
    }

    /// One entry per night, newest first, with a baseline from earlier nights.
    public static func nights(_ nights: [SleepNight], rows: [HealthRow]) -> [RecoveryNight] {
        let ordered = nights.sorted { $0.wakeDate < $1.wakeDate }
        var out: [RecoveryNight] = []
        for n in ordered {
            let (r, count) = restingHR(rows, from: n.main.start, to: n.main.end)
            let earlier = out.suffix(7).compactMap(\.restingHR).sorted()
            let base = earlier.count >= 3 ? earlier[earlier.count / 2] : nil
            out.append(RecoveryNight(wakeDate: n.wakeDate, restingHR: r, baselineHR: base, readings: count))
        }
        return out.reversed()
    }
}
