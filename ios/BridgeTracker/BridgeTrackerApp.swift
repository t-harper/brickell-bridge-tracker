import SwiftUI

@main
struct BridgeTrackerApp: App {
    @StateObject private var store = BridgeStore()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .task { await store.refresh() }
                .preferredColorScheme(nil)
                .tint(.accentColor)
        }
    }
}
