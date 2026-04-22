import AppIntents
import Foundation

struct CheckBridgeStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Brickell Bridge Status"
    static var description: IntentDescription = IntentDescription(
        "Returns whether the Brickell Avenue Bridge is currently up or down."
    )
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let state = try await APIClient.shared.getStatus()
        let sinceSec = Int(max(0, Date().timeIntervalSince(state.statusChangedAt)))
        let phrase: String
        switch state.status {
        case .up:
            phrase = "The Brickell Avenue Bridge is up and traffic is stopped. "
                   + "It's been up for \(Formatting.duration(sinceSec))."
        case .down:
            phrase = "The Brickell Avenue Bridge is down and open to traffic. "
                   + "It's been open for \(Formatting.duration(sinceSec))."
        case .unknown:
            phrase = "I couldn't determine the bridge status right now."
        }
        return .result(dialog: IntentDialog(stringLiteral: phrase))
    }
}

struct StartBridgeLiveActivityIntent: AppIntent {
    static var title: LocalizedStringResource = "Track Brickell Bridge on Lock Screen"
    static var description: IntentDescription = IntentDescription(
        "Starts a Live Activity that keeps the bridge status on your lock screen."
    )
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        let state = try await APIClient.shared.getStatus()
        await LiveActivityController.shared.start(with: state)
        return .result()
    }
}

struct BridgeShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CheckBridgeStatusIntent(),
            phrases: [
                "Is the \(.applicationName) bridge up?",
                "Check the Brickell Bridge with \(.applicationName)",
                "What's the bridge status in \(.applicationName)",
            ],
            shortTitle: "Bridge Status",
            systemImageName: "road.lanes"
        )
        AppShortcut(
            intent: StartBridgeLiveActivityIntent(),
            phrases: [
                "Track the bridge with \(.applicationName)",
                "Start \(.applicationName) live activity",
            ],
            shortTitle: "Track Bridge",
            systemImageName: "pin.circle"
        )
    }
}
