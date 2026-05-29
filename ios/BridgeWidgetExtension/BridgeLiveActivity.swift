import ActivityKit
import SwiftUI
import WidgetKit

struct BridgeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BridgeActivityAttributes.self) { context in
            LockScreenLiveActivityView(context: context)
                .activityBackgroundTint(.black.opacity(0.85))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(context.attributes.bridgeName)
                            .font(.caption2.bold())
                            .lineLimit(1)
                    } icon: {
                        Image(systemName: "road.lanes")
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    statusPill(context.state.status)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    if let roadway = context.attributes.roadway {
                        Text(roadway)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    let now = Date()
                    VStack(spacing: 2) {
                        HStack {
                            Text(context.state.status.isTrafficStopped
                                 ? "Traffic stopped"
                                 : "Open to traffic")
                                .font(.callout.bold())
                            Spacer()
                        }
                        HStack {
                            Text(durationLabel(context.state, now: now))
                            Spacer()
                            durationTimer(context.state, now: now)
                                .monospacedDigit()
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                Image(systemName: "road.lanes")
                    .foregroundStyle(color(for: context.state.status))
            } compactTrailing: {
                Text(context.state.status.label)
                    .font(.caption.bold())
                    .foregroundStyle(color(for: context.state.status))
            } minimal: {
                Image(systemName: context.state.status.symbolName)
                    .foregroundStyle(color(for: context.state.status))
            }
            .widgetURL(URL(string: "bridgetracker://status"))
            .keylineTint(color(for: context.state.status))
        }
    }

    private func color(for status: BridgeStatus) -> Color {
        switch status {
        case .up: return .red
        case .down: return .green
        case .unknown: return .gray
        }
    }

    @ViewBuilder
    private func statusPill(_ status: BridgeStatus) -> some View {
        HStack(spacing: 4) {
            Image(systemName: status.symbolName)
            Text(status.label)
        }
        .font(.caption.bold())
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(color(for: status).opacity(0.2), in: .capsule)
        .foregroundStyle(color(for: status))
    }
}

struct LockScreenLiveActivityView: View {
    let context: ActivityViewContext<BridgeActivityAttributes>

    var body: some View {
        let now = Date()
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(context.attributes.bridgeName, systemImage: "road.lanes")
                    .font(.footnote.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Text(context.state.lastPolledAt, style: .relative)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: context.state.status.symbolName)
                    .font(.title)
                    .foregroundStyle(color(for: context.state.status))
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.status.isTrafficStopped ? "Traffic stopped" : "Open to traffic")
                        .font(.title3.bold())
                    HStack(spacing: 4) {
                        Text(durationLabel(context.state, now: now))
                        durationTimer(context.state, now: now)
                            .monospacedDigit()
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func color(for status: BridgeStatus) -> Color {
        switch status {
        case .up: return .red
        case .down: return .green
        case .unknown: return .gray
        }
    }
}

// MARK: - Duration display
//
// The activity leads with an estimated countdown to the next change — "Next
// opening in 4:32" while open to traffic, "Open to traffic in 1:05" while a boat
// is passing. `Text(timerInterval:)` ticks on-device every second with no push
// and clamps at 0:00 once the estimate is reached, so the activity keeps moving
// between APNs updates instead of looking frozen. When there isn't enough
// history to predict the next change we fall back to elapsed time in the current
// state, which also ticks on its own.

private func nextChange(
    _ state: BridgeActivityAttributes.ContentState,
    now: Date
) -> (label: String, date: Date)? {
    switch state.status {
    case .down:
        guard let d = state.predictedNextOpenAt, d > now else { return nil }
        return ("Next opening in", d)
    case .up:
        guard let d = state.predictedNextCloseAt, d > now else { return nil }
        return ("Open to traffic in", d)
    case .unknown:
        return nil
    }
}

private func durationLabel(
    _ state: BridgeActivityAttributes.ContentState,
    now: Date
) -> String {
    nextChange(state, now: now)?.label ?? "In this state for"
}

@ViewBuilder
private func durationTimer(
    _ state: BridgeActivityAttributes.ContentState,
    now: Date
) -> some View {
    if let nc = nextChange(state, now: now) {
        Text(timerInterval: now...nc.date, countsDown: true)
    } else {
        Text(state.statusChangedAt, style: .timer)
    }
}
