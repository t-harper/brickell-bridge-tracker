import SwiftUI
import MapKit

struct ContentView: View {
    @EnvironmentObject var store: BridgeStore
    @State private var liveActivityRunning = LiveActivityController.shared.isRunning
    @State private var liveActivityError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let state = store.state {
                        StatusCard(state: state)
                        liveActivityButton
                        if state.metadata.lat != nil, state.metadata.lon != nil {
                            BridgeMapView(state: state)
                        }
                        if let stats = store.stats {
                            StatsCard(stats: stats)
                        }
                        HistoryCard(events: store.events)
                    } else if let msg = store.errorMessage {
                        ContentUnavailableView(
                            "Couldn’t load",
                            systemImage: "exclamationmark.triangle",
                            description: Text(msg)
                        )
                        .padding(.top, 60)
                    } else {
                        ProgressView().padding(.top, 80)
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .navigationTitle("Brickell Bridge")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await store.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await store.refresh() } } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh")
                }
            }
        }
        .onAppear { store.startAutoRefresh() }
        .onDisappear { store.stopAutoRefresh() }
        .alert(
            "Couldn’t start Live Activity",
            isPresented: Binding(
                get: { liveActivityError != nil },
                set: { if !$0 { liveActivityError = nil } }
            ),
            presenting: liveActivityError
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { msg in
            Text(msg)
        }
    }

    private var liveActivityButton: some View {
        Button {
            Task {
                do {
                    if liveActivityRunning {
                        await LiveActivityController.shared.stop()
                    } else if let state = store.state {
                        try await LiveActivityController.shared.start(with: state, stats: store.stats)
                    }
                } catch {
                    liveActivityError = (error as? LocalizedError)?.errorDescription
                        ?? error.localizedDescription
                }
                liveActivityRunning = LiveActivityController.shared.isRunning
            }
        } label: {
            Label(
                liveActivityRunning ? "Stop Live Activity" : "Track on Lock Screen",
                systemImage: liveActivityRunning ? "stop.circle" : "pin.circle"
            )
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .tint(liveActivityRunning ? .red : .accentColor)
    }
}

struct StatusCard: View {
    let state: BridgeState

    private var accent: Color { state.status.isTrafficStopped ? .red : .green }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Label(state.status.label, systemImage: state.status.symbolName)
                    .font(.largeTitle.bold())
                    .foregroundStyle(accent)
                Spacer()
            }
            Text(state.status.isTrafficStopped
                 ? "Traffic stopped"
                 : "Open to traffic")
                .font(.title3)
                .foregroundStyle(.secondary)

            Text("for \(Formatting.duration(Int(Date().timeIntervalSince(state.statusChangedAt))))")
                .font(.callout)
                .foregroundStyle(.secondary)

            Divider().padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 6) {
                metadataRow("Roadway", state.metadata.roadway)
                metadataRow("Location", state.metadata.location)
                metadataRow("County", state.metadata.county)
                metadataRow("Direction", state.metadata.direction)
                metadataRow("Waterway", state.metadata.waterway)
            }
            .font(.subheadline)

            Text("Last poll \(Formatting.relative(state.lastPolledAt))")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .padding(.top, 4)
        }
        .padding()
        .background(.regularMaterial, in: .rect(cornerRadius: 14))
    }

    @ViewBuilder
    private func metadataRow(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack {
                Text(label).foregroundStyle(.secondary)
                Spacer()
                Text(value)
            }
        }
    }
}

struct StatsCard: View {
    let stats: BridgeStats
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Last \(stats.windowDays) days")
                .font(.headline)
            Grid(horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    stat("Openings", "\(stats.opens)")
                    stat("Avg open",
                         stats.avgOpenDurationSec.map { Formatting.duration($0) } ?? "—")
                }
                GridRow {
                    stat("Longest open",
                         stats.longestOpenDurationSec.map { Formatting.duration($0) } ?? "—")
                    stat("Now \(stats.currentStatus.label.lowercased()) for",
                         Formatting.duration(stats.currentStatusSinceSec))
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: .rect(cornerRadius: 14))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.bold()).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct HistoryCard: View {
    let events: [BridgeEvent]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent status changes")
                .font(.headline)
            if events.isEmpty {
                Text("No status changes recorded yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(events.prefix(20)) { event in
                    HStack(spacing: 10) {
                        Image(systemName: event.to.symbolName)
                            .foregroundStyle(event.to.isTrafficStopped ? .red : .green)
                        VStack(alignment: .leading) {
                            Text("\(event.from.label) → \(event.to.label)")
                                .font(.subheadline)
                            Text(event.ts, format: .dateTime.month(.abbreviated).day().hour().minute())
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let d = event.durationOfPrevStateSec {
                            Text(Formatting.duration(d))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    if event != events.prefix(20).last { Divider() }
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: .rect(cornerRadius: 14))
    }
}
