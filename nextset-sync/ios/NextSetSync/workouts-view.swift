import NextSetSyncCore
import SwiftUI
import UniformTypeIdentifiers

struct WorkoutsView: View {
    @Environment(AppModel.self) private var model
    @State private var importing = false
    @State private var editing: Workout?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.workouts) { w in
                        NavigationLink(value: w.id) { WorkoutRow(workout: w, onWatch: model.link.sentWorkoutId == w.id && model.link.sentWorkoutRev == w.rev) }
                    }
                } footer: {
                    Text("Import a NextSet plan or workout (JSON), this app's workout files, or a text file with one exercise per line: \"Bench press, 3 x 6-8 @2, rest 120, 135\".")
                }
            }
            .navigationTitle("Workouts")
            .navigationDestination(for: String.self) { id in WorkoutDetail(id: id) }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("New workout", systemImage: "plus") {
                            editing = Workout(name: "", units: .lb, exercises: [WorkoutExercise(id: "", name: "", sets: 3, reps: "8-12")], source: .created)
                        }
                        Button("Import from Files", systemImage: "square.and.arrow.down") { importing = true }
                    } label: { Image(systemName: "plus") }
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .plainText, .text], allowsMultipleSelection: false) { result in
                if case .success(let urls) = result, let u = urls.first { model.importWorkouts(from: u) }
            }
            .sheet(item: $editing) { w in WorkoutEditor(workout: w) }
        }
    }
}

struct WorkoutRow: View {
    let workout: Workout
    let onWatch: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(workout.name).font(.headline)
                if onWatch { Label("On watch", systemImage: "applewatch").labelStyle(.iconOnly).foregroundStyle(.green) }
            }
            Text("\(workout.exercises.count) exercises · \(workout.exercises.reduce(0) { $0 + $1.sets }) sets · \(workout.source.rawValue)")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct WorkoutDetail: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var editing: Workout?

    var body: some View {
        if let w = model.workouts.first(where: { $0.id == id }) {
            List {
                Section {
                    Button {
                        Task { await model.send(w) }
                    } label: {
                        Label(model.link.sentWorkoutId == w.id && model.link.sentWorkoutRev == w.rev ? "Send again" : "Send to watch",
                              systemImage: "applewatch.and.arrow.forward").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canSync)
                    if !model.canSync { Text("Connect and pair the watch on the Watch tab first.").font(.footnote).foregroundStyle(.secondary) }
                    if let n = w.notes { Text(n).font(.footnote) }
                }
                Section("Exercises (\(w.units.rawValue))") {
                    ForEach(Array(w.exercises.enumerated()), id: \.offset) { _, e in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.name).font(.headline)
                            Text("\(e.sets) × \(e.reps)\(e.rir.map { " @ RIR \(fmt($0))" } ?? "") · rest \(e.rest)s\(e.load.map { " · start \(fmt($0)) \(w.units.rawValue)" } ?? "")")
                                .font(.subheadline).foregroundStyle(.secondary)
                            if let cue = e.cue { Text(cue).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
            .navigationTitle(w.name)
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if let url = try? model.workoutFile(w) { ShareLink(item: url) }
                    Menu {
                        Button(w.source == .sample ? "Edit a copy" : "Edit", systemImage: "pencil") {
                            var copy = w
                            if w.source == .sample { copy.id = UUID().uuidString.lowercased(); copy.name += " (copy)"; copy.source = .created; copy.rev = 1 }
                            editing = copy
                        }
                        if w.source != .sample {
                            Button("Delete", systemImage: "trash", role: .destructive) { model.delete(w); dismiss() }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .sheet(item: $editing) { WorkoutEditor(workout: $0) }
        } else {
            ContentUnavailableView("Workout not found", systemImage: "dumbbell")
        }
    }
}

func fmt(_ d: Double) -> String { d == d.rounded() ? String(Int(d)) : String(format: "%.1f", d) }

struct WorkoutEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let original: Workout
    /// Each exercise gets a row id of its own, so removing one never confuses SwiftUI.
    struct Row: Identifiable { let id = UUID(); var ex: WorkoutExercise }
    @State private var name: String
    @State private var units: Units
    @State private var rows: [Row]
    @State private var problem: String?

    init(workout: Workout) {
        original = workout
        _name = State(initialValue: workout.name)
        _units = State(initialValue: workout.units)
        _rows = State(initialValue: workout.exercises.map { Row(ex: $0) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Workout name", text: $name)
                    Picker("Units", selection: $units) { ForEach(Units.allCases, id: \.self) { Text($0.rawValue) } }
                        .pickerStyle(.segmented)
                }
                ForEach($rows) { $row in
                    Section {
                        TextField("Exercise name", text: $row.ex.name)
                        Stepper("Sets: \(row.ex.sets)", value: $row.ex.sets, in: 1...10)
                        TextField("Reps (e.g. 8-12)", text: $row.ex.reps)
                        Stepper("RIR: \(fmt(row.ex.rir ?? 2))", value: Binding(
                            get: { row.ex.rir ?? 2 }, set: { row.ex.rir = $0 }), in: 0...10, step: 1)
                        Stepper("Rest: \(row.ex.rest) s", value: $row.ex.rest, in: 0...600, step: 15)
                        TextField("Starting load (optional)", value: $row.ex.load, format: .number)
                            .keyboardType(.decimalPad)
                        if rows.count > 1 {
                            Button("Remove exercise", role: .destructive) {
                                let id = row.id
                                rows.removeAll { $0.id == id }
                            }
                        }
                    }
                }
                if rows.count < 12 {
                    Button("Add exercise", systemImage: "plus") {
                        rows.append(Row(ex: WorkoutExercise(id: "", name: "", sets: 3, reps: "8-12")))
                    }
                }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .navigationTitle(name.isEmpty ? "New workout" : name)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var w = original
                        w.name = name; w.units = units
                        w.exercises = rows.map { r in
                            var e = r.ex
                            if e.id.isEmpty || e.id.hasPrefix("exercise-") { e.id = WorkoutImporter.slug(e.name) }
                            return e
                        }
                        do { try w.validate(); model.save(w); dismiss() } catch { problem = error.localizedDescription }
                    }
                }
            }
        }
    }
}
