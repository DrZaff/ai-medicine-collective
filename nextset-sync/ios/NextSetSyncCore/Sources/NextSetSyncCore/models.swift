import Foundation

/// Weight units. NextSet stores `units` as "lb" or "kg" on every log row.
public enum Units: String, Codable, CaseIterable, Sendable {
    case lb, kg
    /// Default load step on the watch's +/- buttons.
    public var defaultIncrement: Double { self == .kg ? 2.5 : 5 }
}

/// One prescribed exercise. Field names follow NextSet's prescription objects
/// (`src/workouts.mjs` `prescription()`): id, name, sets, reps (a range string
/// such as "8–12"), rir, rest (seconds), tempo, kind, cue.
public struct WorkoutExercise: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var sets: Int
    public var reps: String
    public var rir: Double?
    public var rest: Int
    /// Optional starting load suggestion shown on the watch.
    public var load: Double?
    public var tempo: String?
    public var kind: String?
    public var cue: String?
    /// Per-exercise +/- step; nil uses the workout units' default.
    public var increment: Double?

    public init(id: String, name: String, sets: Int, reps: String, rir: Double? = 2, rest: Int = 90,
                load: Double? = nil, tempo: String? = nil, kind: String? = nil, cue: String? = nil,
                increment: Double? = nil) {
        self.id = id; self.name = name; self.sets = sets; self.reps = reps; self.rir = rir
        self.rest = rest; self.load = load; self.tempo = tempo; self.kind = kind; self.cue = cue
        self.increment = increment
    }
}

public enum WorkoutSource: String, Codable, Sendable {
    case sample, created, imported, nextset
}

/// A workout the phone can send to the watch.
public struct Workout: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    /// Increases on every edit, so the watch and phone can tell versions apart.
    public var rev: Int
    public var name: String
    public var units: Units
    public var exercises: [WorkoutExercise]
    public var source: WorkoutSource
    public var notes: String?
    public var updatedAt: Date

    public init(id: String = UUID().uuidString.lowercased(), rev: Int = 1, name: String, units: Units,
                exercises: [WorkoutExercise], source: WorkoutSource, notes: String? = nil,
                updatedAt: Date = Date()) {
        self.id = id; self.rev = rev; self.name = name; self.units = units; self.exercises = exercises
        self.source = source; self.notes = notes; self.updatedAt = updatedAt
    }

    /// Limits the watch enforces (lib.js `validWorkout`).
    public func validate() throws {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { throw WorkoutError.invalid("Give the workout a name.") }
        guard (1...12).contains(exercises.count) else { throw WorkoutError.invalid("A workout needs 1 to 12 exercises.") }
        for e in exercises {
            guard !e.name.trimmingCharacters(in: .whitespaces).isEmpty else { throw WorkoutError.invalid("Every exercise needs a name.") }
            guard (1...10).contains(e.sets) else { throw WorkoutError.invalid("\(e.name): choose 1 to 10 sets.") }
            guard (0...900).contains(e.rest) else { throw WorkoutError.invalid("\(e.name): rest must be 0 to 900 seconds.") }
            if let r = e.rir, !(0...10).contains(r) { throw WorkoutError.invalid("\(e.name): RIR must be 0 to 10.") }
        }
    }
}

public enum WorkoutError: Error, LocalizedError, Equatable {
    case invalid(String)
    case unreadable(String)
    public var errorDescription: String? {
        switch self { case .invalid(let s), .unreadable(let s): return s }
    }
}

/// Where a record stands between the watch and the phone.
public enum AckState: String, Codable, Sendable {
    /// Saved durably on the iPhone; the watch has not yet confirmed it deleted its copy.
    case awaitingWatchAck
    /// The watch confirmed the acknowledgment; the record exists only here now.
    case confirmed
}

/// A logged set. Mirrors NextSet's log rows (sessionId, workout, exercise,
/// exerciseId, exerciseIndex, set, load, units, reps, rir) plus the sync
/// identity: `id` is stable for the life of the set; `rev` increases on edit.
public struct SetRecord: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var rev: Int
    public var sessionId: String
    public var workoutId: String
    public var workoutName: String
    public var exerciseIndex: Int
    public var exerciseId: String
    public var exerciseName: String
    public var setNumber: Int
    public var load: Double
    public var units: Units
    public var reps: Int
    public var rir: Double
    public var loggedAt: Date
    public var editedAt: Date?
    public var deleted: Bool
    public var receivedAt: Date
    public var ackState: AckState
    public var isDemo: Bool

    public init(id: String, rev: Int, sessionId: String, workoutId: String, workoutName: String,
                exerciseIndex: Int, exerciseId: String, exerciseName: String, setNumber: Int,
                load: Double, units: Units, reps: Int, rir: Double, loggedAt: Date, editedAt: Date? = nil,
                deleted: Bool = false, receivedAt: Date = Date(), ackState: AckState = .awaitingWatchAck,
                isDemo: Bool = false) {
        self.id = id; self.rev = rev; self.sessionId = sessionId; self.workoutId = workoutId
        self.workoutName = workoutName; self.exerciseIndex = exerciseIndex; self.exerciseId = exerciseId
        self.exerciseName = exerciseName; self.setNumber = setNumber; self.load = load; self.units = units
        self.reps = reps; self.rir = rir; self.loggedAt = loggedAt; self.editedAt = editedAt
        self.deleted = deleted; self.receivedAt = receivedAt; self.ackState = ackState; self.isDemo = isDemo
    }
}

/// The watch's "workout finished" record.
public struct SessionRecord: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var rev: Int
    public var workoutId: String
    public var workoutName: String
    public var units: Units
    public var start: Date
    public var end: Date
    public var setCount: Int
    public var receivedAt: Date
    public var ackState: AckState
    public var isDemo: Bool
}

/// A session as the app shows it: its sets plus, once finished, its end record.
public struct SessionSummary: Identifiable, Hashable, Sendable {
    public var id: String
    public var workoutName: String
    public var start: Date
    public var end: Date?
    public var finished: Bool
    public var sets: [SetRecord]
    public var awaitingAck: Int { sets.filter { $0.ackState == .awaitingWatchAck }.count }
    public var isDemo: Bool { sets.first?.isDemo ?? false }
}

/// A moment marked on the watch ("Coffee", "Idea"...). Synced like sets:
/// stable id, rev, acknowledged only after it is stored.
public struct MarkerRecord: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var rev: Int
    public var label: String
    public var at: Date
    public var deleted: Bool
    public var receivedAt: Date
    public var ackState: AckState
    public var isDemo: Bool
}
