import Foundation
import UIKit

@MainActor
final class BridgeStore: ObservableObject {
    @Published private(set) var state: BridgeState?
    @Published private(set) var events: [BridgeEvent]?
    @Published private(set) var stats: BridgeStats?
    @Published private(set) var errorMessage: String?
    @Published private(set) var isLoading = false

    private var lastSeenStatus: BridgeStatus?
    private var refreshTimer: Timer?

    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        async let history: [BridgeEvent]? = try? APIClient.shared.getHistory(days: 7)
        async let statistics: BridgeStats? = try? APIClient.shared.getStats(days: 7)
        let state: BridgeState
        var failures: [String] = []
        do {
            state = try await APIClient.shared.getStatus()
            guard !Task.isCancelled else { return }

            if let last = lastSeenStatus, last != state.status {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
            lastSeenStatus = state.status
            if self.state?.status != state.status { self.stats = nil }
            self.state = state
        } catch {
            guard !Task.isCancelled else { return }
            let message = (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
            failures.append("Status could not be refreshed: \(message)")
            if self.state != nil { failures.insert("Showing the last known status.", at: 0) }
            self.events = nil
            self.stats = nil
            errorMessage = failures.joined(separator: "\n")
            return
        }

        let (events, stats) = await (history, statistics)
        guard !Task.isCancelled else { return }
        if events == nil { failures.append("History could not be refreshed.") }
        if stats == nil { failures.append("Stats could not be refreshed.") }

        // Auxiliary failures must not hide a valid primary status or turn a
        // failed history request into a successful empty history.
        self.events = events
        self.stats = stats
        errorMessage = failures.isEmpty ? nil : failures.joined(separator: "\n")

        // Updating with cached status would renew the activity's stale date
        // even though no new primary data was received.
        await LiveActivityController.shared.updateIfRunning(with: state, stats: stats)
    }

    func startAutoRefresh() {
        stopAutoRefresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    func stopAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }
}
