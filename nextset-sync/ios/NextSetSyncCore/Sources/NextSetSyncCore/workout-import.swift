import Foundation

/// Reads workouts from files the user picks. Accepted:
/// 1. This app's export: {"format":"nextset-sync-workout","version":1,"workout":{...}}
///    (or a bare Workout object, or an array of them).
/// 2. A NextSet prescription (`prescription()` in NextSet's src/workouts.mjs):
///    {"name", "week", "exercises":[{"id","name","sets","reps","rir","rest","tempo","kind","cue"}]}.
/// 3. A NextSet plan: {"sessions":[{"name","exercises":[...]}], "profile":{"units"}}; one workout per
///    session, using the week-1 target when an exercise has `weekTargets`.
/// 4. Plain text, one exercise per line:  "Bench press, 3 x 6-8 @2, rest 120, 135"
///    The first line may be "# Workout name" and "units: kg".
public enum WorkoutImporter {
    public static let formatName = "nextset-sync-workout"

    public static func importFile(_ data: Data, fileName: String, now: Date = Date()) throws -> [Workout] {
        if let text = String(data: data, encoding: .utf8), !text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{"),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("[") {
            return [try parseText(text, fallbackName: (fileName as NSString).deletingPathExtension, now: now)]
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) else {
            throw WorkoutError.unreadable("That file is not JSON or a text workout.")
        }
        var out: [Workout] = []
        if let arr = json as? [Any] {
            for item in arr { out += try fromObject(item, now: now) }
        } else {
            out = try fromObject(json, now: now)
        }
        guard !out.isEmpty else { throw WorkoutError.unreadable("No workouts found in that file.") }
        for w in out { try w.validate() }
        return out
    }

    static func fromObject(_ any: Any, now: Date) throws -> [Workout] {
        guard let o = any as? [String: Any] else { throw WorkoutError.unreadable("Unexpected JSON shape.") }
        if (o["format"] as? String) == formatName, let w = o["workout"] {
            return try fromObject(w, now: now).map { var c = $0; c.source = .imported; return c }
        }
        if let sessions = o["sessions"] as? [[String: Any]] {
            let units = Units(rawValue: ((o["profile"] as? [String: Any])?["units"] as? String) ?? "lb") ?? .lb
            let planId = (o["id"] as? String) ?? UUID().uuidString.lowercased()
            return try sessions.enumerated().map { i, s in
                try nextSetWorkout(s, units: units, id: "nextset-\(planId)-\(i)", now: now)
            }
        }
        if o["exercises"] != nil {
            if o["source"] as? String != nil || o["units"] is String, let w = try? decodeNative(o) { return [w] }
            let units = Units(rawValue: (o["units"] as? String) ?? "lb") ?? .lb
            return [try nextSetWorkout(o, units: units, id: (o["id"] as? String) ?? "nextset-\(UUID().uuidString.lowercased())", now: now)]
        }
        throw WorkoutError.unreadable("No exercises found.")
    }

    static func decodeNative(_ o: [String: Any]) throws -> Workout {
        let data = try JSONSerialization.data(withJSONObject: o)
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        var w = try dec.decode(Workout.self, from: data)
        w.source = .imported
        return w
    }

    static func nextSetWorkout(_ s: [String: Any], units: Units, id: String, now: Date) throws -> Workout {
        guard let exs = s["exercises"] as? [[String: Any]], !exs.isEmpty else { throw WorkoutError.unreadable("A session has no exercises.") }
        let exercises: [WorkoutExercise] = exs.enumerated().map { i, e in
            let target = (e["weekTargets"] as? [[String: Any]])?.first ?? e
            func num(_ k: String) -> Double? { (target[k] as? NSNumber)?.doubleValue ?? (e[k] as? NSNumber)?.doubleValue }
            func str(_ k: String) -> String? { (target[k] as? String) ?? (e[k] as? String) }
            return WorkoutExercise(id: (e["id"] as? String) ?? "ex\(i)", name: (e["name"] as? String) ?? "Exercise \(i + 1)",
                                   sets: Int(num("sets") ?? 2), reps: str("reps") ?? "8-12", rir: num("rir") ?? 2,
                                   rest: Int(num("rest") ?? 90), load: num("load"), tempo: str("tempo"),
                                   kind: e["kind"] as? String, cue: e["cue"] as? String)
        }
        var name = (s["name"] as? String) ?? "NextSet workout"
        if let week = (s["week"] as? NSNumber)?.intValue { name += " (week \(week))" }
        return Workout(id: id, name: name, units: units, exercises: exercises, source: .nextset, updatedAt: now)
    }

    /// "Bench press, 3 x 6-8 @2, rest 120, 135"  (sets x reps, @RIR, rest seconds, starting load)
    public static func parseText(_ text: String, fallbackName: String, now: Date = Date()) throws -> Workout {
        var name = fallbackName.isEmpty ? "Imported workout" : fallbackName
        var units = Units.lb
        var exercises: [WorkoutExercise] = []
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("#") { name = line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces); continue }
            if line.lowercased().hasPrefix("units:") {
                units = Units(rawValue: line.dropFirst(6).trimmingCharacters(in: .whitespaces).lowercased()) ?? .lb; continue
            }
            let parts = line.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            var ex = WorkoutExercise(id: slug(parts[0]), name: parts[0], sets: 3, reps: "8-12", rir: 2, rest: 90)
            for p in parts.dropFirst() {
                let lower = p.lowercased()
                if lower.hasPrefix("rest") {
                    ex.rest = Int(lower.filter(\.isNumber)) ?? ex.rest
                } else if let x = lower.range(of: "x") {
                    ex.sets = Int(lower[..<x.lowerBound].trimmingCharacters(in: .whitespaces)) ?? ex.sets
                    var rest = String(lower[x.upperBound...])
                    if let at = rest.firstIndex(of: "@") {
                        ex.rir = Double(rest[rest.index(after: at)...].trimmingCharacters(in: .whitespaces))
                        rest = String(rest[..<at])
                    }
                    ex.reps = rest.trimmingCharacters(in: .whitespaces)
                } else if lower.hasPrefix("@") {
                    ex.rir = Double(lower.dropFirst().trimmingCharacters(in: .whitespaces))
                } else if let load = Double(lower.filter { $0.isNumber || $0 == "." }), !lower.isEmpty {
                    ex.load = load
                }
            }
            exercises.append(ex)
        }
        let w = Workout(name: name, units: units, exercises: exercises, source: .imported, updatedAt: now)
        try w.validate()
        return w
    }

    public static func slug(_ s: String) -> String {
        let a = WireText.ascii(s).lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }
        return String(a).split(separator: "-").joined(separator: "-")
    }

    /// The file this app writes for sharing a workout.
    public static func exportData(_ w: Workout) throws -> Data {
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]; enc.dateEncodingStrategy = .iso8601
        struct Envelope: Encodable { let format: String; let version: Int; let workout: Workout }
        return try enc.encode(Envelope(format: formatName, version: 1, workout: w))
    }
}

/// CSV of set history. The first 13 columns are NextSet's own export columns
/// (src/core.mjs `csv()`), in the same order, so the file reads the same in
/// both apps; sync columns follow. Cells that a spreadsheet would run as a
/// formula are prefixed with ' (same rule as NextSet).
public enum SetCSV {
    public static let nextSetColumns = ["date", "workout", "exercise", "set", "load", "units", "reps", "rir", "pain",
                                        "tempo", "rest", "duration_seconds", "note"]
    public static let extraColumns = ["exercise_id", "session_id", "record_id", "rev", "logged_at", "edited_at",
                                      "sync_status", "deleted"]

    public static func make(_ sets: [SetRecord], zone: TimeZone = .current, includeDeleted: Bool = false) -> String {
        let iso = ISO8601DateFormatter(); iso.timeZone = zone
        iso.formatOptions = [.withInternetDateTime]
        let rows = sets.filter { includeDeleted || !$0.deleted }.sorted { ($0.loggedAt, $0.id) < ($1.loggedAt, $1.id) }.map { s -> [String] in
            [SleepAnalyzer.dayString(s.loggedAt, zone), s.workoutName, s.exerciseName, "\(s.setNumber)", fmt(s.load),
             s.units.rawValue, "\(s.reps)", fmt(s.rir), "", "", "", "", "",
             s.exerciseId, s.sessionId, s.id, "\(s.rev)", iso.string(from: s.loggedAt),
             s.editedAt.map { iso.string(from: $0) } ?? "",
             s.ackState == .confirmed ? "synced" : "saved_on_phone_awaiting_watch_ack", s.deleted ? "yes" : ""]
        }
        return ([nextSetColumns + extraColumns] + rows).map { $0.map(escape).joined(separator: ",") }.joined(separator: "\r\n") + "\r\n"
    }

    static func fmt(_ d: Double) -> String { d == d.rounded() ? String(Int(d)) : String(d) }

    static func escape(_ v: String) -> String {
        var s = v
        if let f = s.first, "=+@-\t\r".contains(f), Double(s) == nil { s = "'" + s }
        return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
