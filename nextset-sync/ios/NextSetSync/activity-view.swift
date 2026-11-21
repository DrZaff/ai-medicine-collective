import Charts
import NextSetSyncCore
import SwiftUI

/// Daily steps and outdoor runs and walks from the watch. Everything here is
/// drawn from this app's own store: the route plot is local (no map service).

/// Today's steps and the week, for the Today screen.
struct StepsRows: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let days = Array(model.dailySteps.suffix(7))
        let today = StepsRows.dateKey(Date())
        if days.isEmpty {
            Text("Daily steps appear after a sync with watch app 0.03 or later.").foregroundStyle(.secondary)
        } else {
            LabeledContent("Steps today", value: (days.last { $0.date == today }?.steps).map { $0.formatted() } ?? "–")
            Chart(days) { d in
                BarMark(x: .value("Day", StepsRows.weekday(d.date)), y: .value("Steps", d.steps))
                    .foregroundStyle(d.date == today ? Color.accentColor : Color.accentColor.opacity(0.45))
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 120)
            .accessibilityLabel("Steps, last \(days.count) days")
            .accessibilityValue(days.map { "\(StepsRows.weekday($0.date)) \($0.steps)" }.joined(separator: ", "))
        }
    }

    static func dateKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
    /// "Mon" for "2026-11-16" (the watch's local date, read as a calendar day).
    static func weekday(_ key: String) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: key) else { return key }
        let out = DateFormatter(); out.dateFormat = "EEE"
        return out.string(from: d)
    }
}

struct ActivityRow: View {
    let activity: ActivityRecord
    var body: some View {
        HStack {
            Image(systemName: activity.mode == "walk" ? "figure.walk" : "figure.run").frame(width: 24)
            VStack(alignment: .leading) {
                Text(activity.title).font(.headline)
                Text(activity.start.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text(String(format: "%.2f %@", activity.distanceInUnits, activity.units))
                Text("\(Clock.text(activity.averagePace))/\(activity.units)").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct ActivitiesView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        List(model.activities) { a in
            NavigationLink { ActivityDetail(activity: a) } label: { ActivityRow(activity: a) }
        }
        .navigationTitle("Runs and walks")
    }
}

struct ActivityDetail: View {
    let activity: ActivityRecord

    var body: some View {
        List {
            Section {
                RoutePlot(route: activity.route)
                    .frame(height: 260)
                    .listRowInsets(EdgeInsets())
            } footer: {
                Text(activity.routeCut ? "The watch ran low on storage, so the route is cut short; distance and times are complete."
                                       : "Drawn on this iPhone from the watch's GPS points. No map service is used.")
            }
            Section {
                LabeledContent("Distance", value: String(format: "%.2f %@", activity.distanceInUnits, activity.units == "km" ? "km" : "miles"))
                LabeledContent("Moving time", value: Clock.text(Double(activity.movingS)))
                LabeledContent("Elapsed", value: Clock.text(Double(activity.elapsedS)))
                LabeledContent("Average pace", value: "\(Clock.text(activity.averagePace)) per \(activity.units)")
                LabeledContent("Started", value: activity.start.formatted(date: .abbreviated, time: .shortened))
            }
            if !activity.splits.isEmpty {
                Section(activity.units == "km" ? "Kilometres" : "Miles") {
                    ForEach(Array(activity.splits.enumerated()), id: \.offset) { i, s in
                        LabeledContent("\(activity.units == "km" ? "Km" : "Mile") \(i + 1)", value: Clock.text(Double(s)))
                    }
                }
            }
        }
        .navigationTitle(activity.title)
    }
}

/// The route as a line, scaled to fit, north up, start green and end red.
struct RoutePlot: View {
    let route: [RoutePoint]

    var body: some View {
        Canvas { ctx, size in
            guard route.count > 1 else {
                ctx.draw(Text("No route points").foregroundStyle(.secondary), at: CGPoint(x: size.width / 2, y: size.height / 2))
                return
            }
            let pts = RoutePlot.project(route, in: size, inset: 16)
            var path = Path()
            path.addLines(pts)
            ctx.stroke(path, with: .color(.accentColor), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            for (p, c) in [(pts.first!, Color.green), (pts.last!, Color.red)] {
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12)), with: .color(c))
            }
        }
        .background(Color(.secondarySystemBackground))
        .accessibilityLabel("Route with \(route.count) points")
    }

    /// Equirectangular projection around the route's middle, same scale on both axes.
    static func project(_ r: [RoutePoint], in size: CGSize, inset: CGFloat) -> [CGPoint] {
        let lat0 = (r.map(\.lat).min()! + r.map(\.lat).max()!) / 2
        let k = cos(lat0 * .pi / 180)
        let xs = r.map { $0.lon * k }, ys = r.map(\.lat)
        let w = max(xs.max()! - xs.min()!, 1e-9), h = max(ys.max()! - ys.min()!, 1e-9)
        let scale = min((size.width - 2 * inset) / w, (size.height - 2 * inset) / h)
        let ox = (size.width - w * scale) / 2, oy = (size.height - h * scale) / 2
        return zip(xs, ys).map { CGPoint(x: ox + ($0 - xs.min()!) * scale, y: oy + (ys.max()! - $1) * scale) }
    }
}
