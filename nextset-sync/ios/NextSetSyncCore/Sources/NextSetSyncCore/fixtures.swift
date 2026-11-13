import Foundation

/// Bundled sample workouts and demo data. All synthetic.
public enum Samples {
    /// Exercise ids and cues match NextSet's starter library (src/core.mjs).
    public static let fullBodyA = Workout(
        id: "sample-full-body-a", rev: 1, name: "Full Body A", units: .lb,
        exercises: [
            WorkoutExercise(id: "goblet", name: "Goblet squat", sets: 3, reps: "8-12", rir: 2, rest: 120, load: 45,
                            tempo: "2-1-2", kind: "compound", cue: "Brace your trunk; keep feet planted."),
            WorkoutExercise(id: "press", name: "Neutral-grip dumbbell press", sets: 3, reps: "8-12", rir: 2, rest: 120, load: 40,
                            tempo: "2-1-2", kind: "compound", cue: "Use a comfortable range; keep shoulders controlled."),
            WorkoutExercise(id: "row", name: "Chest-supported dumbbell row", sets: 3, reps: "10-12", rir: 2, rest: 90, load: 35,
                            tempo: "2-1-2", kind: "compound", cue: "Support your chest; pull without shrugging."),
            WorkoutExercise(id: "rdl", name: "Dumbbell Romanian deadlift", sets: 2, reps: "8-10", rir: 3, rest: 120, load: 40,
                            tempo: "2-1-2", kind: "compound", cue: "Hinge at your hips; keep the weights close."),
            WorkoutExercise(id: "lateral", name: "Dumbbell lateral raise", sets: 2, reps: "12-15", rir: 2, rest: 60, load: 12.5,
                            tempo: "2-1-2", kind: "accessory", cue: "Use a comfortable arc without shrugging."),
        ],
        source: .sample, notes: "Bundled sample. Warm up 5 minutes, then 1-2 lighter practice sets for the first lifts.",
        updatedAt: Date(timeIntervalSince1970: 1_794_000_000))

    public static let quickTest = Workout(
        id: "sample-quick-test", rev: 1, name: "Quick test (2 sets)", units: .lb,
        exercises: [WorkoutExercise(id: "pushup", name: "Incline push-up", sets: 2, reps: "8-12", rir: 2, rest: 30, load: 0,
                                    kind: "compound")],
        source: .sample, notes: "Two sets, 30-second rest: the fastest way to run the first-day acceptance test.",
        updatedAt: Date(timeIntervalSince1970: 1_794_000_000))

    public static let all = [quickTest, fullBodyA]
}

/// Realistic demo data relative to `now`, for trying the app without a watch.
public enum DemoData {
    /// Nine nights of Sleep Log transitions ending this morning, including a
    /// night past midnight, an afternoon nap, a 'not worn' charging gap, and a
    /// night still in progress if `now` is before 07:00.
    public static func sleep(now: Date = Date(), zone: TimeZone = .current) -> (entries: [SleepEntry], dataEndT10: Int) {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
        let today = cal.startOfDay(for: now)
        var out: [SleepEntry] = []
        func add(_ day: Int, _ minutes: Int, _ s: Int, _ c: Int) {
            let base = cal.date(byAdding: .day, value: day, to: today)!
            let d = base.addingTimeInterval(TimeInterval(minutes * 60))
            out.append(SleepEntry(t10: Int(d.timeIntervalSince1970 / 600), status: s, consec: c))
        }
        // (bedtime minutes after the evening's midnight, wake minutes after, awake spell?)
        let plans: [(Int, Int, Bool)] = [(23 * 60 + 10, 30 * 60 + 40, true), (23 * 60 + 40, 31 * 60, false),
                                         (24 * 60 + 30, 32 * 60, true), (22 * 60 + 50, 30 * 60 + 20, false),
                                         (23 * 60 + 20, 29 * 60 + 50, true), (23 * 60, 30 * 60 + 30, true),
                                         (22 * 60 + 40, 30 * 60 + 10, false), (23 * 60 + 30, 31 * 60 + 20, true),
                                         (23 * 60 + 10, 30 * 60 + 50, false)]
        for (i, p) in plans.enumerated() {
            let evening = i - plans.count  // -9 ... -1
            add(evening, 21 * 60, 2, 1)
            if i == 3 { add(evening, 19 * 60, 1, 1); add(evening, 20 * 60, 2, 1) } // charging
            add(evening, p.0, 4, 0)
            add(evening, p.0 + 30, 4, 2)
            add(evening, p.0 + 140, 3, 2)
            add(evening, p.0 + 200, 4, 2)
            if p.2 { add(evening, p.0 + 260, 2, 2); add(evening, p.0 + 280, 3, 2) }
            add(evening, p.0 + 330, 4, 2)
            add(evening, p.1 - 70, 3, 2)
            add(evening, p.1, 2, 0)
            add(evening, p.1 + 60, 2, 1)
        }
        // Afternoon nap two days ago.
        add(-2, 14 * 60 + 10, 4, 0); add(-2, 14 * 60 + 40, 4, 2); add(-2, 15 * 60, 2, 0); add(-2, 16 * 60, 2, 1)
        let nowT10 = Int(now.timeIntervalSince1970 / 600)
        let kept = out.filter { $0.t10 <= nowT10 }.sorted { $0.t10 < $1.t10 }
        return (kept, nowT10)
    }

    /// Two earlier sessions of Full Body A, already synced.
    public static func history(now: Date = Date()) -> [WireRecord] {
        var out: [WireRecord] = []
        for (n, daysAgo) in [6, 3].enumerated() {
            let start = now.addingTimeInterval(TimeInterval(-daysAgo * 86400 - 3600))
            let sid = "demo-\(Int(start.timeIntervalSince1970))"
            var t = start
            for (xi, ex) in Samples.fullBodyA.exercises.enumerated() {
                for s in 1...ex.sets {
                    t = t.addingTimeInterval(TimeInterval(ex.rest + 40))
                    let load = (ex.load ?? 0) + Double(n) * (Samples.fullBodyA.units.defaultIncrement)
                    out.append(WireRecord(k: "set", id: "\(sid).\(xi).\(s)", rev: 1, sid: sid, wid: Samples.fullBodyA.id,
                                          wn: Samples.fullBodyA.name, xi: xi, xid: ex.id, xn: ex.name, set: s, load: load,
                                          units: "lb", reps: 10 - s + n, rir: max(0, (ex.rir ?? 2) - Double(s - 1)),
                                          at: t.timeIntervalSince1970 * 1000, ed: nil, del: nil, start: nil, end: nil, n: nil))
                }
            }
            out.append(WireRecord(k: "ses", id: sid, rev: 1, sid: sid, wid: Samples.fullBodyA.id, wn: Samples.fullBodyA.name,
                                  xi: nil, xid: nil, xn: nil, set: nil, load: nil, units: "lb", reps: nil, rir: nil,
                                  at: t.timeIntervalSince1970 * 1000, ed: nil, del: nil,
                                  start: start.timeIntervalSince1970 * 1000, end: t.timeIntervalSince1970 * 1000, n: 13))
        }
        return out
    }
}
