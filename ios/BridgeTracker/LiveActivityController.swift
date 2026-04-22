import ActivityKit
import Foundation
import UIKit

@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()

    private var activity: Activity<BridgeActivityAttributes>?
    private var pushTokenObserver: Task<Void, Never>?

    var isRunning: Bool { activity != nil }

    func start(with state: BridgeState) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            print("Live Activities disabled by user")
            return
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
            let act = try Activity.request(
                attributes: attrs,
                content: content,
                pushType: .token
            )
            self.activity = act
            watchPushToken(act)
        } catch {
            print("Live Activity start failed: \(error.localizedDescription)")
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
