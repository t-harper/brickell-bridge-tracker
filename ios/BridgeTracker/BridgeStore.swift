import Foundation
import UIKit

@MainActor
final class BridgeStore: ObservableObject {
    @Published private(set) var state: BridgeState?
    @Published private(set) var events: [BridgeEvent] = []
    @Published private(set) var stats: BridgeStats?
    @Published private(set) var errorMessage: String?
    @Published private(set) var isLoading = false

    private var lastSeenStatus: BridgeStatus?
    private var refreshTimer: Timer?

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let s = APIClient.shared.getStatus()
            async let h = APIClient.shared.getHistory(days: 7)
            async let st = APIClient.shared.getStats(days: 7)
            let (state, events, stats) = try await (s, h, st)

            if let last = lastSeenStatus, last != state.status {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
            lastSeenStatus = state.status

            self.state = state
            self.events = events
            self.stats = stats
            self.errorMessage = nil

            await LiveActivityController.shared.updateIfRunning(with: state)
        } catch {
            self.errorMessage = (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
        }
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
