import SwiftUI
import WidgetKit

struct BridgeWidgetEntry: TimelineEntry {
    let date: Date
    let state: BridgeState?
    let error: String?
}

struct BridgeStatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> BridgeWidgetEntry {
        BridgeWidgetEntry(date: .now, state: Self.placeholderState, error: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (BridgeWidgetEntry) -> Void) {
        Task {
            let state = try? await APIClient.shared.getStatus()
            completion(BridgeWidgetEntry(date: .now, state: state, error: nil))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BridgeWidgetEntry>) -> Void) {
        Task {
            do {
                let state = try await APIClient.shared.getStatus()
                let entry = BridgeWidgetEntry(date: .now, state: state, error: nil)
                let nextRefresh = Date().addingTimeInterval(60 * 5)
                completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
            } catch {
                let entry = BridgeWidgetEntry(date: .now, state: nil, error: error.localizedDescription)
                completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(60 * 2))))
            }
        }
    }

    static var placeholderState: BridgeState {
        BridgeState(
            pk: "BRICKELL",
            status: .down,
            statusChangedAt: Date().addingTimeInterval(-600),
            lastPolledAt: Date(),
            metadata: BridgeMetadata(roadway: "US-1", location: "Brickell Avenue", direction: "N",
                                     county: "Miami-Dade", waterway: "Miami River",
                                     lat: 25.770124, lon: -80.190208),
            nearbyAlerts: []
        )
    }
}

struct BridgeStatusWidget: Widget {
    let kind: String = "BridgeStatusWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BridgeStatusProvider()) { entry in
            BridgeStatusWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Brickell Bridge")
        .description("Shows the current status of the Brickell Avenue Bridge.")
        .supportedFamilies([
            .systemSmall, .systemMedium,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct BridgeStatusWidgetView: View {
    var entry: BridgeWidgetEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch family {
            case .systemSmall: smallView
            case .systemMedium: mediumView
            case .accessoryCircular: circular
            case .accessoryRectangular: rectangular
            case .accessoryInline: inlineView
            default: smallView
            }
        }
    }

    private var status: BridgeStatus { entry.state?.status ?? .unknown }
    private var accent: Color {
        switch status {
        case .up: return .red
        case .down: return .green
        case .unknown: return .gray
        }
    }

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Brickell", systemImage: "road.lanes")
                .font(.caption2.bold())
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Image(systemName: status.symbolName)
                .font(.system(size: 34))
                .foregroundStyle(accent)
            Text(status.isTrafficStopped ? "Traffic stopped" : "Open to traffic")
                .font(.caption.bold())
                .lineLimit(2)
            if let state = entry.state {
                Text(Formatting.relative(state.statusChangedAt))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var mediumView: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Label("Brickell Avenue Bridge", systemImage: "road.lanes")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                HStack {
                    Image(systemName: status.symbolName)
                        .font(.largeTitle)
                        .foregroundStyle(accent)
                    Text(status.label)
                        .font(.largeTitle.bold())
                        .foregroundStyle(accent)
                }
                Text(status.isTrafficStopped ? "Traffic stopped" : "Open to traffic")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let state = entry.state {
                VStack(alignment: .trailing) {
                    Text(Formatting.relative(state.statusChangedAt))
                        .font(.caption.monospacedDigit())
                    Text("last change")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack {
                Image(systemName: status.symbolName)
                    .font(.title2)
                Text(status.label)
                    .font(.caption2)
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading) {
            Label("Brickell", systemImage: "road.lanes")
                .font(.caption2.bold())
            Text(status.isTrafficStopped ? "Up — traffic stopped" : "Down — open to traffic")
                .font(.body.bold())
            if let state = entry.state {
                Text("since \(Formatting.relative(state.statusChangedAt))")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var inlineView: some View {
        Text("Brickell: \(status.label)")
    }
}
