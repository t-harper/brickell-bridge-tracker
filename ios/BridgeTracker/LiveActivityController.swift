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

    // Started with pushType: nil — remote updates need an aps-environment
    // entitlement we don't have yet. Updates happen via updateIfRunning()
    // while the app is foreground; status will pause when the app is
    // backgrounded until push is wired up.
    func start(with state: BridgeState) async throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw LiveActivityStartError.notAuthorized
        }
        await stop()

        let attrs = BridgeActivityAttributes(
            bridgeName: "Brickell Avenue Bridge",
            roadway: state.metadata.roadway
        )
        let content = ActivityContent(
            state: BridgeActivityAttributes.ContentState(
                status: state.status,
                statusChangedAt: state.statusChangedAt,
                lastPolledAt: state.lastPolledAt
            ),
            staleDate: Date().addingTimeInterval(15 * 60)
        )

        do {
            self.activity = try Activity.request(
                attributes: attrs,
                content: content,
                pushType: nil
            )
        } catch {
            throw LiveActivityStartError.requestFailed(error)
        }
    }

    func updateIfRunning(with state: BridgeState) async {
        guard let act = activity else { return }
        let content = ActivityContent(
            state: BridgeActivityAttributes.ContentState(
                status: state.status,
                statusChangedAt: state.statusChangedAt,
                lastPolledAt: state.lastPolledAt
            ),
            staleDate: Date().addingTimeInterval(15 * 60)
        )
        await act.update(content)
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
