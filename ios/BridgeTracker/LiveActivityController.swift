import ActivityKit
import Foundation
import UIKit

enum LiveActivityStartError: Error, LocalizedError {
    case notAuthorized
    case requestFailed(Error)

    var errorDescription: String? {
        switch self {
        case .notAuthorized:
            return "Live Activities are turned off. Enable them in Settings → Brickell Bridge → Live Activities."
        case .requestFailed(let err):
            return err.localizedDescription
        }
    }
}

@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()

    private var activity: Activity<BridgeActivityAttributes>?
    private var pushTokenObserver: Task<Void, Never>?

    var isRunning: Bool { activity != nil }

    func start(with state: BridgeState, stats: BridgeStats? = nil) async throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw LiveActivityStartError.notAuthorized
        }
        await stop()

        let attrs = BridgeActivityAttributes(
            bridgeName: "Brickell Avenue Bridge",
            roadway: state.metadata.roadway
        )
        let content = ActivityContent(
            state: Self.contentState(from: state, stats: stats),
            staleDate: Self.staleDate(for: state, stats: stats)
        )

        do {
            let act = try Activity.request(
                attributes: attrs,
                content: content,
                pushType: .token
            )
            self.activity = act
            watchPushToken(act)
        } catch {
            throw LiveActivityStartError.requestFailed(error)
        }
    }

    func updateIfRunning(with state: BridgeState, stats: BridgeStats? = nil) async {
        guard let act = activity else { return }
        let content = ActivityContent(
            state: Self.contentState(from: state, stats: stats),
            staleDate: Self.staleDate(for: state, stats: stats)
        )
        await act.update(content)
    }

    // Keep the activity looking fresh until we'd expect the next change (plus a
    // little slack): if that moment passes with no APNs update the data really
    // might be stale, so letting the system dim it then is meaningful. Never go
    // stale sooner than a 30-minute floor — the on-device countdown keeps
    // ticking correctly without a push, so a near-term or missing prediction
    // shouldn't grey the activity out.
    private static func staleDate(for state: BridgeState, stats: BridgeStats?) -> Date {
        let predicted: Date?
        switch state.status {
        case .down: predicted = stats?.predictedNextOpenAt
        case .up: predicted = stats?.predictedNextCloseAt
        case .unknown: predicted = nil
        }
        let floor = Date().addingTimeInterval(30 * 60)
        guard let predicted else { return floor }
        return max(predicted.addingTimeInterval(10 * 60), floor)
    }

    private static func contentState(
        from state: BridgeState,
        stats: BridgeStats?
    ) -> BridgeActivityAttributes.ContentState {
        BridgeActivityAttributes.ContentState(
            status: state.status,
            statusChangedAt: state.statusChangedAt,
            lastPolledAt: state.lastPolledAt,
            predictedNextOpenAt: stats?.predictedNextOpenAt,
            predictedNextCloseAt: stats?.predictedNextCloseAt
        )
    }

    func stop() async {
        pushTokenObserver?.cancel()
        pushTokenObserver = nil
        guard let act = activity else { return }
        let deviceId = DeviceIdentity.deviceId
        let activityId = act.id
        await act.end(act.content, dismissalPolicy: .immediate)
        self.activity = nil
        Task { try? await APIClient.shared.endActivity(deviceId: deviceId, activityId: activityId) }
    }

    private func watchPushToken(_ act: Activity<BridgeActivityAttributes>) {
        pushTokenObserver?.cancel()
        pushTokenObserver = Task { [weak self] in
            for await tokenData in act.pushTokenUpdates {
                let hex = tokenData.map { String(format: "%02x", $0) }.joined()
                do {
                    try await APIClient.shared.registerActivity(
                        deviceId: DeviceIdentity.deviceId,
                        ActivityRegistrationRequest(
                            activityId: act.id,
                            activityPushToken: hex
                        )
                    )
                } catch {
                    print("Failed to register activity push token: \(error.localizedDescription)")
                }
                _ = self  // keep strong ref while observing
            }
        }
    }
}
