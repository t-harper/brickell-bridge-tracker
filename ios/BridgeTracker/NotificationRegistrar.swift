import Foundation
import UIKit
import UserNotifications

actor NotificationRegistrar {
    static let shared = NotificationRegistrar()

    private var apnsToken: String?

    func requestAuthorizationAndRegister() async {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            guard granted else { return }
            await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            print("Notification auth failed: \(error.localizedDescription)")
        }
    }

    func didReceiveAPNsToken(_ hex: String) async {
        self.apnsToken = hex
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let bundleId = Bundle.main.bundleIdentifier ?? "net.travis-harper.bridgetracker"
        let req = DeviceRegistrationRequest(
            deviceId: DeviceIdentity.deviceId,
            apnsToken: hex,
            bundleId: bundleId,
            appVersion: version
        )
        do {
            try await APIClient.shared.registerDevice(req)
        } catch {
            print("Device registration failed: \(error.localizedDescription)")
        }
    }
}

enum DeviceIdentity {
    private static let key = "bridgetracker.deviceId"

    static let deviceId: String = {
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: key)
        return id
    }()
}
